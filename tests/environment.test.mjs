import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = new URL('../skills/lyric-driven-code-mv/', import.meta.url);
const exporter = fileURLToPath(new URL('assets/templates/starter/export.mjs', skill));

test('environment check reports required media tools and supports missing-only output', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('scripts/check-environment.mjs', skill)), '--missing-only'], {
    encoding: 'utf8',
    env: { ...process.env, FFMPEG_PATH: 'missing-ffmpeg-for-test', FFPROBE_PATH: 'missing-ffprobe-for-test' },
  });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'needs_setup');
  assert.deepEqual(report.checks.filter(check => check.required).map(check => check.name), ['ffmpeg', 'ffprobe']);
  assert.ok(report.checks.every(check => !check.ok && check.fix));
});

test('FFmpeg without ASS support reports an actionable error from the shared probe', async () => {
  const { checkMediaTools } = await import(new URL('assets/templates/starter/media-preflight.mjs', skill));
  const outputs = new Map([
    ['-filters', ' T. scale V->V Scale the input video'],
    ['-encoders', ' V....D libx264 H.264\n A....D aac AAC'],
    ['-version', 'ffprobe version example'],
  ]);
  const checks = checkMediaTools('ffmpeg', 'ffprobe', (_binary, args) => ({ status: 0, stdout: outputs.get(args.at(-1)) }));
  assert.deepEqual(checks.filter(check => !check.ok).map(check => check.name), ['libass']);
  assert.match(checks.find(check => check.name === 'libass').detail, /字幕无法烧录/);
});

test('subtitle stills and MP4s stop before rendering if the FFmpeg executable lacks ASS', t => {
  const root = mkdtempSync(join(tmpdir(), 'lyric-no-ass-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const shim = `
    const childProcess = require('node:child_process');
    childProcess.spawnSync = (binary, args) => {
      if (binary === 'ffprobe-fixture') return { status: 0, stdout: 'ffprobe version fixture' };
      if (args.includes('-filters')) return { status: 0, stdout: ' .. scale V->V Scale video' };
      if (args.includes('-encoders')) return { status: 0, stdout: ' V..... libx264 H.264\\n A..... aac AAC' };
      return { status: 1, stderr: Buffer.from("No such filter: 'ass'") };
    };
    require('node:module').syncBuiltinESMExports();
    import(require('node:url').pathToFileURL(process.argv[1]).href);
  `;
  const still = join(root, 'still', 'frame.png');
  const video = join(root, 'video', 'video.mp4');
  for (const args of [
    ['--frame-time', '1', '--frame-out', still, '--frame-final'],
    ['--out', video],
  ]) {
    const result = spawnSync(process.execPath, [
      '-e', shim, exporter, '--ffmpeg', 'ffmpeg-fixture', '--ffprobe', 'ffprobe-fixture', ...args,
    ], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /libass.*字幕无法烧录/);
    assert.doesNotMatch(result.stderr, /No such filter/);
  }
  assert.equal(existsSync(join(root, 'still')), false);
  assert.equal(existsSync(join(root, 'video')), false);
});

test('the starter can write recoverable demo frames and subtitle files without media executables', t => {
  const root = mkdtempSync(join(tmpdir(), 'lyric-demo-frames-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [
    exporter, '--frames-dir', root, '--frames-only', '--fps', '1',
    '--ffmpeg', join(root, 'missing-ffmpeg'), '--ffprobe', join(root, 'missing-ffprobe'),
  ], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  for (const name of ['frame-000000.png', 'frame-000011.png', 'audio.wav', 'subtitles.ass', 'asset-manifest.json', 'render-config.json']) {
    assert.ok(existsSync(join(root, name)), name);
  }
});
