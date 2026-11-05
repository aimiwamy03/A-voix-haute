# À voix haute

Practice the oral exam: read a short opinion piece, record a two-minute answer, then debate the examiner for three short turns. Compare each verbatim transcript with a stronger version.

## Run

```bash
cp .env.example .env
npm install
npm start
```

`npm start` opens the Mac app. `npm run server` keeps the browser version at http://127.0.0.1:3000. `npm run dist` builds `dist/mac-arm64/A voix haute.app`.

Sign in before practicing. Accounts stay on this machine, and each account keeps its own history. The first account picks up any orals saved before sign-in existed.

To offer Google sign-in, put a web client id in `GOOGLE_CLIENT_ID` and the matching client secret in `GOOGLE_CLIENT_SECRET`. In Google Cloud, add these Authorized redirect URIs exactly:

- `http://127.0.0.1:47821/api/auth/google/callback`
- `http://127.0.0.1:3000/api/auth/google/callback`

Also add Authorized JavaScript origins `http://127.0.0.1:47821` and `http://127.0.0.1:3000` (no path, no trailing slash). The Mac app opens Google in the browser, then brings the account back into the window. Rebuild with `npm run dist` after changing `.env`, because the Mac app copies that file.

The hosted site is set with `PUBLIC_URL`. `npm start` still opens the Mac app; the public server is `node server/main.js` with `HOST=0.0.0.0`.

Put `ASSEMBLYAI_API_KEY` and `ANTHROPIC_API_KEY` in `.env`. The browser never receives those keys. Set `LLM_PROVIDER=openai` only if you want OpenAI instead.

## Check a recording

```bash
npm test
npm run probe -- clips/mon-essai.wav
```

The probe prints `text` and the stronger version. `text` should keep learner mistakes.
