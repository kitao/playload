import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function deploy(args = [], env = process.env, spawn = spawnSync) {
  // Environment credentials take precedence over OAuth, including keyring
  // storage. Reject them without ever including their values in an error.
  if (
    ['CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_KEY'].some((k) => env[k])
  )
    throw new Error('Deploy requires OAuth in the OS keychain. Unset Cloudflare API credentials.');
  const wrangler = join(
    dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),
    'bin/wrangler.js',
  );
  const result = spawn(process.execPath, [wrangler, 'deploy', ...args], {
    stdio: 'inherit',
    // Fail if the keyring backend is unavailable; never fall back to plaintext.
    env: { ...env, CLOUDFLARE_AUTH_USE_KEYRING: 'true' },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = deploy(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
