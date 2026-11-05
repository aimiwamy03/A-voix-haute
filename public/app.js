import { bindAccount, paintCompte, showAccount } from './account.js';
import { MIN_WAV_BYTES, record } from './audio.js';
import { busyLine, createOrb } from './orb.js';
import { getPrefs, onPrefs } from './prefs.js';
import { attachConfidence, wordDiff } from '/shared/diff.js';
import { EXAMPLE } from '/shared/example.js';
import {
  DEBATE_ARM_MS,
  DEBATE_BUDGET_MS,
  DEBATE_MAX_TURNS,
  DEBATE_MIN_TURNS,
  DEBATE_STOP_MS,
  DEBATE_WARN_MS,
  LOW_CONFIDENCE,
  WARN_MS,
  AUTO_STOP_MS,
} from '/shared/constants.js';
import { SUJETS, THEMES } from '/shared/sujets.js';
import { sttPromptForTurn } from '/shared/stt.js';

const $ = (id) => document.getElementById(id);
const CONSIGNE = 'Dégagez le problème soulevé par le document. Présentez votre point de vue de façon organisée, avec des exemples. Vous avez deux minutes.';
const LABELS = {
  problematique: 'Problématique posée',
  plan: 'Plan annoncé',
  exemples: 'Exemples donnés',
  conclusion: 'Conclusion',
};
const MOVE_LABELS = {
  reprise: 'Reprise',
  objection: 'Objection',
  exemple: 'Exemple',
  cas_limite: 'Cas limite',
  nuance: 'Nuance',
  conclusion: 'Conclusion',
};
const state = {
  sujetId: SUJETS[0].id,
  theme: SUJETS[0].theme,
  prepChoice: getPrefs().prepSeconds,
  prepLeft: getPrefs().prepSeconds,
  prepTimer: null,
  screen: 'sujet',
  turn: 'monologue',
  phase: 'ready',
  recorder: null,
  monologue: null,
  exchanges: [],
  stance: '',
  arming: false,
  closing: false,
  elapsedMs: 0,
  questionError: '',
  feedback: null,
  feedbackError: '',
  feedbackPending: false,
  example: false,
  error: '',
  retryAfter: '',
  reRecordOnly: false,
  retourTab: 'monologue',
  redo: null,
  redoError: '',
  savedId: null,
  createdAt: '',
  archive: null,
  history: [],
  historyError: '',
  user: null,
};

let recordGen = 0;
let questionGen = 0;
let feedbackGen = 0;
let saving = Promise.resolve();
let armTimer = null;

const sujet = () => SUJETS.find((item) => item.id === state.sujetId);
const documentText = () => `${sujet().title}\n\n${sujet().paragraphs.join('\n\n')}`;
const isDebate = () => state.turn === 'debate';
const openExchange = () => state.exchanges.find((item) => !item.reply?.text) ?? null;
const currentQuestion = () => openExchange()?.question || '';
const answeredExchanges = () => state.exchanges.filter((item) => item.reply?.text);

function exchangeNumber() {
  const open = state.exchanges.findIndex((item) => !item.reply?.text);
  if (open >= 0) return open + 1;
  return answeredExchanges().length + 1;
}

function debateSpokenMs() {
  return state.exchanges.reduce((sum, item) => sum + (item.reply?.durationMs || 0), 0);
}

function debateShouldClose() {
  const answered = answeredExchanges();
  if (answered.length >= DEBATE_MAX_TURNS) return true;
  if (debateSpokenMs() >= DEBATE_BUDGET_MS) return true;
  const last = answered.at(-1);
  return answered.length >= DEBATE_MIN_TURNS && last?.continue === false;
}

function threadPayload() {
  return answeredExchanges().map((item) => ({
    question: item.question,
    move: item.move,
    answer: item.reply.text,
  }));
}

function followupBody(judgeOnly) {
  const thread = threadPayload();
  return {
    document: documentText(),
    monologue: state.monologue.text,
    stance: state.stance,
    thread,
    forceClose: !judgeOnly && (
      thread.length + 1 >= DEBATE_MAX_TURNS
      || debateSpokenMs() + DEBATE_STOP_MS >= DEBATE_BUDGET_MS
    ),
    judgeOnly,
  };
}

function sttContext() {
  if (!isDebate()) return '';
  return answeredExchanges().at(-1)?.reply.text || state.monologue?.text || '';
}

function cancelArm() {
  clearTimeout(armTimer);
  armTimer = null;
  state.arming = false;
}

function armDebate() {
  cancelArm();
  if (!getPrefs().autoArmDebate) return;
  if (state.screen !== 'parler' || !isDebate() || state.phase !== 'ready' || state.closing) return;
  if (!currentQuestion()) return;
  state.arming = true;
  paintParler();
  armTimer = setTimeout(() => {
    armTimer = null;
    state.arming = false;
    if (state.screen !== 'parler' || state.phase !== 'ready' || state.closing || !currentQuestion()) return;
    void startRecording();
  }, DEBATE_ARM_MS);
}

