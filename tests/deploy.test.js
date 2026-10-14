import test from 'node:test';
import assert from 'node:assert/strict';
import { deploy } from '../scripts/deploy.js';

test('deploy refuses environment API credentials before starting Wrangler and never prints their values', () => {
  for (const key of ['CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_KEY']) {
    const secret = 'credential-must-never-appear-in-errors';
    let started = false;
    assert.throws(
      () =>
        deploy([], { [key]: secret }, () => {
          started = true;
        }),
      (error) => {
        assert.match(error.message, /OS keychain/);
        assert(!error.message.includes(secret));
        return true;
      },
    );
    assert.equal(started, false);
  }
});

test('deploy requires keyring storage even if the caller disables it, preserves CLI flags and reports failure', () => {
  const env = { CLOUDFLARE_AUTH_USE_KEYRING: 'false', PATH: '/example' };
  const status = deploy(['--dry-run'], env, (command, args, options) => {
    assert.equal(command, process.execPath);
    assert.match(args[0], /wrangler[/\\]bin[/\\]wrangler\.js$/);
    assert.deepEqual(args.slice(1), ['deploy', '--dry-run']);
    assert.equal(options.env.CLOUDFLARE_AUTH_USE_KEYRING, 'true');
    assert.equal(options.env.PATH, env.PATH);
    assert.equal(options.stdio, 'inherit');
    return { status: 7 };
  });
  assert.equal(status, 7);
  assert.equal(env.CLOUDFLARE_AUTH_USE_KEYRING, 'false');
});

test('deploy cannot report success when Wrangler fails to start or is terminated', () => {
  const failure = new Error('process failed to start');
  assert.throws(
    () => deploy([], {}, () => ({ error: failure })),
    (error) => error === failure,
  );
  assert.equal(
    deploy([], {}, () => ({ status: null, signal: 'SIGTERM' })),
    1,
  );
});
