import { spawnSync } from 'node:child_process';
import path from 'node:path';

const wrangler = path.resolve('node_modules', 'wrangler', 'bin', 'wrangler.js');
const args = [wrangler, 'types', '--env-interface', 'WorkerBindings', '--include-runtime', 'false'];
if (process.argv.includes('--check')) args.push('--check');

const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    WRANGLER_LOG_PATH: path.resolve('.wrangler', 'wrangler.log'),
  },
});
process.exitCode = result.status ?? 1;
