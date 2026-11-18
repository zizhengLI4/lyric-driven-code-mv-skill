import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { collectSampleTimes, runDeterminismQA } from '../scripts/qa.mjs';

const frame = value => ({ width: 1, height: 1, data: new Uint8ClampedArray([value, 0, 0, 255]) });

test('large RGBA frames warn once per QA run without changing formal determinism', async () => {
  const warnings = [];
  const big = { width: 1001, height: 1000, data: new Uint8Array(1001 * 1000 * 4) };
  const report = await runDeterminismQA(() => big, { times: [0, 1], warmupFrames: 3, onWarning: warning => warnings.push(warning) });
  assert.equal(report.status, 'pass'); assert.equal(report.renderCount, 14);
  assert.equal(warnings.length, 1); assert.equal(report.warnings.length, 1);
  assert.match(warnings[0], /低分辨率|世界层/);
  const small = await runDeterminismQA(() => frame(1), { times: [0], onWarning: warning => warnings.push(warning) });
  assert.deepEqual(small.warnings, []); assert.equal(warnings.length, 1);
});

test('纯时间求值在重复、逆序和乱序请求中一致', async () => {
  const result = await runDeterminismQA(t => frame(Math.round(t * 10)), { times: [0, 0.5, 1] });
  assert.equal(result.status, 'pass');
  assert.equal(result.renderCount, 12);
  assert.deepEqual(result.failures, []);
});

test('累积上一帧状态会被检测出来', async () => {
  let state = 0;
  const result = await runDeterminismQA(() => frame(++state), { times: [0, 0.5, 1] });
  assert.equal(result.status, 'fail');
  assert.ok(result.failures.some(f => f.order === 'reverse'));
});

test('检查覆盖首尾、镜头边界、转场中点和HUD事件', () => {
  const times = collectSampleTimes({ duration: 12, fps: 30, samples: 2, scenes: [
    { start: 0, end: 6, exit: { type: 'water', dur: 0.9 }, events: [{ at: 3.5, hud: '未抵达' }] },
    { start: 6, end: 12 }
  ] });
  for (const t of [0, 3.5, 5.1, 5.55, 6, 12 - 1 / 30]) {
    assert.ok(times.some(sample => Math.abs(sample - t) < 1e-7), `缺少 ${t}`);
  }
  assert.ok(times.every(t => t >= 0 && t < 12));
});

test('同一像素内容但尺寸不同也会失败', async () => {
  let count = 0;
  const result = await runDeterminismQA(() => ({ width: ++count % 2 ? 1 : 2, height: count % 2 ? 2 : 1, data: new Uint8Array(8) }), { times: [0] });
  assert.equal(result.status, 'fail');
});

test('拒绝损坏的帧和无效抽样参数', async () => {
  await assert.rejects(runDeterminismQA(() => ({ width: 2, height: 2, data: new Uint8Array(4) }), { times: [0] }), /RGBA/);
  await assert.rejects(runDeterminismQA(() => frame(1), { times: [NaN] }), /时间/);
  assert.throws(() => collectSampleTimes({ duration: 0, fps: 30 }), /duration/);
});

test('复用同一帧缓冲时立即计算哈希，不受随后写入影响', async () => {
  const reusable = frame(0);
  const result = await runDeterminismQA(async t => {
    reusable.data[0] = Math.round(t * 10);
    return reusable;
  }, { times: [0, 0.5, 1] });
  assert.equal(result.status, 'pass');
});

test('抽样补齐每个节拍前一帧，并将两端夹紧到可渲染范围', () => {
  const times = collectSampleTimes({ duration: 2, fps: 10, samples: 2, music: { beats: [0, 0.03, 0.7, 1.99, 2] } });
  for (const expected of [0, 0.6, 1.89, 1.9]) {
    assert.ok(times.some(time => Math.abs(time - expected) < 1e-8), `缺少节拍前一帧 ${expected}`);
  }
  assert.ok(times.every(time => time >= 0 && time <= 1.9));
});

test('完成正式检查后等待可选 teardown 完成', async () => {
  let closed = false;
  const result = await runDeterminismQA(() => frame(1), { times: [0], teardown: async () => {
    await new Promise(resolve => setImmediate(resolve));
    closed = true;
  } });
  assert.equal(result.status, 'pass');
  assert.equal(closed, true);
});

test('渲染失败仍清理，清理失败不覆盖原始错误', async () => {
  const renderError = new Error('render failed');
  const cleanupError = new Error('cleanup failed');
  let cleaned = false;
  await assert.rejects(runDeterminismQA(() => { throw renderError; }, { times: [0], teardown: async () => {
    cleaned = true;
    throw cleanupError;
  } }), error => error === renderError && error.cleanupError === cleanupError);
  assert.equal(cleaned, true);
});

test('时间参数校验失败时也等待 teardown 释放已创建的资源', async () => {
  let closed = false;
  await assert.rejects(runDeterminismQA(() => frame(1), { times: [NaN], teardown: async () => {
    await new Promise(resolve => setImmediate(resolve));
    closed = true;
  } }), /时间/);
  assert.equal(closed, true);
});

