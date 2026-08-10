import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.echonad3.nobssummary',
  appName: 'No BS Summary',
  webDir: 'dist/pwa',
  backgroundColor: '#0d0f12',
  android: {
    path: 'apps/android',
    backgroundColor: '#0d0f12',
  },
  server: {
    url: 'https://no-bs-summary.echonad3.workers.dev/',
    cleartext: false,
  },
};

export default config;
