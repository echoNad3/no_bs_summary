import { Capacitor, registerPlugin } from '@capacitor/core';

interface LaunchScreenPlugin {
  hide(): Promise<void>;
}

const launchScreen = registerPlugin<LaunchScreenPlugin>('LaunchScreen');

export async function hideLaunchScreen(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await launchScreen.hide().catch(() => undefined);
}