test('成功渲染后的清理失败仍返回失败', async () => {
  const cleanupError = new Error('cleanup failed');
  await assert.rejects(runDeterminismQA(() => frame(1), { times: [0], teardown: () => { throw cleanupError; } }), error => error === cleanupError);
});

test('首两次光栅差异独立记录，预热后继续四种顺序正式检查', async () => {
  let calls = 0;
  const profile = { seed: 'fixed', raster: 'software' };
  const result = await runDeterminismQA((time, options) => {
    assert.equal(time, 0.5);
    assert.equal(options, profile);
    return frame(++calls === 1 ? 10 : 20);
  }, { times: [0.5], warmupFrames: 3, frameOptions: profile });
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.failures, []);
  assert.equal(result.renderCount, 7);
  assert.equal(result.formalRenderCount, 4);
  assert.equal(result.warmupRenderCount, 3);
  assert.equal(result.warmupFrames, 3);
  assert.equal(result.warmupStatus, 'mismatch');
  assert.deepEqual(result.renderProfile, profile);
  assert.equal(result.warmupMismatch.length, 1);
  const diagnostic = result.warmupMismatch[0];
  assert.equal(diagnostic.time, 0.5);
  assert.notEqual(diagnostic.hashes[0], diagnostic.hashes[1]);
  assert.equal(diagnostic.hashes[1], diagnostic.hashes[2]);
  assert.equal(diagnostic.stabilized, true);
  assert.equal(result.frames[0].sha256, diagnostic.hashes[2]);
});

test('两帧预热后持续累积状态仍失败，不能被预热掩盖', async () => {
  let calls = 0;
  const result = await runDeterminismQA(() => frame(++calls), { times: [0, 1], warmupFrames: 2 });
  assert.equal(result.status, 'fail');
  assert.ok(result.failures.some(failure => failure.order === 'reverse'));
  assert.ok(result.warmupMismatch.every(diagnostic => diagnostic.stabilized === false));
  assert.equal(result.warmupRenderCount, 4);
});

test('旧API默认不增加预热渲染，拒绝超范围或非整数预热设置', async () => {
  const result = await runDeterminismQA(() => frame(1), { times: [0] });
  assert.equal(result.renderCount, 4);
  assert.equal(result.warmupStatus, 'disabled');
  for (const warmupFrames of [1, 4, -1, 2.5, NaN]) {
    await assert.rejects(runDeterminismQA(() => frame(1), { times: [0], warmupFrames }), /warmupFrames/);
  }
});

function cliFixture(t, body, cleanupBody = '') {
  const prefix = join(tmpdir(), 'lyric-qa-');
  const dir = mkdtempSync(prefix);
  t.after(() => {
    assert.ok(dir.startsWith(prefix), '只删除本测试创建的临时目录');
    rmSync(dir, { recursive: true, force: true });
  });
  const modulePath = join(dir, 'adapter.mjs');
  const cleanupFile = join(dir, 'cleaned.txt');
  writeFileSync(modulePath, `import { appendFile } from 'node:fs/promises';
const timer = setInterval(() => {}, 1000);
export const DURATION = 2;
export const FPS = 10;
${body}
export async function cleanup() {
  clearInterval(timer);
  await appendFile(${JSON.stringify(cleanupFile)}, 'cleaned');
  ${cleanupBody}
}
`);
  return {
    dir,
    cleanupFile,
    run: args => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/qa.mjs', import.meta.url)), modulePath, ...args], { encoding: 'utf8', timeout: 2500, windowsHide: true })
  };
}

const steadyRenderer = 'export function renderFrame() { return { width: 1, height: 1, data: new Uint8Array([1, 0, 0, 255]) }; }';

test('CLI成功后关闭持有定时器的适配器并自然退出', t => {
  const fixture = cliFixture(t, steadyRenderer);
  const out = join(fixture.dir, 'qa.json');
  const child = fixture.run(['--times', '0', '--out', out]);
  assert.equal(child.error, undefined, '成功后应清理活动资源，不能等到超时');
  assert.equal(child.status, 0, child.stderr);
  assert.equal(readFileSync(fixture.cleanupFile, 'utf8'), 'cleaned');
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(report.warmupFrames, 3);
  assert.equal(report.warmupRenderCount, 3);
});

test('CLI渲染失败仍关闭活动资源并保留渲染错误', t => {
  const fixture = cliFixture(t, "export function renderFrame() { throw new Error('render-marker'); }", "throw new Error('cleanup-marker');");
  const child = fixture.run(['--times', '0']);
  assert.equal(child.error, undefined, '渲染失败后应清理活动资源');
  assert.equal(child.status, 1);
  assert.match(child.stderr, /render-marker/);
  assert.match(child.stderr, /cleanup-marker/);
  assert.equal(readFileSync(fixture.cleanupFile, 'utf8'), 'cleaned');
});

