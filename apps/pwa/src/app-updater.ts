import { registerPlugin } from '@capacitor/core';

export type AppUpdateStatus =
  'idle' | 'downloading' | 'ready' | 'installing' | 'permission-required' | 'failed';

export interface AppUpdateState {
  status: AppUpdateStatus;
  progress: number;
  detail?: string;
  build?: number;
}

interface AppUpdaterPlugin {
  download(options: { url: string }): Promise<AppUpdateState>;
  getStatus(): Promise<AppUpdateState>;
  install(): Promise<AppUpdateState>;
}

export const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');
