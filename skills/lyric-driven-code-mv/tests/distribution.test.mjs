import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

const skillRoot = new URL('../', import.meta.url);

test('skill distribution includes its Python dependency manifest and test suite', () => {
  assert.ok(existsSync(new URL('requirements.txt', skillRoot)), 'requirements.txt must ship with the skill');
  assert.ok(existsSync(new URL('scripts/check_environment.py', skillRoot)), 'environment preflight must ship with the skill');
  assert.ok(existsSync(new URL('tests/media-tools.mjs', skillRoot)), 'test helper must ship with the skill');
  assert.ok(existsSync(new URL('tests/storyboard.test.mjs', skillRoot)), 'representative tests must ship with the skill');
});
