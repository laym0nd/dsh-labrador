// The host half's contract: configuration, and the action library it serves.
// Run with: node tools/host.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, DEFAULT_CONFIG, TEMPERAMENTS } from '../lib/config.js';

/** Write a config home and hand back its path. */
function withConfig(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'labrador-config-'));
  if (contents !== undefined) writeFileSync(join(dir, 'main-config.json'), contents);
  return dir;
}

test('with no config file, the defaults apply and nothing is complained about', () => {
  const dir = withConfig(undefined);
  const { config, warnings } = readConfig(dir);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.deepEqual(warnings, []);
  rmSync(dir, { recursive: true, force: true });
});

test('a valid config is obeyed', () => {
  const dir = withConfig(JSON.stringify({ temperament: 'lively' }));
  const { config, warnings } = readConfig(dir);
  assert.equal(config.temperament, 'lively');
  assert.deepEqual(warnings, []);
  rmSync(dir, { recursive: true, force: true });
});

test('every temperament the rules know is accepted', () => {
  for (const temperament of TEMPERAMENTS) {
    const dir = withConfig(JSON.stringify({ temperament }));
    const { config, warnings } = readConfig(dir);
    assert.equal(config.temperament, temperament);
    assert.deepEqual(warnings, [], `${temperament} should need no complaint`);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an illegal temperament is reported and the default kept', () => {
  const dir = withConfig(JSON.stringify({ temperament: 'ferocious' }));
  const { config, warnings } = readConfig(dir);
  assert.equal(config.temperament, DEFAULT_CONFIG.temperament);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ferocious/);
  rmSync(dir, { recursive: true, force: true });
});

// The dog lives in the harness window and nowhere else, so a leftover display
// setting does nothing. Saying so beats letting someone wonder why.
test('a stale display setting is reported as having no effect', () => {
  const dir = withConfig(JSON.stringify({ display: 'desktop', temperament: 'calm' }));
  const { config, warnings } = readConfig(dir);
  assert.equal(config.temperament, 'calm');
  assert.equal(config.display, undefined, 'display is gone from the configuration');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /display/);
  rmSync(dir, { recursive: true, force: true });
});

test('malformed JSON is reported, not thrown', () => {
  const dir = withConfig('{ this is not json');
  const { config, warnings } = readConfig(dir);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(warnings.length, 1);
  rmSync(dir, { recursive: true, force: true });
});
