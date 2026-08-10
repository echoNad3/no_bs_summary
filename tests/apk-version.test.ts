import { describe, expect, it } from 'vitest';
import {
  isDownloadedBuildInstallable,
  nextDisplayedDownloadProgress,
} from '../apps/pwa/src/app-update-logic.js';
import { parseBuild, parseLatestApk } from '../apps/pwa/src/apk-version.js';

describe('Android update versioning', () => {
  it('parses only Android release builds', () => {
    expect(parseBuild('android-v123')).toBe(123);
    expect(parseBuild('Android APK build 456')).toBe(456);
    expect(parseBuild('v0.4.0')).toBeNull();
  });

  it('accepts complete positive release metadata', () => {
    expect(parseLatestApk({ build: 12, publishedAt: 500 })).toEqual({
      build: 12,
      publishedAt: 500,
    });
    expect(parseLatestApk({ build: 0, publishedAt: 500 })).toBeNull();
    expect(parseLatestApk({ build: 12 })).toBeNull();
  });

  it('installs only the current downloaded build and never a downgrade', () => {
    expect(isDownloadedBuildInstallable({ status: 'ready', build: 12 }, 12, 11)).toBe(true);
    expect(isDownloadedBuildInstallable({ status: 'permission-required', build: 12 }, 12, 11)).toBe(
      true,
    );
    expect(isDownloadedBuildInstallable({ status: 'ready', build: 11 }, 12, 11)).toBe(false);
    expect(isDownloadedBuildInstallable({ status: 'ready', build: 13 }, null, 12)).toBe(true);
    expect(isDownloadedBuildInstallable({ status: 'ready', build: 11 }, null, 12)).toBe(false);
    expect(isDownloadedBuildInstallable({ status: 'ready', build: 11 }, 10, 11)).toBe(true);
    expect(isDownloadedBuildInstallable({ status: 'downloading', build: 12 }, 12, 11)).toBe(false);
  });

  it('smooths download progress without exceeding the reported value', () => {
    expect(nextDisplayedDownloadProgress(0, 100)).toBe(4);
    expect(nextDisplayedDownloadProgress(20, 22)).toBe(22);
    expect(nextDisplayedDownloadProgress(80, 75)).toBe(80);
  });
});
