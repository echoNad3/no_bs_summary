# No BS Summary

A phone-first YouTube summarizer with blunt `WATCH`, `SKIM`, or `SKIP` verdicts.

[Open the app](https://no-bs-summary.echonad3.workers.dev) ·
[Chrome extension](https://chromewebstore.google.com/detail/no-bs-summary/fnphiadakmbpimdclfohfpbbliejhnmc) ·
[Download the Android APK](https://github.com/echoNad3/no_bs_summary/releases/latest/download/app-debug.apk)

- Accepts pasted links and Android shares from YouTube or ReVanced.
- Uses existing captions; videos without captions are rejected.
- Reopens completed summaries from the shared Cloudflare cache.
- Allows five passwordless live-summary attempts per network each month, inside a shared monthly pool of 50.
- Keeps provider keys and the shared password on the Worker.
- Updates the Android app from Settings and verifies every APK before installation.

## Android

Install the latest APK. Leave Settings password blank for limited free access, or enter the shared
app password for owner access. The native app registers directly with Android, so it appears under
**Share → More → No BS Summary**.

The website installed through Chrome is a PWA, not the native share target.

## Development

Requires Node.js 24.

```sh
npm install
copy .dev.vars.example .dev.vars
npm run dev
npm test
npm run typecheck
npm run build
```

Useful maintenance commands:

```sh
npm run assets
npm run smoke:a11y
npm run smoke:extension
npm run smoke:worker
npm run package:extension
npm run android:sync
```

Change the server password with `npx.cmd wrangler secret put APP_PASSWORD` on Windows or
`npx wrangler secret put APP_PASSWORD` on other shells. Enter the same password in app Settings.

Paid generation attempts are reserved atomically by the `GENERATION_QUOTA` Durable Object. The
defaults are 300 total attempts per UTC day, five passwordless attempts per network per UTC month,
and 50 passwordless attempts shared per UTC month. Change them in `wrangler.jsonc`. Cached summaries
do not consume any limit.

The web app and API deploy with `npm run deploy`. The unpacked extension builds to
`dist/extension`; its Chrome Web Store ZIP is `dist/no-bs-summary-extension.zip`.
