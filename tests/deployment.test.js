import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { experimental_readRawConfig } from 'wrangler';

const root = fileURLToPath(new URL('..', import.meta.url));

test('a dedicated Worker serves only the built Playload pages, rebuilt by Wrangler', () => {
  const { rawConfig: config } = experimental_readRawConfig({ config: root + 'wrangler.jsonc' });
  const { $schema, compatibility_date: compatibilityDate, build, ...deployment } = config;
  assert.equal($schema, './node_modules/wrangler/config-schema.json');
  assert.match(compatibilityDate, /^\d{4}-\d{2}-\d{2}$/);
  // An exact match also rejects additions such as "main", which would run Worker code.
  assert.deepEqual(deployment, {
    name: 'playload',
    workers_dev: false,
    preview_urls: false,
    // The prefix pattern also matches /playload?query, which Static Assets redirects with a 307.
    routes: [{ pattern: 'kitao.dev/playload*', zone_name: 'kitao.dev' }],
    assets: { directory: './dist' },
  });
  assert.equal(build.command, 'node scripts/build.js');
  // wrangler dev rebuilds when a watched source changes; watching dist/ would loop.
  for (const path of build.watch_dir) {
    assert(existsSync(root + path), path);
    assert.doesNotMatch(path, /^dist(\/|$)/);
  }
});
