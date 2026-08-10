# No BS Summary

Paste a YouTube link. Get the point.

[Open the app](https://no-bullshit-summary.echonad3.workers.dev) ·
[Chrome Web Store](https://chromewebstore.google.com/detail/no-bs-summary/fnphiadakmbpimdclfohfpbbliejhnmc)

## What it does

- Summarizes existing YouTube captions.
- Gives a blunt `WATCH`, `SKIM`, or `SKIP` verdict.
- Works as an installable Android app and a Chrome side panel.
- Saves completed summaries in Cloudflare KV. Repeats do not spend another transcript or Gemini request.

No captions means no summary. Transcripts are not stored in the cloud.

## Use it

The hosted app needs the shared app password.

Android:

1. Open the app in Chrome.
2. Tap **Install app**.
3. Add the password in **Settings**.
4. Paste a link or share a YouTube video to the app.

**Share → More** is the correct system share sheet. If No BS Summary is absent there, Android did not register the PWA as a share target. Chrome must install it as a WebAPK; a plain home-screen shortcut is not enough. The native wrapper in `apps/android` is the reliable fallback because it registers an Android `ACTION_SEND` handler directly.

Chrome:

1. Install or load the extension.
2. Open a YouTube video.
3. Open the side panel.
4. Add the password in **Settings**.
5. Click **Cut the BS**.

## Change the shared password

The app does not contain a default password. The accepted password is the Cloudflare Worker secret. From this project directory, change it with:

```text
npx wrangler secret put APP_PASSWORD
```

Enter the new password when prompted, then put the same value in **Settings** in the PWA and extension. The Settings field changes only the copy saved on that device; it does not change the server secret.

## Stack

- Cloudflare Worker and KV
- TranscriptAPI
- Gemini `gemini-3.1-flash-lite`
- TypeScript, Vite, Vitest, Playwright

API keys stay on the server. The browser sends the video link, title, caption language, and app password. Check TranscriptAPI usage at [transcriptapi.com/billing](https://transcriptapi.com/billing).

## Run locally

Requires Node.js 24+.

```text
npm install
copy .env.example .env
npm run build
npm start
```

Add your TranscriptAPI and Gemini keys to `.env`. Open `http://127.0.0.1:8787`.

## Check it

```text
npm run format:check
npm run typecheck
npm test
npm run build
npm run check:bundles
npm run smoke:a11y
```

`npm run smoke:extension` needs the local server running.

## Deploy your own

1. Create a Workers KV namespace and set its ID in `wrangler.jsonc`.
2. Set `GEMINI_API_KEY`, `TRANSCRIPTAPI_API_KEY`, and `APP_PASSWORD` with `wrangler secret put`.
3. Run `npm run deploy`.
4. Set the deployed URL in `apps/extension/src/settings.ts` and rebuild the extension.

## Android wrapper

`apps/android` contains a Trusted Web Activity wrapper with a native `text/plain` share target. See
`apps/android/README.md` for local debug builds and the release-signing requirements.

MIT licensed.