function formatMinSec(total) {
  const safe = Math.max(0, total);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

const PRACTICE_SCREENS = ['sujet', 'parler', 'retour'];
let liveScreen = 'sujet';

// Two sections: Pratique (the live oral, steps 1-3) and Historique (the list and any saved oral opened from it).
function show(screen) {
  if (screen !== state.screen) document.querySelector('main').scrollTo(0, 0);
  state.screen = screen;
  $('screen-login').hidden = true;
  const inHistory = screen === 'historique' || Boolean(state.archive);
  const inCompte = screen === 'compte';
  const away = inHistory || inCompte;
  if (!away) liveScreen = screen;
  $('screen-historique').hidden = screen !== 'historique';
  $('screen-compte').hidden = screen !== 'compte';
  for (const [id, active] of [['to-pratique', !away], ['to-historique', inHistory], ['to-compte', inCompte]]) {
    $(id).classList.toggle('is-active', active);
    if (active) $(id).setAttribute('aria-current', 'page');
    else $(id).removeAttribute('aria-current');
  }
  $('steps').hidden = away;
  for (const name of ['sujet', 'parler', 'retour']) {
    $(`screen-${name}`).hidden = name !== screen;
    const step = $(`step-${name}`);
    step.classList.toggle('is-active', name === screen);
    const order = ['sujet', 'parler', 'retour'];
    step.classList.toggle('is-done', order.indexOf(name) < order.indexOf(screen));
  }
}

function confirmLeave() {
  if (state.phase === 'recording') return window.confirm('Arrêter l\'enregistrement et quitter ?');
  if (state.phase === 'transcribing') return window.confirm('La transcription n\'est pas terminée. Quitter quand même ?');
  const loose = (state.monologue?.wav && !state.monologue?.text)
    || state.exchanges.some((item) => item.reply?.wav && !item.reply?.text);
  if (loose) return window.confirm('Quitter et effacer cet oral ?');
  return true;
}

function resetSession() {
  recordGen += 1;
  questionGen += 1;
  feedbackGen += 1;
  cancelArm();
  state.recorder?.stop();
  state.recorder = null;
  state.prepChoice = getPrefs().prepSeconds;
  state.prepLeft = state.prepChoice;
  stopPrep();
  paintPrep();
  state.turn = 'monologue';
  state.phase = 'ready';
  state.monologue = null;
  state.exchanges = [];
  state.stance = '';
  state.closing = false;
  state.elapsedMs = 0;
  state.questionError = '';
  state.feedback = null;
  state.feedbackError = '';
  state.feedbackPending = false;
  state.example = false;
  state.error = '';
  state.reRecordOnly = false;
  state.retourTab = 'monologue';
  state.redo = null;
  state.redoError = '';
  state.savedId = null;
  state.createdAt = '';
  state.archive = null;
}

const withoutAudio = (turn) => {
  if (!turn?.text) return null;
  const { wav, ...rest } = turn;
  return rest;
};

// Saves the whole session after each step; saves run one at a time so an older snapshot never overwrites a newer one.
function persist() {
  if (state.example || !state.monologue?.text) return;
  if (!state.savedId) {
    state.savedId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    state.createdAt = new Date().toISOString();
  }
  const id = state.savedId;
  const answered = answeredExchanges();
  const snapshot = {
    sujetId: state.sujetId,
    title: sujet().title,
    createdAt: state.createdAt,
    updatedAt: new Date().toISOString(),
    stance: state.stance,
    question: currentQuestion() || answered.at(-1)?.question || '',
    monologue: withoutAudio(state.monologue),
    reply: withoutAudio(answered.at(-1)?.reply),
    exchanges: state.exchanges.filter((item) => item.question).map((item) => ({
      question: item.question,
      move: item.move,
      continue: item.continue !== false,
      addressed: item.addressed,
      reply: withoutAudio(item.reply),
    })),
    feedback: state.feedback,
  };
  saving = saving.then(async () => {
    const res = await fetch(`/api/sessions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    if (!res.ok) throw new Error(`save ${res.status}`);
  }).catch((err) => console.error('La session n\'a pas pu être enregistrée.', err));
}

function chooseSujet(item) {
  if (item.id === state.sujetId) {
    state.theme = item.theme;
    renderSujets();
    return;
  }
  if ((state.monologue?.text || state.monologue?.wav) && !window.confirm('Changer de sujet et effacer cet oral ?')) return;
  resetSession();
  state.sujetId = item.id;
  state.theme = item.theme;
  $('notes').value = sessionStorage.getItem(`oral-notes:${item.id}`) || '';
  renderSujets();
  renderDocument();
}

function renderSujets() {
  const themes = $('theme-row');
  themes.replaceChildren();
  for (const [id, label] of THEMES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `theme-chip${id === state.theme ? ' is-selected' : ''}`;
    chip.setAttribute('aria-pressed', String(id === state.theme));
    chip.textContent = label;
    chip.onclick = () => {
      if (id === state.theme) return;
      const first = SUJETS.find((item) => item.theme === id);
      chooseSujet(first);
    };
    themes.append(chip);
  }

  const list = $('sujet-list');
  list.replaceChildren();
  for (const item of SUJETS.filter((entry) => entry.theme === state.theme)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `sujet-card${item.id === state.sujetId ? ' is-selected' : ''}`;
    const title = document.createElement('strong');
    title.textContent = item.title;
    const meta = document.createElement('span');
    meta.textContent = `${item.paragraphs.join(' ').split(/\s+/).length} mots`;
    button.append(title, meta);
    button.onclick = () => chooseSujet(item);
    list.append(button);
  }
}

function renderDocument() {
  const root = $('document');
  root.replaceChildren();
  const item = sujet();
  const kicker = document.createElement('p');
  kicker.className = 'kicker';
  kicker.textContent = 'Document déclencheur';
  const title = document.createElement('h2');
  title.textContent = item.title;
  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = 'Consigne : dégagez le problème, puis défendez votre point de vue.';
  root.append(kicker, title, meta);
  for (const paragraph of item.paragraphs) {
    const p = document.createElement('p');
    p.textContent = paragraph;
    root.append(p);
  }
}

function paintPrep() {
  const running = Boolean(state.prepTimer);
  const untouched = state.prepLeft === state.prepChoice;
  const finished = state.prepLeft === 0;
  $('prep-clock').textContent = formatMinSec(state.prepLeft);
  $('prep-clock').classList.toggle('is-running', running);
  $('prep-start').textContent = running ? 'Pause' : untouched ? 'Démarrer' : finished ? 'Recommencer' : 'Reprendre';
  $('prep-reset').hidden = untouched || finished;
  $('prep-done').hidden = !finished;
  $('prep-bar').style.transform = `scaleX(${1 - state.prepLeft / state.prepChoice})`;
}

function stopPrep() {
  clearInterval(state.prepTimer);
  state.prepTimer = null;
}

function resetPrep() {
  stopPrep();
  state.prepLeft = state.prepChoice;
  paintPrep();
}

// One button starts, pauses and resumes; after time is up it starts over.
function togglePrep() {
  if (state.prepTimer) {
    stopPrep();
    paintPrep();
    return;
  }
  if (state.prepLeft === 0) state.prepLeft = state.prepChoice;
  state.prepTimer = setInterval(() => {
    state.prepLeft = Math.max(0, state.prepLeft - 1);
    if (state.prepLeft === 0) stopPrep();
    paintPrep();
  }, 1000);
  paintPrep();
}

function paintMeter(level = 0) {
  const bars = $('meter').children;
  for (let i = 0; i < bars.length; i++) {
    const center = Math.abs(i - (bars.length - 1) / 2) / (bars.length / 2);
    const height = Math.max(0.08, Math.min(1, level * (1 - center * 0.45)));
    bars[i].style.transform = `scaleY(${height})`;
  }
}

function paintElapsed(ms) {
  const debate = isDebate();
  const stop = debate ? DEBATE_STOP_MS : AUTO_STOP_MS;
  const warnAt = debate ? DEBATE_WARN_MS : WARN_MS;
  $('clock').textContent = formatMinSec(Math.floor(Math.min(ms, stop) / 1000));
  const warn = ms >= warnAt;
  $('warn').hidden = !warn;
  $('warn').textContent = debate
    ? 'Il vous reste une dizaine de secondes.'
    : 'Il vous reste moins de quinze secondes.';
  $('clock').classList.toggle('is-warn', warn);
}

function setActions(buttons) {
  const root = $('parler-actions');
  root.replaceChildren();
  for (const item of buttons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = item.secondary ? 'btn secondary' : 'btn';
    button.textContent = item.label;
    button.onclick = item.onClick;
    root.append(button);
  }
}

// The preparation notes stay visible while speaking, as in the exam. Read-only: typing would be recorded.
function paintParlerNotes() {
  const text = $('notes').value.trim();
  $('parler-notes-text').textContent = text;
  $('parler-notes').hidden = !text || !getPrefs().showNotesWhileSpeaking;
}

// Transcribing composes the stronger version; the examiner preparing a question is plain thinking.
let parlerOrb = null;
function paintParlerOrb(thinking) {
  $('record').hidden = thinking;
  $('parler-orb').hidden = !thinking;
  if (!thinking) return;
  const transcribing = state.phase === 'transcribing';
  const orbState = transcribing ? 'composing' : 'breathing';
  const label = transcribing ? 'Analyse de l\'enregistrement' : 'L\'examinateur réfléchit';
  if (!parlerOrb) {
    parlerOrb = createOrb({ state: orbState, size: 64, px: 112, label });
    $('parler-orb').append(parlerOrb);
  } else {
    parlerOrb.setOrbState(orbState, label);
  }
}

function paintParler() {
  paintParlerNotes();
  const debate = isDebate();
  const question = currentQuestion();
  $('turn-kicker').textContent = debate ? `Échange ${exchangeNumber()} / ${DEBATE_MAX_TURNS}` : 'Monologue';
  $('turn-done').hidden = true;
  $('turn-hint').textContent = debate
    ? '50 secondes · arrêt automatique'
    : '2 minutes · arrêt automatique à 1:55';
  if (!debate) $('turn-question').textContent = CONSIGNE;
  else if (question) $('turn-question').textContent = question;
  else if (state.questionError) $('turn-question').textContent = 'La question n\'a pas pu être préparée.';
  else $('turn-question').textContent = 'L\'examinateur prépare une question…';

  const recording = state.phase === 'recording';
  const waiting = debate && !question && !state.questionError && !state.closing && state.phase === 'ready';
  $('record').dataset.state = recording ? 'recording' : 'ready';
  $('record').disabled = state.phase === 'transcribing'
    || state.closing
    || waiting
    || (debate && state.questionError && state.phase !== 'failed');
  const thinking = state.phase === 'transcribing' || waiting || (state.closing && state.phase !== 'failed');
  $('record-label').textContent = recording
    ? (debate ? 'J\'ai répondu' : 'Terminer')
    : state.phase === 'failed'
      ? 'Réenregistrer'
      : state.phase === 'transcribing'
        ? 'Analyse'
        : thinking
          ? 'Examinateur'
          : 'Enregistrer';
  paintParlerOrb(thinking);
  if (!recording) {
    $('clock').textContent = '0:00';
    $('clock').classList.remove('is-warn');
    $('warn').hidden = true;
    paintMeter(0);
  }

  const status = $('parler-status');
  status.classList.toggle('is-error', state.phase === 'failed' || Boolean(state.questionError));
  if (state.phase === 'transcribing') status.textContent = 'Analyse en cours…';
  else if (state.phase === 'failed') status.textContent = state.retryAfter ? `${state.error} Réessayez dans ${state.retryAfter} s.` : state.error;
  else if (state.questionError) status.textContent = state.questionError;
  else if (state.closing) status.textContent = 'Le débat se termine…';
  else if (waiting) status.textContent = 'L\'examinateur prépare une question…';
  else if (state.arming) status.textContent = 'L\'enregistrement va commencer.';
  else if (debate && question && !recording) status.textContent = getPrefs().autoArmDebate
    ? 'Le texte n\'apparaît qu\'une fois l\'enregistrement terminé.'
    : 'Touchez Enregistrer pour répondre.';
  else if (recording && debate) status.textContent = 'Répondez, puis touchez « J\'ai répondu ».';
  else if (recording) status.textContent = 'On vous écoute. Rien ne s\'affiche pendant que vous parlez.';
  else status.textContent = 'Le texte n\'apparaît qu\'une fois l\'enregistrement terminé.';

  const actions = [{ label: 'Revenir au sujet', secondary: true, onClick: leaveToSujet }];
  const slot = debate ? openExchange()?.reply : state.monologue;
  if (state.phase === 'failed' && slot?.wav && !state.reRecordOnly) {
    actions.unshift({ label: 'Renvoyer le même audio', onClick: () => resendCurrent() });
  }
  if (debate && state.questionError) {
    actions.unshift({ label: 'Redemander la question', onClick: () => requestQuestion() });
  }
  if (debate && !state.closing && state.phase !== 'transcribing') {
    actions.push({ label: 'Terminer le débat', secondary: true, onClick: endDebate });
  }
  setActions(actions);
}

function leaveToSujet() {
  if (!confirmLeave()) return;
  resetSession();
  show('sujet');
  renderSujets();
}

async function startRecording() {
  if (state.phase === 'transcribing' || state.phase === 'recording' || state.closing) return;
  cancelArm();
  const token = ++recordGen;
  state.error = '';
  state.elapsedMs = 0;
  $('parler-status').textContent = 'Autorisation du micro…';
  $('record').disabled = true;
  try {
    const handle = await record({
      maxMs: isDebate() ? DEBATE_STOP_MS : AUTO_STOP_MS,
      onLevel: (level) => { if (token === recordGen) paintMeter(level); },
      onElapsed: (ms) => {
        if (token !== recordGen) return;
        state.elapsedMs = ms;
        paintElapsed(ms);
      },
      onStop: (wav, err) => { if (token === recordGen) void finishRecording(wav, err); },
    });
    if (token !== recordGen) {
      handle.stop();
      return;
    }
    state.recorder = handle;
    state.phase = 'recording';
    paintParler();
  } catch (err) {
    if (token !== recordGen) return;
    state.phase = 'failed';
    state.reRecordOnly = true;
    state.error = err?.name === 'NotAllowedError'
      ? 'L\'accès au micro a été refusé. Autorisez-le dans le navigateur, puis réessayez.'
      : 'Aucun micro utilisable n\'a été trouvé.';
    paintParler();
  }
}

async function finishRecording(wav, err) {
  state.recorder = null;
  if (err?.code === 'TOO_SHORT' || (wav && wav.size < MIN_WAV_BYTES)) {
    state.phase = 'failed';
    state.reRecordOnly = true;
    state.error = 'L\'enregistrement est trop court. Parlez un peu plus longtemps, puis réessayez.';
    paintParler();
    return;
  }
  if (err || !wav) {
    state.phase = 'failed';
    state.reRecordOnly = true;
    state.error = 'Impossible de lire cet enregistrement. Réessayez.';
    paintParler();
    return;
  }
  const debate = isDebate();
  const exchange = debate ? openExchange() : null;
  if (debate && !exchange) {
    state.phase = 'failed';
    state.reRecordOnly = true;
    state.error = 'Aucune question en cours. Redemandez-la, puis réessayez.';
    paintParler();
    return;
  }
  const durationMs = debate ? (state.elapsedMs || exchange.reply?.durationMs || 0) : 0;
  if (debate) exchange.reply = { ...(exchange.reply || {}), wav, durationMs };
  else state.monologue = { ...(state.monologue || {}), wav };
  state.phase = 'transcribing';
  state.reRecordOnly = false;
  paintParler();
  try {
    const data = await transcribe(wav, sttPromptForTurn(sujet().title, sujet().summary, sttContext()));
    if (debate) exchange.reply = { wav, ...data, durationMs };
    else state.monologue = { wav, ...data };
    persist();
    if (!debate) {
      state.turn = 'debate';
      state.phase = 'ready';
      paintParler();
      void requestQuestion();
      void requestFeedback();
    } else if (debateShouldClose()) {
      void judgeAndRetour();
    } else {
      state.phase = 'ready';
      paintParler();
      void requestQuestion();
    }
  } catch (error) {
    state.phase = 'failed';
    state.error = error.message;
    state.retryAfter = error.retryAfter || '';
    state.reRecordOnly = Boolean(error.reRecord);
    paintParler();
  }
}

async function resendCurrent() {
  const wav = isDebate() ? openExchange()?.reply?.wav : state.monologue?.wav;
  if (!wav) return;
  await finishRecording(wav);
}

async function transcribe(wav, stt) {
  const body = new FormData();
  body.append('config', JSON.stringify({ stt_prompt: stt, keyterms_prompt: sujet().keyterms }));
  body.append('audio', wav, 'reponse.wav');
  const res = await fetch('/api/transcribe', { method: 'POST', body });
  const data = await res.json().catch(() => ({ error: 'Réponse illisible.' }));
  if (!res.ok) {
    const error = new Error(data.error || 'La transcription a échoué.');
    error.retryAfter = res.headers.get('Retry-After');
    throw error;
  }
  if (!data.text?.trim()) {
    const error = new Error('Aucune parole n\'a été reconnue. Réenregistrez en parlant un peu plus près du micro.');
    error.reRecord = true;
    throw error;
  }
  return data;
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'La demande a échoué.');
  return data;
}

function endDebate() {
  if (state.phase === 'transcribing' || state.closing) return;
  cancelArm();
  if (state.phase === 'recording') {
    recordGen += 1;
    state.recorder?.stop();
    state.recorder = null;
    state.phase = 'ready';
  }
  const open = openExchange();
  if (open && !open.reply?.text) state.exchanges.splice(state.exchanges.indexOf(open), 1);
  void judgeAndRetour();
}

async function judgeAndRetour() {
  const gen = ++questionGen;
  cancelArm();
  state.closing = true;
  state.phase = 'ready';
  if (state.screen === 'parler') paintParler();
  const last = answeredExchanges().at(-1);
  if (last && typeof last.addressed !== 'boolean') {
    try {
      const data = await postJson('/api/followup', followupBody(true));
      if (gen !== questionGen) return;
      if (typeof data.addressed === 'boolean') last.addressed = data.addressed;
    } catch {
      // The thread still shows without this last verdict.
    }
  }
  if (gen !== questionGen) return;
  persist();
  state.closing = false;
  goRetour();
}

async function requestQuestion() {
  const gen = ++questionGen;
  cancelArm();
  state.questionError = '';
  state.closing = false;
  if (state.screen === 'parler') paintParler();
  try {
    const data = await postJson('/api/followup', followupBody(false));
    if (gen !== questionGen || state.screen !== 'parler') return;
    const prev = answeredExchanges().at(-1);
    if (prev && typeof data.addressed === 'boolean') prev.addressed = data.addressed;
    if (!state.stance && data.stance) state.stance = data.stance;
    state.exchanges.push({
      question: data.question,
      move: data.move,
      continue: data.continue !== false,
      addressed: null,
      reply: null,
    });
    persist();
    paintParler();
    armDebate();
  } catch (err) {
    if (gen !== questionGen) return;
    state.questionError = err.message;
    if (state.screen === 'parler') paintParler();
  }
}

async function requestFeedback() {
  const gen = ++feedbackGen;
  state.feedback = null;
  state.feedbackError = '';
  state.feedbackPending = true;
  if (state.screen === 'retour') renderRetour();
  try {
    const data = await postJson('/api/feedback', { document: documentText(), text: state.monologue.text });
    if (gen !== feedbackGen) return;
    state.feedback = data;
    persist();
  } catch (err) {
    if (gen !== feedbackGen) return;
    state.feedbackError = err.message;
  } finally {
    if (gen === feedbackGen) state.feedbackPending = false;
  }
  if (state.screen === 'retour') renderRetour();
}

function goRetour() {
  show('retour');
  renderRetour();
}

function column(title, caption, turn, side, which) {
  const card = document.createElement('article');
  card.className = 'column';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const note = document.createElement('p');
  note.className = 'caption';
  note.textContent = caption;
  card.append(heading, note);
  const prose = document.createElement('div');
  prose.className = 'prose';
  if (!turn?.text) {
    prose.textContent = 'Pas encore d\'enregistrement.';
    card.append(prose);
    return card;
  }
  if (side === 'right' && !turn.stronger) {
    const missing = document.createElement('p');
    missing.textContent = turn.llmError === 'timeout'
      ? 'La version renforcée a mis trop de temps.'
      : 'Version renforcée indisponible.';
    prose.append(missing);
    card.append(prose);
    if (!state.example && !state.archive && turn.wav) card.append(retryButton('Réessayer', () => redo(which)));
    return card;
  }
  const ops = attachConfidence(wordDiff(turn.text, turn.stronger), side === 'left' ? turn.words : []);
  for (const op of ops) {
    if (side === 'left' && op.op === 'added') continue;
    if (side === 'right' && op.op === 'removed') continue;
    const span = document.createElement('span');
    span.className = 'tok';
    span.textContent = side === 'left' ? op.word : (op.upgraded || op.word);
    if (side === 'left' && op.op === 'removed') span.classList.add('removed');
    if (side === 'right' && op.op === 'added') span.classList.add('added');
    if (getPrefs().markUncertainWords && side === 'left' && op.op !== 'removed' && op.confidence != null && op.confidence < LOW_CONFIDENCE) {
      span.classList.add('lowconf');
      span.title = 'À vérifier ?';
    }
    prose.append(span, document.createTextNode(' '));
  }
  card.append(prose);
  if (getPrefs().markUncertainWords && side === 'left' && (turn.words || []).some((word) => word.confidence < LOW_CONFIDENCE)) {
    const legend = document.createElement('p');
    legend.className = 'legend';
    legend.textContent = 'Pointillés : reconnaissance incertaine, pas une note de prononciation.';
    card.append(legend);
  }
  return card;
}

function retryButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn secondary';
  button.textContent = label;
  button.onclick = onClick;
  return button;
}

function exchangeIndex(which) {
  return Number(String(which).split(':')[1]);
}

async function redo(which) {
  const index = which === 'monologue' ? -1 : exchangeIndex(which);
  const slot = which === 'monologue' ? state.monologue : state.exchanges[index]?.reply;
  if (!slot?.wav) return;
  const previous = which === 'monologue'
    ? ''
    : (index > 0 ? state.exchanges[index - 1]?.reply?.text : state.monologue?.text) || '';
  state.redo = which;
  state.redoError = '';
  renderRetour();
  try {
    const data = await transcribe(slot.wav, sttPromptForTurn(sujet().title, sujet().summary, previous));
    const next = { wav: slot.wav, ...data, durationMs: slot.durationMs };
    if (which === 'monologue') state.monologue = next;
    else state.exchanges[index].reply = next;
    persist();
  } catch (err) {
    state.redoError = err.message;
  } finally {
    state.redo = null;
    renderRetour();
  }
}

function viewExchanges(view) {
  if (Array.isArray(view.exchanges) && view.exchanges.some((item) => item?.reply?.text)) {
    return view.exchanges;
  }
  if (view.reply?.text) {
    return [{ question: view.question || '', move: '', addressed: null, reply: view.reply }];
  }
  return [];
}

function renderExchange(item, index) {
  const block = document.createElement('section');
  block.className = 'exchange';
  const kicker = document.createElement('p');
  kicker.className = 'kicker';
  const move = MOVE_LABELS[item.move];
  kicker.textContent = move ? `Échange ${index + 1} · ${move}` : `Échange ${index + 1}`;
  const question = document.createElement('p');
  question.className = 'examiner';
  question.textContent = item.question || '';
  block.append(kicker, question);
  if (item.addressed === true || item.addressed === false) {
    const verdict = document.createElement('p');
    verdict.className = `verdict${item.addressed ? ' is-met' : ' is-missed'}`;
    verdict.textContent = item.addressed
      ? 'Vous avez répondu au point soulevé.'
      : 'Vous n\'avez pas répondu au point soulevé.';
    block.append(verdict);
  }
  const grid = document.createElement('div');
  grid.className = 'diff-grid';
  const which = `exchange:${index}`;
  grid.append(
    column('Ta version', 'Transcription mot à mot', item.reply, 'left', which),
    column('Version renforcée', 'Réécriture C1, sans idée nouvelle', item.reply, 'right', which),
  );
  block.append(grid);
  return block;
}

function renderRetour() {
  const live = !state.example && !state.archive;
  const view = state.example ? EXAMPLE : state.archive ? { example: false, ...state.archive } : {
    example: false,
    title: sujet().title,
    monologue: state.monologue,
    exchanges: state.exchanges,
    feedback: state.feedback,
  };
  const root = $('retour-root');
  root.replaceChildren();
  if (view.example) {
    const ribbon = document.createElement('p');
    ribbon.className = 'ribbon';
    ribbon.textContent = 'Exemple fictif';
    root.append(ribbon);
  }
  if (state.archive) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'back-link';
    back.textContent = '← Historique';
    back.onclick = () => openHistory();
    root.append(back);
    const saved = document.createElement('p');
    saved.className = 'ribbon';
    saved.textContent = `Historique · ${formatDate(state.archive.createdAt)}`;
    root.append(saved);
  }
  const heading = document.createElement('h1');
  heading.textContent = view.title;
  root.append(heading);

  if (state.redo) {
    root.append(busyLine('Analyse en cours…'));
  }
  if (state.redoError) {
    const err = document.createElement('p');
    err.className = 'status is-error';
    err.textContent = state.redoError;
    root.append(err);
  }

  const monoKicker = document.createElement('p');
  monoKicker.className = 'kicker';
  monoKicker.textContent = 'Monologue';
  const grid = document.createElement('div');
  grid.className = 'diff-grid';
  grid.append(
    column('Ta version', 'Transcription mot à mot', view.monologue, 'left', 'monologue'),
    column('Version renforcée', 'Réécriture C1, sans idée nouvelle', view.monologue, 'right', 'monologue'),
  );
  root.append(monoKicker, grid);

  const exchanges = viewExchanges(view).filter((item) => item?.reply?.text);
  if (exchanges.length) {
    const debateTitle = document.createElement('h2');
    debateTitle.className = 'section-title';
    debateTitle.textContent = 'Débat';
    root.append(debateTitle);
    viewExchanges(view).forEach((item, index) => {
      if (!item?.reply?.text) return;
      root.append(renderExchange(item, index));
    });
  }

  const structureTitle = document.createElement('h2');
  structureTitle.className = 'section-title';
  structureTitle.textContent = 'Structure';
  const structureNote = document.createElement('p');
  structureNote.className = 'caption';
  structureNote.textContent = 'Ces repères portent sur le monologue.';
  root.append(structureTitle, structureNote);

  if (live && state.feedbackPending) {
    root.append(busyLine('Analyse en cours…'));
  } else if (live && state.feedbackError) {
    const err = document.createElement('p');
    err.className = 'status is-error';
    err.textContent = state.feedbackError;
    root.append(err, retryButton('Réessayer le retour', () => requestFeedback()));
  } else if (!live && !view.example && !view.feedback) {
    const none = document.createElement('p');
    none.className = 'note';
    none.textContent = 'Aucun retour n\'avait été enregistré pour cet oral.';
    root.append(none);
  } else if (view.feedback) {
    const list = document.createElement('ul');
    list.className = 'structure';
    for (const key of Object.keys(LABELS)) {
      const item = view.feedback.structure[key];
      const li = document.createElement('li');
      const mark = document.createElement('span');
      mark.className = `mark${item.ok ? ' is-ok' : ''}`;
      mark.textContent = item.ok ? '✓' : '';
      const label = document.createElement('span');
      label.textContent = LABELS[key];
      li.append(mark, label);
      if (item.quote) {
        const quote = document.createElement('p');
        quote.className = 'quote';
        quote.textContent = `« ${item.quote} »`;
        li.append(quote);
      }
      list.append(li);
    }
    root.append(list);

    const fixesTitle = document.createElement('h2');
    fixesTitle.className = 'section-title';
    fixesTitle.textContent = 'Trois choses à corriger';
    root.append(fixesTitle);
    if (view.feedback.fixes.length < 3) {
      const note = document.createElement('p');
      note.className = 'caption';
      note.textContent = 'Certaines corrections ont été écartées : la citation ne figurait pas dans la transcription.';
      root.append(note);
    }
    view.feedback.fixes.forEach((fix, index) => {
      const row = document.createElement('article');
      row.className = 'fix';
      const num = document.createElement('b');
      num.textContent = String(index + 1).padStart(2, '0');
      const body = document.createElement('div');
      const quote = document.createElement('p');
      quote.className = 'quote';
      quote.textContent = `« ${fix.quote} »`;
      const problem = document.createElement('p');
      problem.textContent = fix.probleme;
      const better = document.createElement('p');
      better.textContent = fix.mieux;
      body.append(quote, problem, better);
      row.append(num, body);
      root.append(row);
    });
    if (!view.feedback.fixes.length && live) {
      root.append(retryButton('Réessayer le retour', () => requestFeedback()));
    }
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.style.marginTop = '28px';
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'btn';
  again.textContent = 'Nouvel oral';
  again.onclick = () => { resetSession(); show('sujet'); renderSujets(); };
  if (state.archive) actions.append(retryButton('← Retour à l\'historique', () => openHistory()));
  else actions.append(again);
  root.append(actions);

  const ids = [
    view.monologue?.sessionId,
    ...viewExchanges(view).map((item) => item.reply?.sessionId),
  ].filter(Boolean);
  if (ids.length) {
    const session = document.createElement('p');
    session.className = 'session';
    session.textContent = `Session ${ids.join(' · ')}`;
    root.append(session);
  }
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function goPratique() {
  state.archive = null;
  show(liveScreen);
  if (liveScreen === 'retour') renderRetour();
  else if (liveScreen === 'parler') paintParler();
  else renderSujets();
  document.querySelector('main').scrollTo(0, 0);
}

async function openHistory() {
  if (state.phase === 'recording') {
    if (!window.confirm('Arrêter l\'enregistrement pour ouvrir l\'historique ? Il sera tout de même transcrit.')) return;
    state.recorder?.stop();
  }
  state.archive = null;
  show('historique');
  document.querySelector('main').scrollTo(0, 0);
  state.historyError = '';
  renderHistory(true);
  try {
    await saving;
    const res = await fetch('/api/sessions');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'L\'historique n\'a pas pu être chargé.');
    state.history = data.sessions;
  } catch (err) {
    state.historyError = err.message;
  }
  if (state.screen === 'historique') renderHistory(false);
}

function renderHistory(loading) {
  const root = $('historique-list');
  root.replaceChildren();
  if (loading) {
    root.textContent = 'Chargement…';
    return;
  }
  if (state.historyError) {
    const err = document.createElement('p');
    err.className = 'status is-error';
    err.textContent = state.historyError;
    root.append(err);
    return;
  }
  if (!state.history.length) {
    const empty = document.createElement('p');
    empty.className = 'note';
    empty.textContent = 'Aucun oral enregistré pour l\'instant. Chaque oral transcrit s\'ajoute ici automatiquement.';
    root.append(empty);
    return;
  }
  for (const item of state.history) {
    const row = document.createElement('article');
    row.className = 'history-item';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'history-open';
    const date = document.createElement('span');
    date.className = 'history-date';
    const count = item.exchangeCount || (item.hasReply ? 1 : 0);
    const detail = count > 0
      ? ` · débat, ${count} échange${count > 1 ? 's' : ''}`
      : ' · monologue';
    date.textContent = `${formatDate(item.createdAt)}${detail}`;
    const title = document.createElement('strong');
    title.textContent = item.title;
    const excerpt = document.createElement('span');
    excerpt.className = 'history-excerpt';
    excerpt.textContent = item.excerpt.length >= 160 ? `${item.excerpt}…` : item.excerpt;
    open.append(date, title, excerpt);
    open.onclick = () => openSaved(item.id);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'text-btn history-delete';
    remove.textContent = 'Supprimer';
    remove.onclick = async () => {
      if (!window.confirm('Supprimer cet oral de l\'historique ?')) return;
      const res = await fetch(`/api/sessions/${item.id}`, { method: 'DELETE' }).catch(() => null);
      if (!res?.ok) {
        window.alert('La suppression a échoué.');
        return;
      }
      state.history = state.history.filter((entry) => entry.id !== item.id);
      renderHistory(false);
    };
    row.append(open, remove);
    root.append(row);
  }
}

async function openSaved(id) {
  const res = await fetch(`/api/sessions/${id}`).catch(() => null);
  const data = await res?.json().catch(() => null);
  if (!res?.ok || !data) {
    state.historyError = data?.error || 'Cet oral n\'a pas pu être ouvert.';
    renderHistory(false);
    return;
  }
  state.archive = data;
  state.retourTab = 'monologue';
  goRetour();
  document.querySelector('main').scrollTo(0, 0);
}

async function loadHealth() {
  try {
    const health = await fetch('/api/health').then((res) => res.json());
    const missing = [];
    if (!health.assemblyai) missing.push('ASSEMBLYAI_API_KEY');
    if (!health.llm) missing.push('ANTHROPIC_API_KEY');
    if (missing.length) {
      $('keys-banner').hidden = false;
      $('keys-banner').textContent = `Pour un oral réel, ajoutez ${missing.join(' et ')} dans le fichier .env, puis relancez le serveur. L'exemple de retour reste disponible.`;
    }
  } catch {
    // The page still shows the subjects.
  }
}

let booted = false;

function installAuthFetch() {
  if (installAuthFetch.done) return;
  installAuthFetch.done = true;
  const raw = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await raw(...args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
    if (res.status === 401 && state.user && !String(url).includes('/api/auth/')) location.reload();
    return res;
  };
}

function enter(user) {
  state.user = user;
  document.body.classList.add('is-authed');
  showAccount(user);
  $('account').hidden = false;
  const logout = async () => {
    if (!confirmLeave()) return;
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  };
  $('logout').onclick = logout;
  bindAccount({
    onCompte: () => void openCompte(),
    onHistory: () => void openHistory(),
    onLogout: logout,
    onSaveName: saveName,
    onSavePassword: savePassword,
  });
  installAuthFetch();
  $('screen-login').hidden = true;
  boot();
}

async function saveName(name) {
  const res = await fetch('/api/auth/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Le nom n\'a pas pu être enregistré.');
  state.user = data.user;
  showAccount(data.user);
  paintCompte({ user: data.user, historyCount: state.history.length });
}

async function savePassword(current, next) {
  const res = await fetch('/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current, next }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Le mot de passe n\'a pas pu être changé.');
}

async function openCompte() {
  if (state.phase === 'recording') {
    if (!window.confirm('Arrêter l\'enregistrement pour ouvrir le compte ? Il sera tout de même transcrit.')) return;
    state.recorder?.stop();
  }
  state.archive = null;
  show('compte');
  paintCompte({ user: state.user, historyCount: state.history.length });
  try {
    await saving;
    const res = await fetch('/api/sessions');
    const data = await res.json().catch(() => ({}));
    if (res.ok) state.history = data.sessions;
  } catch {
    // The page still shows with the last known count.
  }
  if (state.screen === 'compte') paintCompte({ user: state.user, historyCount: state.history.length });
}

function bindAuth() {
  let mode = 'login';
  const form = $('auth-form');
  const password = $('auth-password');
  const submit = $('auth-submit');
  const error = $('auth-error');

  const paint = () => {
    const register = mode === 'register';
    $('auth-title').textContent = register ? 'Créer un compte' : 'Connexion';
    $('auth-lead').textContent = register
      ? 'Ce compte reste sur cet appareil et garde vos oraux.'
      : 'Retrouvez les oraux enregistrés sur cet appareil.';
    submit.textContent = register ? 'Créer le compte' : 'Se connecter';
    $('auth-switch').textContent = register ? 'J\'ai déjà un compte' : 'Créer un compte';
    $('auth-name-field').hidden = !register;
    $('auth-name').required = register;
    password.autocomplete = register ? 'new-password' : 'current-password';
  };

  $('auth-switch').onclick = () => {
    mode = mode === 'login' ? 'register' : 'login';
    error.textContent = '';
    paint();
    (mode === 'register' ? $('auth-name') : $('auth-email')).focus();
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    error.textContent = '';
    const body = { email: $('auth-email').value.trim(), password: password.value };
    if (mode === 'register') body.name = $('auth-name').value.trim();
    submit.disabled = true;
    const previous = submit.textContent;
    submit.textContent = mode === 'register' ? 'Création…' : 'Connexion…';
    try {
      const res = await fetch(mode === 'register' ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        error.textContent = data.error || 'La connexion a échoué.';
        return;
      }
      enter(data.user);
    } catch {
      error.textContent = 'La connexion a échoué.';
    } finally {
      submit.disabled = false;
      if (!state.user) submit.textContent = previous;
    }
  };

  paint();
  $('screen-login').hidden = false;
  void setupGoogle(error);
  $('auth-email').focus();
}

function inMacApp() {
  return navigator.userAgent.includes('Electron');
}

function showGoogleChoice() {
  $('auth-or').hidden = false;
}

async function pollGoogle(loginState, error) {
  const lead = $('auth-lead');
  const previous = lead.textContent;
  lead.textContent = 'Terminez la connexion dans le navigateur, puis revenez ici.';
  const started = Date.now();
  while (!state.user && Date.now() - started < 5 * 60 * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const res = await fetch(`/api/auth/google/pending?state=${encodeURIComponent(loginState)}`).catch(() => null);
    if (!res || res.status === 204) continue;
    const data = await res.json().catch(() => ({}));
    sessionStorage.removeItem('oral.googleState');
    if (!res.ok) {
      lead.textContent = previous;
      error.textContent = data.error || 'La connexion Google a échoué.';
      return;
    }
    enter(data.user);
    return;
  }
  if (!state.user) {
    sessionStorage.removeItem('oral.googleState');
    lead.textContent = previous;
    error.textContent = 'La connexion Google a expiré.';
  }
}

async function startGoogle(error, desktop) {
  error.textContent = '';
  const button = $('google-app');
  button.disabled = true;
  try {
    const res = await fetch('/api/auth/google/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desktop }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      error.textContent = data.error || 'La connexion Google a échoué.';
      return;
    }
    if (desktop) {
      sessionStorage.setItem('oral.googleState', data.state);
      window.open(data.url);
      void pollGoogle(data.state, error);
      return;
    }
    location.assign(data.url);
  } catch {
    error.textContent = 'La connexion Google a échoué.';
  } finally {
    button.disabled = false;
  }
}

async function setupGoogle(error) {
  let config;
  try {
    config = await fetch('/api/auth/config').then((res) => res.json());
  } catch {
    return;
  }
  if (!config?.googleClientId || state.user) return;
  const button = $('google-app');
  button.hidden = false;
  showGoogleChoice();
  button.onclick = () => { void startGoogle(error, inMacApp()); };
  if (inMacApp()) {
    const pending = sessionStorage.getItem('oral.googleState');
    if (pending) void pollGoogle(pending, error);
  }
}

async function gate() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        enter(data.user);
        return;
      }
    }
  } catch {
    // The form still lets the learner try again once the server answers.
  }
  bindAuth();
}

