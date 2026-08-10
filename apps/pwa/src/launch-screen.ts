import { Capacitor, registerPlugin } from '@capacitor/core';

interface LaunchScreenPlugin {
  hide(): Promise<void>;
}

interface LegacySplashScreenPlugin {
  hide(options?: { fadeOutDuration?: number }): Promise<void>;
}

const launchScreen = registerPlugin<LaunchScreenPlugin>('LaunchScreen');
const legacySplashScreen = registerPlugin<LegacySplashScreenPlugin>('SplashScreen');

export async function hideLaunchScreen(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await launchScreen.hide();
  } catch {
    await legacySplashScreen.hide({ fadeOutDuration: 0 }).catch(() => undefined);
  }
}
