import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const env = {
  ...process.env,
  EXPO_PUBLIC_API_URL: 'https://api.prod.bhidne-ho.lfactorial.com',
  EXPO_PUBLIC_WEB_URL: 'https://prod.bhidne-ho.lfactorial.com',
  EXPO_PUBLIC_RUNTIME_MODE: 'distributed-integration',
};
for (const args of [['run', 'typecheck'], ['run', 'build:web', '--', '--clear']]) {
  const result = spawnSync('npm', args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// The production frontend is served by app-host Nginx, not GitHub Pages.
rmSync(new URL('../dist/CNAME', import.meta.url), { force: true });
