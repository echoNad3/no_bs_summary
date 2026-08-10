# No BS Summary

Paste or share a YouTube link. Get a blunt `WATCH`, `SKIM`, or `SKIP` verdict and the useful points.

[Open the app](https://no-bullshit-summary.echonad3.workers.dev) ·
[Chrome Web Store](https://chromewebstore.google.com/detail/no-bs-summary/fnphiadakmbpimdclfohfpbbliejhnmc) ·
[Android APK](https://github.com/echoNad3/no_bullshit_summary/releases/latest/download/app-debug.apk)

Completed summaries are cached in Cloudflare KV, so repeating the same video does not spend another transcript or Gemini request. No captions means no summary, and transcripts are not stored.

## Use it

Android:

1. Install `app-debug.apk` from the latest GitHub release.
2. If Android asks, allow installs from your browser or file manager.
3. Open **Settings** and enter the shared app password.
4. In YouTube or ReVanced, use **Share → More → No BS Summary**.

The Chrome-installed PWA is not reliable as an Android share target because some installations are only shortcuts. The native app in `apps/android` registers `ACTION_SEND` directly and therefore appears in the system share sheet.

Chrome:

1. Install or load the extension.
2. Open a YouTube video and the No BS Summary side panel.
3. Enter the shared password in **Settings**.
4. Select **Cut the BS**.

## Change the shared password

The accepted password is the Cloudflare Worker secret. In Windows PowerShell, run:

```text
npx.cmd wrangler secret put APP_PASSWORD
```

On other shells, use `npx wrangler secret put APP_PASSWORD`. Enter the same password in the app or extension Settings afterward.

## Development

Requires Node.js 24+.

```text
npm install
copy .env.example .env
npm run build
npm test
```

Useful checks:

```text
npm run format:check
npm run typecheck
npm run check:bundles
npm run smoke:a11y
npm run android:sync
```

`npm run smoke:extension` needs a local Worker on port 8787. Provider keys stay on the server. TranscriptAPI account usage is available at [TranscriptAPI billing](https://transcriptapi.com/billing).

## Deployment

The web app and API run on a Cloudflare Worker configured by `wrangler.jsonc`. `npm run deploy` builds and deploys them. The Chrome extension is built into `dist/extension`.

`apps/android` is a Capacitor app around the production site. GitHub Actions assigns each build an increasing Android `versionCode`, signs it with the committed stable update key, validates the project, and publishes `app-debug.apk` as the latest GitHub release. See [apps/android/README.md](apps/android/README.md).

MIT licensed.
