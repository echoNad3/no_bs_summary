import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Android share-target wrapper', () => {
  it('registers a native exported text share target without notification access', async () => {
    const manifest = await fs.readFile('apps/android/app/src/main/AndroidManifest.xml', 'utf8');

    expect(manifest).toContain('package="dev.echonad3.nobssummary"');
    expect(manifest).toContain('android:name="LauncherActivity"');
    expect(manifest).toContain('android:exported="true"');
    expect(manifest).toContain('android.support.customtabs.trusted.METADATA_SHARE_TARGET');
    expect(manifest).toContain('android.intent.action.SEND');
    expect(manifest).toContain('android:mimeType="text/plain"');
    expect(manifest).not.toContain('android.permission.POST_NOTIFICATIONS');
  });

  it('forwards shared values to the production PWA share route', async () => {
    const wrapperManifest = JSON.parse(
      await fs.readFile('apps/android/twa-manifest.json', 'utf8'),
    ) as Record<string, unknown>;

    expect(wrapperManifest).toMatchObject({
      packageId: 'dev.echonad3.nobssummary',
      host: 'no-bullshit-summary.echonad3.workers.dev',
      appVersionName: '0.3.2',
      enableNotifications: false,
      shareTarget: {
        action: 'https://no-bullshit-summary.echonad3.workers.dev/share',
        method: 'GET',
        enctype: 'application/x-www-form-urlencoded',
        params: { title: 'title', text: 'text', url: 'url' },
      },
    });
  });
});
