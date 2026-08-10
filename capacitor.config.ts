import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.echonad3.nobssummary',
  appName: 'No BS Summary',
  webDir: 'dist/pwa',
  backgroundColor: '#161616',
  android: {
    path: 'apps/android',
    backgroundColor: '#161616',
  },
  server: {
    url: 'https://no-bs-summary.echonad3.workers.dev/',
    cleartext: false,
  },
};

export default config;
