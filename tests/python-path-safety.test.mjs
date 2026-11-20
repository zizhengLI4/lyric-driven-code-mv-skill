import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const probe = spawnSync(python, ['-c', 'from PIL import Image; print("ok")'], { encoding: 'utf8', windowsHide: true });
const options = probe.status === 0 ? {} : { skip: 'Python Pillow is required by these image CLI integrations' };
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p6sAAAAASUVORK5CYII=', 'base64');
const run = (script, args, env = process.env) => spawnSync(python, [script, ...args], { encoding: 'utf8', windowsHide: true, env });
const awaitFileExists = path => { try { readFileSync(path); return true; } catch { return false; } };

test('film-sheet removes temporary video frames after building the contact sheet', options, t => {
  const dir = mkdtempSync(join(tmpdir(), 'film-sheet-temp-cleanup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const temporaryRoot = join(dir, 'temporary');
  const frameDirectory = join(dir, 'frames');
  mkdirSync(temporaryRoot);
  mkdirSync(frameDirectory);
  writeFileSync(join(frameDirectory, 'frame.png'), tinyPng);
  const env = { ...process.env, TEMP: temporaryRoot, TMP: temporaryRoot, TMPDIR: temporaryRoot };
  const result = run('skills/lyric-driven-code-mv/scripts/film-sheet.py', [frameDirectory, '--out', join(dir, 'sheet.jpg')], env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(temporaryRoot), []);
});

test('safe-area refuses an overlay output that aliases the input image', options, t => {
  const dir = mkdtempSync(join(tmpdir(), 'safe-area-alias-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const image = join(dir, 'frame.png');
  writeFileSync(image, tinyPng);
  const before = readFileSync(image);
  const result = run('skills/lyric-driven-code-mv/scripts/safe-area.py', ['--overlay', image, '--out', image, '--no-labels']);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /输出.*输入|覆盖|alias/i);
  assert.deepEqual(readFileSync(image), before);
});

test('pixel-font refuses to overwrite its input font or alias its outputs', options, t => {
  const dir = mkdtempSync(join(tmpdir(), 'pixel-font-alias-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const font = join(dir, 'source-font.bin');
  writeFileSync(font, Buffer.from('preserve font bytes'));
  const before = readFileSync(font);
  const result = run('skills/lyric-driven-code-mv/scripts/pixel-font.py', ['--charset', 'AB', '--font', font, '--out', font, '--json', join(dir, 'glyphs.json')]);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /输出.*输入|覆盖|alias/i);
  assert.deepEqual(readFileSync(font), before);

  const sharedOutput = join(dir, 'shared-output.png');
  const duplicate = run('skills/lyric-driven-code-mv/scripts/pixel-font.py', ['--charset', 'AB', '--font', font, '--out', sharedOutput, '--json', sharedOutput]);
  assert.notEqual(duplicate.status, 0, duplicate.stdout);
  assert.match(duplicate.stderr, /多个输出|same file|alias/i);
  assert.equal(awaitFileExists(sharedOutput), false);
});

test('safe-area refuses to overwrite its video input through multiple frame outputs', options, t => {
  const dir = mkdtempSync(join(tmpdir(), 'safe-video-alias-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'frame_1.png');
  writeFileSync(source, tinyPng);
  const before = readFileSync(source);
  const result = run('skills/lyric-driven-code-mv/scripts/safe-area.py', ['--video', source, '--at', '1', '-o', join(dir, 'frame.png')]);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /输出.*输入|覆盖|alias/i);
  assert.deepEqual(readFileSync(source), before);
});

test('film-sheet refuses to overwrite a source frame in the input directory', options, t => {
  const dir = mkdtempSync(join(tmpdir(), 'film-sheet-alias-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const image = join(dir, 'frame.png');
  writeFileSync(image, tinyPng);
  const before = readFileSync(image);
  const result = run('skills/lyric-driven-code-mv/scripts/film-sheet.py', [dir, '--out', image]);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /输出.*输入|覆盖|alias/i);
  assert.deepEqual(readFileSync(image), before);
});