test('CLI不会因清理抛出空值而丢掉第二条错误诊断', t => {
  const fixture = cliFixture(t, "export function renderFrame() { throw new Error('render-marker'); }", 'throw null;');
  const child = fixture.run(['--times', '0']);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /render-marker/);
  assert.match(child.stderr, /资源清理失败.*null/);
});

test('CLI正式像素不一致仍清理一次并以失败退出', t => {
  const fixture = cliFixture(t, 'let calls = 0; export function renderFrame() { return { width: 1, height: 1, data: new Uint8Array([++calls, 0, 0, 255]) }; }');
  const child = fixture.run(['--times', '0']);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.match(child.stdout, /fail/);
  assert.equal(readFileSync(fixture.cleanupFile, 'utf8'), 'cleaned');
});

test('CLI成功渲染但清理失败会说明原因并以失败退出', t => {
  const fixture = cliFixture(t, steadyRenderer, "throw new Error('cleanup-marker');");
  const child = fixture.run(['--times', '0']);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /资源清理失败.*cleanup-marker/);
  assert.equal(readFileSync(fixture.cleanupFile, 'utf8'), 'cleaned');
});

test('CLI校验参数失败时也清理已加载模块', t => {
  const fixture = cliFixture(t, steadyRenderer);
  const child = fixture.run(['--duration', '0']);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /duration/);
  assert.equal(readFileSync(fixture.cleanupFile, 'utf8'), 'cleaned');
});

test('CLI输出写失败仍关闭活动资源', t => {
  const fixture = cliFixture(t, steadyRenderer);
  const child = fixture.run(['--times', '0', '--out', fixture.dir]);
  assert.equal(child.error, undefined, '写报告失败后应清理活动资源');
  assert.equal(child.status, 1);
  assert.match(child.stderr, /EISDIR|EPERM|EACCES/);
  assert.equal(readFileSync(fixture.cleanupFile, 'utf8'), 'cleaned');
});

test('CLI仅预热不一致仍明确警告并写入独立诊断', t => {
  const fixture = cliFixture(t, 'let calls = 0; export function renderFrame() { return { width: 1, height: 1, data: new Uint8Array([++calls === 1 ? 10 : 20, 0, 0, 255]) }; }');
  const out = join(fixture.dir, 'qa.json');
  const child = fixture.run(['--times', '0', '--warmup-frames', '2', '--out', out]);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stderr, /预热/);
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(report.status, 'pass');
  assert.equal(report.warmupMismatch[0].stabilized, true);
});

test('CLI自动抽样包含storyboard音乐的节拍前一帧', t => {
  const fixture = cliFixture(t, steadyRenderer);
  const storyboard = join(fixture.dir, 'storyboard.json');
  const out = join(fixture.dir, 'qa.json');
  writeFileSync(storyboard, JSON.stringify({ project: { duration: 2, fps: 10 }, music: { beats: [0.7] }, scenes: [] }));
  const child = fixture.run(['--storyboard', storyboard, '--samples', '2', '--warmup-frames', '0', '--out', out]);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.ok(report.frames.some(sample => Math.abs(sample.time - 0.6) < 1e-8));
});

test('CLI等待分镜配置钩子并将实际时间线用于全部像素检查', t => {
  const fixture = cliFixture(t, `export async function frameOptionsForStoryboard(data) {
  await new Promise(resolve => setImmediate(resolve));
  return { seed: data.project.seed, timeline: { scene: data.scenes[0].id } };
}
export function renderFrame(t, options) {
  if (options.seed !== 'song-seed' || options.timeline?.scene !== 'actual-scene') throw new Error('profile-not-applied');
  return { width: 1, height: 1, data: new Uint8Array([42, 0, 0, 255]) };
}`);
  const storyboard = join(fixture.dir, 'storyboard.json');
  const out = join(fixture.dir, 'qa.json');
  writeFileSync(storyboard, JSON.stringify({ project: { duration: 2, fps: 10, seed: 'song-seed' }, scenes: [{ id: 'actual-scene', start: 0, end: 2 }] }));
  const child = fixture.run(['--storyboard', storyboard, '--times', '0', '--out', out]);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(report.renderProfile, { seed: 'song-seed', timeline: { scene: 'actual-scene' } });
  assert.equal(report.renderCount, 7);
  assert.equal(readFileSync(fixture.cleanupFile, 'utf8'), 'cleaned');
});

test('CLI分镜配置钩子失败仍释放活动资源并保留错误', t => {
  const fixture = cliFixture(t, `${steadyRenderer}\nexport async function frameOptionsForStoryboard() { throw new Error('hook-marker'); }`);
  const storyboard = join(fixture.dir, 'storyboard.json');
  writeFileSync(storyboard, JSON.stringify({ project: { duration: 2, fps: 10 }, scenes: [] }));
  const child = fixture.run(['--storyboard', storyboard, '--times', '0']);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /hook-marker/);
  assert.equal(readFileSync(fixture.cleanupFile, 'utf8'), 'cleaned');
});
