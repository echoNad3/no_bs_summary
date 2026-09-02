import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('native Android app', () => {
  it('registers an exported native text share target', async () => {
    const manifest = await fs.readFile('apps/android/app/src/main/AndroidManifest.xml', 'utf8');

    expect(manifest).toContain('android:name=".MainActivity"');
    expect(manifest).toContain('android:exported="true"');
    expect(manifest).toContain('android.intent.action.SEND');
    expect(manifest).toContain('android:mimeType="text/plain"');
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(manifest).toContain('android.permission.REQUEST_INSTALL_PACKAGES');
    expect(manifest).not.toContain('android.permission.POST_NOTIFICATIONS');
    expect(manifest).not.toContain('customtabs.trusted');
  });

  it('forwards ReVanced text shares into the hosted share route', async () => {
    const activity = await fs.readFile(
      'apps/android/app/src/main/java/dev/echonad3/nobssummary/MainActivity.java',
      'utf8',
    );

    expect(activity).toContain('Intent.ACTION_SEND');
    expect(activity).toContain('Intent.EXTRA_TEXT');
    expect(activity).toContain('Intent.EXTRA_SUBJECT');
    expect(activity).toContain('no-bs-summary.echonad3.workers.dev/share');
    expect(activity).toContain('appendQueryParameter("text"');
    expect(activity).toContain('getWebView().loadUrl(targetUrl)');
  });

  it('validates downloaded updates before opening Android installer', async () => {
    const [updater, build, wrapper, config, key] = await Promise.all([
      fs.readFile(
        'apps/android/app/src/main/java/dev/echonad3/nobssummary/AppUpdaterPlugin.java',
        'utf8',
      ),
      fs.readFile('apps/android/app/build.gradle', 'utf8'),
      fs.readFile('apps/android/gradle/wrapper/gradle-wrapper.properties', 'utf8'),
      fs.readFile('capacitor.config.ts', 'utf8'),
      fs.stat('apps/android/app/debug-signing.p12'),
    ]);

    expect(updater).toContain(
      'github.com/echoNad3/no_bs_summary/releases/latest/download/app-debug.apk',
    );
    expect(updater).toContain('context.getPackageName().equals(archive.packageName)');
    expect(updater).toContain('downloadedBuild >= installedBuild');
    expect(updater).toContain('signaturesMatch(installed, archive)');
    expect(build).toContain("project.hasProperty('appBuildNumber')");
    expect(build).toContain("storeFile file('debug-signing.p12')");
    expect(wrapper).toContain('gradle-8.14.3-all.zip');
    expect(config).toContain("path: 'apps/android'");
    expect(config).toContain('no-bs-summary.echonad3.workers.dev');
    expect(key.size).toBeGreaterThan(1_000);
  });

  it('keeps Android 12 splash rendering on the vector surface path', async () => {
    const [activity, vector, animated, animator, styles] = await Promise.all([
      fs.readFile(
        'apps/android/app/src/main/java/dev/echonad3/nobssummary/MainActivity.java',
        'utf8',
      ),
      fs.readFile('apps/android/app/src/main/res/drawable/splash_logo_vector.xml', 'utf8'),
      fs.readFile('apps/android/app/src/main/res/drawable-v31/splash_logo.xml', 'utf8'),
      fs.readFile('apps/android/app/src/main/res/animator/splash_logo_hold.xml', 'utf8'),
      fs.readFile('apps/android/app/src/main/res/values/styles.xml', 'utf8'),
    ]);

    expect((activity.match(/installSplashScreen\(this\)/gu) ?? []).length).toBe(1);
    expect(activity.indexOf('installSplashScreen(this)')).toBeLessThan(
      activity.indexOf('super.onCreate(savedInstanceState)'),
    );
    expect(vector).toContain('android:name="splash_vector_anchor"');
    expect(vector).toContain('android:viewportWidth="512"');
    expect(vector).toContain('android:scaleX="0.75"');
    expect(vector).toContain('android:translateX="64"');
    expect(vector).toContain('android:translateY="64"');
    expect(animated).toContain('<animated-vector');
    expect(animated).toContain('@animator/splash_logo_hold');
    expect(animator).toContain('android:duration="1"');
    expect(styles).toContain('<item name="windowSplashScreenAnimationDuration">1</item>');
    await expect(
      fs.stat('apps/android/app/src/main/res/drawable-xxxhdpi/splash.png'),
    ).rejects.toThrow();
  });
});
