# À voix haute

A debate trainer for people who already have some French and need to *use* it.

Duolingo is good at getting you interested: streaks, hearts, a little vocabulary, a sense that you are learning. Then it stops holding your hand. You can tap the right word and still freeze when someone asks what you think, asks you to defend it, and waits for you to keep talking.

**À voix haute** is the practice that comes after that. It is built around a French oral exam loop: a real document, a timed preparation, a two-minute monologue, then a short debate with an examiner. You hear yourself back as a transcript, next to a stronger version of the same answer, with a few precise corrections instead of a vague score.

The interface is in French. So are the sujets. The point is not to collect points. The point is to get used to arguing out loud.

## Who it is for

- Learners who can already read a newspaper paragraph in French and now need to speak
- People preparing a DELF-style production orale
- Anyone who wants debate practice: a position, examples, a reply when the examiner pushes back

It is not a beginner course. There is no tree of lessons, no cartoon owl, no “almost” for a multiple-choice tap. You pick a subject, you prepare, you talk.

## What a session looks like

1. **Sujet** — Choose a short opinion piece (work, school, the city, consumption). Prepare with a timer. Write notes if you want; they are not graded.
2. **Parler** — Record a ~2 minute monologue. Then the examiner asks follow-up questions for three short turns. You answer each one out loud.
3. **Retour** — See your verbatim transcript beside a stronger rewrite. Keep your mistakes in the left column; the right column is what a clearer C1-style answer could have been. Three quoted fixes, plus a structure check.

That is the whole loop: document → timed prep → speak → defend → compare.

## What you can set

Réglages (from **Compte**, or the avatar) keep practice preferences on this machine:

- Preparation length: 5 min, 10 min, or 30 min (exam)
- Auto-arm the mic after each examiner question
- Show or hide your notes while you speak
- Mark words the recognizer was unsure about
- Background palette

**Compte** is the profile page: your practice summary, name, email, password (if you have one), history, and sign out.

Accounts stay on this computer. Each account keeps its own oral history.

## Run

```bash
cp .env.example .env
npm install
npm start
```

`npm start` opens the Mac app. `npm run server` keeps the browser version at http://127.0.0.1:3000. `npm run dist` builds `dist/mac-arm64/A voix haute.app`.

You need keys in `.env`. The browser never receives them.

- `ASSEMBLYAI_API_KEY` — transcription
- `ANTHROPIC_API_KEY` — the stronger version and examiner turns (`LLM_PROVIDER=openai` if you would rather use OpenAI)

### Google sign-in (optional)

Put a web client id in `GOOGLE_CLIENT_ID` and the matching secret in `GOOGLE_CLIENT_SECRET`. In Google Cloud, add these Authorized redirect URIs exactly:

- `http://127.0.0.1:47821/api/auth/google/callback`
- `http://127.0.0.1:3000/api/auth/google/callback`

Also add Authorized JavaScript origins `http://127.0.0.1:47821` and `http://127.0.0.1:3000` (no path, no trailing slash). The Mac app opens Google in the browser, then brings the account back into the window. Rebuild with `npm run dist` after changing `.env`, because the Mac app copies that file.

The hosted site is set with `PUBLIC_URL`. `npm start` still opens the Mac app; the public server is `node server/main.js` with `HOST=0.0.0.0`.

## Check a recording

```bash
npm test
npm run probe -- clips/mon-essai.wav
```

The probe prints `text` and the stronger version. `text` should keep learner mistakes.
