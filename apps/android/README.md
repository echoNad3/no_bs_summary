# Android app

The Android client is a Capacitor shell around the live production site. Unlike the previous TWA,
it registers a native `ACTION_SEND` handler, so it appears in Android's system share sheet without
depending on Chrome's WebAPK registration.

Native features:

- receives `text/plain` shares and opens `/share` with the shared YouTube text;
- downloads updates through Android's `DownloadManager`;
- validates package name, build number, and signing certificate before installation;
- uses one stable debug signing certificate so sideloaded builds update in place;
- keeps the launch logo on Android's vector splash path to avoid blurred raster scaling.

`npm run android:sync` builds the web app and refreshes the Capacitor project. GitHub Actions builds
and publishes `app-debug.apk` at the repository's latest-release download URL.
