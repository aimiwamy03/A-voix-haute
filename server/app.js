import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { DEBATE_MAX_TURNS, MAX_UPLOAD_BYTES } from '../shared/constants.js';
import { parseFollowUp } from '../shared/debate.js';
import { parseFeedback } from '../shared/feedback.js';
import { cookieHeader, cookieValue, readSession, resolveAuthSecret, signSession } from './auth.js';
import { postDictation } from './dictation.js';
import { createGooglePkce, exchangeGoogleCode, googleAuthRequest, googleClientId, googleDonePage, verifyGoogleIdToken } from './google.js';
import { defaultComplete, feedbackPrompt, followUpPrompt, llmConfigured } from './llm.js';
import { adoptOrphanSessions, sessionStore, validSessionId } from './sessions.js';
import { userStore, validEmail, validName, validPassword } from './users.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp(options = {}) {
  const apiKey = options.apiKey ?? process.env.ASSEMBLYAI_API_KEY ?? '';
  const fetchImpl = options.fetchImpl ?? fetch;
  const complete = options.complete ?? defaultComplete;
  const hasLlm = options.llmConfigured ?? llmConfigured();
  const requireAuth = options.requireAuth !== false;
  const sessionsRoot = options.sessionsDir ?? process.env.SESSIONS_DIR ?? path.join(root, 'data', 'sessions');
  const sessions = sessionStore(sessionsRoot);
  const sessionsFor = (req) => (requireAuth ? sessionStore(path.join(sessionsRoot, req.user.id)) : sessions);
  const users = userStore(options.usersFile ?? process.env.USERS_FILE ?? path.join(root, 'data', 'users.json'));
  const secret = resolveAuthSecret({ ...options, requireAuth }, root);
  const googleId = googleClientId(options.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? '');
  const googleSecret = String(options.googleClientSecret ?? process.env.GOOGLE_CLIENT_SECRET ?? '').trim();
  const verifyGoogle = options.verifyGoogle ?? ((credential) => verifyGoogleIdToken(credential, googleId, { fetchImpl }));
  const googlePending = new Map();
  const GOOGLE_PENDING_MS = 5 * 60 * 1000;
  const publicUrl = String(options.publicUrl ?? process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const secureCookie = publicUrl.startsWith('https://');
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: options.maxUploadBytes ?? MAX_UPLOAD_BYTES },
  });

  const app = express();
  if (publicUrl) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', async (req, res, next) => {
    try {
      const id = readSession(cookieValue(req.headers.cookie), secret);
      req.user = id ? await users.get(id) : null;
      next();
    } catch (err) {
      next(err);
    }
  });

  const guard = (req, res, next) => {
    if (!requireAuth || req.user) return next();
    return res.status(401).json({ error: 'Connectez-vous pour continuer.' });
  };

  const sendUser = (res, user, status) => {
    res.set('Set-Cookie', cookieHeader(signSession(user.id, secret), { secure: secureCookie }));
    res.status(status).json({ user });
  };

  app.post('/api/auth/register', async (req, res, next) => {
    const name = validName(req.body?.name);
    const email = validEmail(req.body?.email);
    const password = validPassword(req.body?.password);
    if (!name || !email || !password) {
      return res.status(400).json({
        error: 'Indiquez un nom, un e-mail valide et un mot de passe d\'au moins 8 caractères.',
      });
    }
    try {
      const { user, first } = await users.create({ name, email, password });
      if (first) await adoptOrphanSessions(sessionsRoot, user.id);
      return sendUser(res, user, 201);
    } catch (err) {
      if (err.status === 409) return res.status(409).json({ error: err.message });
      return next(err);
    }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    const email = validEmail(req.body?.email);
    const password = String(req.body?.password ?? '');
    if (!email || !password) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
    try {
      const user = await users.authenticate(email, password);
      if (!user) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
      return sendUser(res, user, 200);
    } catch (err) {
      return next(err);
    }
  });

  app.get('/api/auth/config', (req, res) => {
    res.json({ googleClientId: googleId || null });
  });

  app.post('/api/auth/google/start', (req, res) => {
    if (!googleId) return res.status(503).json({ error: 'La connexion Google n\'est pas configurée.' });
    const origin = requestOrigin(req, publicUrl);
    if (!origin) return res.status(400).json({ error: 'Adresse invalide.' });
    const now = Date.now();
    for (const [key, value] of googlePending) {
      if (value.exp < now) googlePending.delete(key);
    }
    const desktop = Boolean(req.body?.desktop);
    const { verifier, challenge, state } = createGooglePkce();
    const redirectUri = `${origin}/api/auth/google/callback`;
    googlePending.set(state, {
      verifier,
      redirectUri,
      desktop,
      exp: now + GOOGLE_PENDING_MS,
      done: null,
      error: '',
    });
    const url = desktop && !googleSecret
      ? `${origin}/google.html?state=${encodeURIComponent(state)}`
      : googleAuthRequest({ clientId: googleId, redirectUri, state, challenge });
    res.json({ state, url });
  });

  app.post('/api/auth/google/browser', async (req, res, next) => {
    const state = String(req.body?.state ?? '');
    const pending = googlePending.get(state);
    if (!pending || pending.exp < Date.now()) {
      return res.status(404).json({ error: 'La connexion Google a expiré.' });
    }
    try {
      const profile = await verifyGoogle(String(req.body?.credential ?? ''));
      const { user, first } = await users.upsertGoogle(profile);
      if (first) await adoptOrphanSessions(sessionsRoot, user.id);
      pending.done = user;
      pending.error = '';
      return res.json({ ok: true });
    } catch (err) {
      if (err.status === 401 || err.status === 409) {
        pending.error = err.message;
        return res.status(err.status).json({ error: err.message });
      }
      return next(err);
    }
  });

  app.get('/api/auth/google/callback', async (req, res, next) => {
    const state = String(req.query.state ?? '');
    const pending = googlePending.get(state);
    if (!pending || pending.exp < Date.now()) {
      return res.status(400).type('html').send(googleDonePage('Cette connexion a expiré. Revenez à l\'application et réessayez.'));
    }
    const googleError = String(req.query.error ?? '');
    if (googleError) {
      pending.error = 'La connexion Google a été annulée.';
      return finishGoogleCallback(res, state, pending);
    }
    const code = String(req.query.code ?? '');
    if (!code || code.length > 8192) {
      pending.error = 'La connexion Google a échoué.';
      return finishGoogleCallback(res, state, pending);
    }
    if (!googleSecret) {
      pending.error = 'Ajoutez GOOGLE_CLIENT_SECRET dans .env, puis reconstruisez l\'application.';
      return finishGoogleCallback(res, state, pending);
    }
    try {
      const idToken = await exchangeGoogleCode({
        code,
        clientId: googleId,
        clientSecret: googleSecret,
        redirectUri: pending.redirectUri,
        verifier: pending.verifier,
        fetchImpl,
      });
      const profile = await verifyGoogle(idToken);
      const { user, first } = await users.upsertGoogle(profile);
      if (first) await adoptOrphanSessions(sessionsRoot, user.id);
      pending.done = user;
      pending.error = '';
      return finishGoogleCallback(res, state, pending);
    } catch (err) {
      if (err.status === 401 || err.status === 409) {
        pending.error = err.message;
        return finishGoogleCallback(res, state, pending);
      }
      return next(err);
    }
  });

  app.get('/api/auth/google/pending', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const state = String(req.query.state ?? '');
    const pending = googlePending.get(state);
    if (!pending || pending.exp < Date.now()) {
      return res.status(404).json({ error: 'La connexion Google a expiré.' });
    }
    if (pending.error) {
      googlePending.delete(state);
      return res.status(401).json({ error: pending.error });
    }
    if (!pending.done) return res.status(204).end();
    googlePending.delete(state);
    return sendUser(res, pending.done, 200);
  });

  function finishGoogleCallback(res, state, pending) {
    if (!pending.desktop && pending.done) {
      googlePending.delete(state);
      res.set('Set-Cookie', cookieHeader(signSession(pending.done.id, secret), { secure: secureCookie }));
      return res.redirect('/');
    }
    const message = pending.error || 'Connexion réussie. Retournez à À voix haute.';
    return res.status(pending.error ? 400 : 200).type('html').send(googleDonePage(message, !pending.error));
  }

  app.post('/api/auth/google', async (req, res, next) => {
    if (!googleId) return res.status(503).json({ error: 'La connexion Google n\'est pas configurée.' });
    const credential = String(req.body?.credential ?? '');
    try {
      const profile = await verifyGoogle(credential);
      const { user, first } = await users.upsertGoogle(profile);
      if (first) await adoptOrphanSessions(sessionsRoot, user.id);
      return sendUser(res, user, 200);
    } catch (err) {
      if (err.status === 401 || err.status === 409) return res.status(err.status).json({ error: err.message });
      return next(err);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    res.set('Set-Cookie', cookieHeader('', { secure: secureCookie }));
    res.status(204).end();
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Connectez-vous pour continuer.' });
    return res.json({ user: req.user });
  });

  app.patch('/api/auth/me', guard, async (req, res, next) => {
    const name = validName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'Indiquez un nom.' });
    try {
      const user = await users.updateName(req.user.id, name);
      if (!user) return res.status(401).json({ error: 'Connectez-vous pour continuer.' });
      return res.json({ user });
    } catch (err) {
      return next(err);
    }
  });

  app.post('/api/auth/password', guard, async (req, res, next) => {
    const current = String(req.body?.current ?? '');
    const nextPassword = validPassword(req.body?.next);
    if (!current || !nextPassword) {
      return res.status(400).json({ error: 'Indiquez le mot de passe actuel et un nouveau mot de passe d\'au moins 8 caractères.' });
    }
    try {
      const user = await users.changePassword(req.user.id, current, nextPassword);
      if (!user) return res.status(401).json({ error: 'Connectez-vous pour continuer.' });
      return res.json({ user });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      return next(err);
    }
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, assemblyai: Boolean(apiKey), llm: Boolean(hasLlm) });
  });

  app.get('/api/warm', async (req, res) => {
    try {
      const upstream = await fetchImpl('https://dictation.assemblyai.com/warm', {
        signal: AbortSignal.timeout(10_000),
      });
      res.status(upstream.ok ? 204 : upstream.status).end();
    } catch {
      res.status(204).end();
    }
  });

  app.post('/api/transcribe', guard, upload.single('audio'), async (req, res) => {
    if (!apiKey) {
      return res.status(503).json({
        error: 'Le serveur n\'a pas de clé AssemblyAI. Ajoutez ASSEMBLYAI_API_KEY dans .env, relancez le serveur, puis renvoyez le même enregistrement.',
      });
    }
    if (!req.file) return res.status(400).json({ error: 'Audio manquant.' });
    const header = req.file.buffer.subarray(0, 4).toString('ascii');
    if (req.file.buffer.length < 44 || header !== 'RIFF') {
      return res.status(400).json({ error: 'Le fichier doit être un WAV.' });
    }
    let incoming = {};
    if (req.body?.config) {
      try {
        incoming = JSON.parse(req.body.config);
      } catch {
        return res.status(400).json({ error: 'Config illisible.' });
      }
    }
    const result = await postDictation(req.file.buffer, incoming, { apiKey, fetchImpl });
    if (result.retryAfter) res.set('Retry-After', result.retryAfter);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    console.log(`transcribe session=${result.body.sessionId ?? '-'} durationMs=${result.body.durationMs ?? '-'}`);
    return res.json(result.body);
  });

  app.post('/api/feedback', guard, async (req, res) => {
    const text = String(req.body?.text ?? '');
    const documentText = String(req.body?.document ?? '');
    if (!text.trim() || !documentText.trim()) {
      return res.status(400).json({ error: 'Document ou transcription manquant.' });
    }
    if (text.length > 20_000 || documentText.length > 20_000) {
      return res.status(413).json({ error: 'Texte trop long.' });
    }
    try {
      const raw = await complete({ user: feedbackPrompt(documentText, text), maxTokens: 1200 });
      return res.json(parseFeedback(raw, text));
    } catch (err) {
      const status = err instanceof SyntaxError ? 502 : err.status || 502;
      return res.status(status).json({ error: err.message || 'Le retour a échoué.' });
    }
  });

  app.post('/api/followup', guard, async (req, res) => {
    const monologue = String(req.body?.monologue ?? req.body?.text ?? '').trim();
    const documentText = String(req.body?.document ?? '').trim();
    const stance = String(req.body?.stance ?? '').trim().slice(0, 300);
    const judgeOnly = Boolean(req.body?.judgeOnly);
    const thread = normalizeThread(req.body?.thread);
    if (!monologue || !documentText) {
      return res.status(400).json({ error: 'Document ou transcription manquant.' });
    }
    if (monologue.length > 20_000 || documentText.length > 20_000) {
      return res.status(413).json({ error: 'Texte trop long.' });
    }
    if (judgeOnly && !thread.length) {
      return res.status(400).json({ error: 'Échange manquant.' });
    }
    const forceClose = Boolean(req.body?.forceClose) || thread.length + 1 >= DEBATE_MAX_TURNS;
    try {
      const raw = await complete({
        user: followUpPrompt({ document: documentText, monologue, stance, thread, forceClose, judgeOnly }),
        maxTokens: judgeOnly ? 150 : 500,
      });
      const parsed = parseFollowUp(raw, {
        stanceIn: stance,
        forceClose,
        judgeOnly,
        answered: thread.length,
        usedMoves: thread.map((turn) => turn.move),
      });
      return res.json(judgeOnly ? { addressed: parsed.addressed } : parsed);
    } catch (err) {
      const status = err instanceof SyntaxError ? 502 : err.status || 502;
      return res.status(status).json({ error: err.message || 'La question a échoué.' });
    }
  });

  app.get('/api/sessions', guard, async (req, res, next) => {
    try {
      res.json({ sessions: await sessionsFor(req).list() });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/sessions/:id', guard, async (req, res, next) => {
    if (!validSessionId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
      const session = await sessionsFor(req).get(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session introuvable.' });
      return res.json(session);
    } catch (err) {
      return next(err);
    }
  });

  app.put('/api/sessions/:id', guard, async (req, res, next) => {
    const { id } = req.params;
    if (!validSessionId(id)) return res.status(400).json({ error: 'Identifiant invalide.' });
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !String(body.monologue?.text ?? '').trim()) {
      return res.status(400).json({ error: 'Session vide.' });
    }
    try {
      await sessionsFor(req).save(id, { ...body, id });
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  });

  app.delete('/api/sessions/:id', guard, async (req, res, next) => {
    if (!validSessionId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
      await sessionsFor(req).remove(req.params.id);
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  });

  app.use('/shared', express.static(path.join(root, 'shared')));
  app.use(express.static(path.join(root, 'public')));

  app.use((err, req, res, next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Enregistrement trop lourd (maximum 8 Mo).' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Erreur interne.' });
  });

  return app;
}

function requestOrigin(req, publicUrl) {
  if (publicUrl) return publicUrl;
  const host = String(req.headers.host ?? '');
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return '';
  return `http://${host}`;
}

function normalizeThread(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value.slice(0, DEBATE_MAX_TURNS)) {
    const question = String(item?.question ?? '').trim().slice(0, 500);
    const answer = String(item?.answer ?? '').trim().slice(0, 8000);
    const move = String(item?.move ?? '').trim().slice(0, 40);
    if (!question || !answer) continue;
    out.push({ question, move, answer });
  }
  return out;
}
