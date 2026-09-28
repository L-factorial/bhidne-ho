import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const branch = 'bhidne-ho-scalability-prod';
if (process.env.CF_PAGES_BRANCH && process.env.CF_PAGES_BRANCH !== branch) {
  throw new Error(`Production frontend builds require branch ${branch}. Disable other branch previews for this project.`);
}
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
// Cloudflare custom domains are configured in its dashboard. Do not publish
// the existing GitHub Pages CNAME as part of this separate site's export.
rmSync(new URL('../dist/CNAME', import.meta.url), { force: true });
