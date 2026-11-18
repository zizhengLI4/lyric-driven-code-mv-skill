import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../scripts/check_environment.py', import.meta.url));
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

function run(args, pythonFlags = []) {
  return spawnSync(python, [...pythonFlags, script, '--json', ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
  });
}

function report(result) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.ok(result.stdout.trim(), result.stderr);
  return JSON.parse(result.stdout);
}

test('returns a tri-state report with every environment check', () => {
  const result = run(['--node', process.execPath, '--font', 'sans-serif']);
  assert.equal(result.status, 0, result.stderr);
  const data = report(result);
  assert.ok(['ready', 'partial', 'needs_setup'].includes(data.status));
  assert.equal(data.node_minimum, '17.0.0');
  assert.equal(data.node_test_minimum, '18.1.0');
  for (const name of ['node', 'node_test_runner', 'ffmpeg', 'ffmpeg_ass', 'ffprobe', 'font', 'pillow']) {
    assert.ok(data.checks[name], `missing check: ${name}`);
    assert.ok(['pass', 'fail', 'unknown', 'skipped'].includes(data.checks[name].status));
  }
  assert.equal(data.capabilities.storyboard_validation, data.checks.node.status === 'pass' ? 'available' : 'blocked');
  if (data.checks.ffmpeg_ass.status === 'pass') assert.equal(data.checks.ffmpeg_ass.filter, 'ass');
});

test('reports needs_setup when the Node executable cannot be started', () => {
  const missing = join(tmpdir(), 'lyric-mv-node-does-not-exist-991');
  const result = run(['--node', missing]);
  assert.equal(result.status, 1);
  const data = report(result);
  assert.equal(data.status, 'needs_setup');
  assert.equal(data.checks.node.status, 'fail');
});

test('reports partial when core Node works but media tools and font are unavailable', () => {
  const missing = join(tmpdir(), 'lyric-mv-tool-does-not-exist-991');
  const result = run([
    '--node', process.execPath,
    '--ffmpeg', missing,
    '--ffprobe', missing,
    '--font', join(tmpdir(), 'lyric-mv-font-does-not-exist-991.ttf'),
  ]);
  assert.equal(result.status, 0, result.stderr);
  const data = report(result);
  assert.equal(data.status, 'partial');
  assert.equal(data.checks.node.status, 'pass');
  assert.equal(data.checks.node_test_runner.status, 'pass');
  assert.equal(data.checks.ffmpeg.status, 'fail');
  assert.equal(data.checks.ffprobe.status, 'fail');
  assert.equal(data.checks.font.status, 'fail');
  assert.equal(data.capabilities.storyboard_validation, 'available');
  assert.equal(data.capabilities.bundled_tests, 'available');
  assert.equal(data.capabilities.subtitle_export, 'blocked');
});


test('reports missing Pillow without making Python startup fail', () => {
  const result = run(['--node', process.execPath], ['-S']);
  assert.equal(result.status, 0, result.stderr);
  const data = report(result);
  assert.equal(data.status, 'partial');
  assert.equal(data.checks.pillow.status, 'fail');
  assert.equal(data.capabilities.storyboard_validation, 'available');
  assert.equal(data.capabilities.python_image_tools, 'blocked');
  assert.match(data.next_steps.join('\n'), /pip install -r requirements\.txt/);
});