function boot() {
  if (booted) return;
  booted = true;
  const meter = $('meter');
  for (let i = 0; i < 28; i++) meter.append(document.createElement('span'));
  $('notes').value = sessionStorage.getItem(`oral-notes:${state.sujetId}`) || '';
  $('notes').addEventListener('input', () => sessionStorage.setItem(`oral-notes:${state.sujetId}`, $('notes').value));
  $('prep-start').onclick = togglePrep;
  $('prep-reset').onclick = resetPrep;
  $('to-parler').onclick = () => {
    state.example = false;
    show('parler');
    paintParler();
    fetch('/api/warm').catch(() => {});
  };
  $('to-example').onclick = () => {
    state.example = true;
    state.retourTab = 'monologue';
    goRetour();
  };
  $('to-historique').onclick = () => {
    if (state.screen !== 'historique') void openHistory();
  };
  $('to-compte').onclick = () => {
    if (state.screen !== 'compte') void openCompte();
  };
  $('to-pratique').onclick = () => {
    if (state.screen === 'historique' || state.screen === 'compte' || state.archive) goPratique();
  };
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.target.closest?.('textarea, input, dialog')) return;
    if (state.archive) void openHistory();
    else if (state.screen === 'historique' || state.screen === 'compte') goPratique();
  });
  $('brand').onclick = () => {
    if (state.screen === 'historique' || state.screen === 'compte' || state.archive) {
      goPratique();
      return;
    }
    if (state.screen !== 'sujet' && !confirmLeave()) return;
    resetSession();
    show('sujet');
    renderSujets();
  };
  $('record').onclick = () => {
    if (state.phase === 'recording') {
      state.recorder?.stop();
      return;
    }
    cancelArm();
    void startRecording();
  };
  renderSujets();
  renderDocument();
  paintPrep();
  show('sujet');
  onPrefs((prefs) => {
    syncPrepFromPrefs(prefs);
    if (!prefs.autoArmDebate) cancelArm();
    else if (state.screen === 'parler' && isDebate() && state.phase === 'ready' && currentQuestion() && !state.closing) {
      armDebate();
    }
    if (state.screen === 'parler') paintParler();
    if (state.screen === 'retour') renderRetour();
    if (state.screen === 'compte') paintCompte({ user: state.user, historyCount: state.history.length });
  });
  void loadHealth();
}

function syncPrepFromPrefs(prefs) {
  const running = Boolean(state.prepTimer);
  const untouched = !running && state.prepLeft === state.prepChoice;
  if (!untouched) return;
  state.prepChoice = prefs.prepSeconds;
  state.prepLeft = prefs.prepSeconds;
  if (state.screen === 'sujet') paintPrep();
}

gate();
