# Android share-target wrapper

This Trusted Web Activity wrapper gives Android a native `ACTION_SEND` handler for `text/plain`.
It forwards shared titles, text, and URLs to the hosted PWA's `/share` route.

Build a local debug APK on Windows:

```text
gradlew.bat assembleDebug
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`. Debug builds are suitable for
local sideload testing only. A public download must be signed with a backed-up release key and the
matching SHA-256 fingerprint must be published in `/.well-known/assetlinks.json` so the wrapper
opens as a verified Trusted Web Activity rather than a Custom Tab.
