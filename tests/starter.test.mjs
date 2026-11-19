import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireMediaTools } from './media-tools.mjs';

const base = new URL('../skills/lyric-driven-code-mv/assets/templates/starter/', import.meta.url);


test('独立复制 starter 所需最小集合后 export --help 可运行', t => {
  const root = mkdtempSync(join(tmpdir(), 'starter-copy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const copiedAssets = join(root, 'assets');
  mkdirSync(join(copiedAssets, 'templates'), { recursive: true });
  cpSync(fileURLToPath(new URL('../../frame-core.mjs', base)), join(copiedAssets, 'frame-core.mjs'));
  cpSync(fileURLToPath(base), join(copiedAssets, 'templates/starter'), { recursive: true });
  const copiedStarter = join(copiedAssets, 'templates/starter');
  const result = spawnSync(process.execPath, [join(copiedStarter, 'export.mjs'), '--help'], { cwd: copiedStarter, encoding: 'utf8', windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /用法/);
});

test('模板提供不依赖外部包的纯帧入口', async () => {
  assert.ok(existsSync(fileURLToPath(new URL('frame.mjs', base))), '缺少纯帧模块 frame.mjs');
  const module = await import(new URL('frame.mjs', base));
  assert.equal(typeof module.renderFrame, 'function');
});

const frameModule = () => import(new URL('frame.mjs', base));
const hash = frame => createHash('sha256').update(frame.data).digest('hex');

test('帧由绝对时间与 seed 决定，乱序 seek 和修改旧返回值不影响新帧', async () => {
  const { renderFrame } = await frameModule();
  const wanted = new Map([0, 0.7, 5.55, 6, 11.9].map(t => [t, hash(renderFrame(t))]));
  for (const t of [11.9, 0.7, 6, 0, 5.55, 0.7]) assert.equal(hash(renderFrame(t)), wanted.get(t));
  renderFrame(0.7).data.fill(0);
  assert.equal(hash(renderFrame(0.7)), wanted.get(0.7));
  assert.notEqual(hash(renderFrame(0.7, { seed: 'another' })), wanted.get(0.7));
  assert.throws(() => renderFrame(NaN), /时间/);
});

test('统一摄像机取整，规定平移缩放范围内世界四边均有不透明非黑留边', async () => {
  const { FB, renderFrame } = await frameModule();
  const fb = new FB().setCam(132.25, 103.75, 0.93);
  assert.ok(Number.isInteger(fb.X(3.6)) && Number.isInteger(fb.Y(2.7)));
  assert.throws(() => fb.setCam(0, 0, 0), /zoom/);
  for (const x of [120, 264]) for (const y of [70, 146]) for (const zoom of [0.75, 1, 1.25]) for (const t of [1, 8]) {
    const f = renderFrame(t, { camera: { x, y, zoom } });
    assert.equal(f.width, 384); assert.equal(f.height, 216);
    const check = (px, py) => { const i = (py * f.width + px) * 4; assert.equal(f.data[i + 3], 255, `透明边 t=${t}, cam=${x},${y},${zoom}`); assert.ok(f.data[i] + f.data[i + 1] + f.data[i + 2] > 0, '黑边'); };
    for (let px = 0; px < f.width; px++) { check(px, 0); check(px, f.height - 1); }
    for (let py = 0; py < f.height; py++) { check(0, py); check(f.width - 1, py); }
  }
});

test('摄像机拒绝极端缩放和超范围平移，图元只遍历裁剪后的视口', async () => {
  const { FB, renderFrame } = await frameModule();
  // 在子进程内复现旧实现，超时也是失败，避免测试进程被不推进的 Infinity 循环卡住。
  const expression = `import {renderFrame} from ${JSON.stringify(new URL('frame.mjs', base).href)}; try { renderFrame(1,{camera:{x:192,y:108,zoom:1e308}}); process.exitCode=2; } catch(e) { console.log(e.message); }`;
  const extreme = spawnSync(process.execPath, ['--input-type=module', '-e', expression], { encoding: 'utf8', timeout: 1500, windowsHide: true });
  assert.equal(extreme.error, undefined, '极端camera应立即拒绝，不能卡死'); assert.equal(extreme.status, 0); assert.match(extreme.stdout, /摄像机|zoom/);
  assert.throws(() => renderFrame(1, { camera: { x: 119, y: 108, zoom: 1 } }), /摄像机/);
  assert.throws(() => new FB().setCam(0, 0, 1e308), /zoom|摄像机/);
  const fb = new FB(32, 18).setCam(192, 108, 1);
  fb.line(-100000, 108, 100000, 108, [255, 255, 255]);
  fb.circle(192, 108, 100000, [90, 100, 110]);
  assert.ok(fb.data.every((n, i) => i % 4 === 3 ? n === 255 : n > 0));
  assert.throws(() => fb.circle(0, 0, 1e308, [1, 2, 3]), /图元|坐标|半径/);
});

test('转场占前镜尾部，前镜仍运动而后镜仅预卷第0秒，不增加12秒总时长', async () => {
  const { resolveTimeline, renderTimelineFrame } = await frameModule();
  assert.equal(resolveTimeline(5.09).nextIndex, null);
  const start = resolveTimeline(5.1); assert.equal(start.index, 0); assert.equal(start.local, 5.1); assert.equal(start.nextIndex, 1); assert.equal(start.nextLocal, 0); assert.equal(start.progress, 0);
  assert.ok(Math.abs(resolveTimeline(5.55).progress - 0.5) < 1e-12);
  const calls = [], solid = value => ({ width: 2, height: 2, data: new Uint8ClampedArray([value, 20, 30, 255, value, 20, 30, 255, value, 20, 30, 255, value, 20, 30, 255]) });
  renderTimelineFrame(5.55, (index, local) => { calls.push([index, local]); return solid(index ? 200 : 50); });
  assert.deepEqual(calls, [[0, 5.55], [1, 0]]);
  assert.deepEqual([resolveTimeline(6).index, resolveTimeline(6).local, resolveTimeline(6).nextIndex], [1, 0, null]);
  assert.deepEqual([resolveTimeline(12).index, resolveTimeline(12).local, resolveTimeline(12).nextIndex], [1, 6, null]);
  assert.equal(resolveTimeline(-9).local, 0); assert.equal(resolveTimeline(99).local, 6);
});

test('所有转场端点准确，超出进度裁切且不修改输入帧', async () => {
  const { blendFrames } = await frameModule();
  const a = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(40) }, b = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(210) };
  for (const type of ['dissolve', 'ripple', 'water', 'cut']) {
    assert.deepEqual(blendFrames(a, b, -1, { type, origin: [0.55, 0.62] }).data, a.data);
    assert.deepEqual(blendFrames(a, b, 2, { type, origin: [0.55, 0.62] }).data, b.data);
    blendFrames(a, b, 0.5, { type, origin: [0.55, 0.62] });
  }
  assert.ok(a.data.every(n => n === 40)); assert.ok(b.data.every(n => n === 210));
  assert.throws(() => blendFrames(a, { ...b, width: 3 }, 0.5), /尺寸/);
});

test('波纹与水转场临近端点已连续接近整帧，边缘不在切镜时突然跳变', async () => {
  const { blendFrames } = await frameModule();
  const a = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(40) }, b = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(210) };
  for (const type of ['dissolve', 'ripple', 'water']) {
    const start = blendFrames(a, b, 0.000001, { type, origin: [0.55, 0.62] });
    const end = blendFrames(a, b, 0.999999, { type, origin: [0.55, 0.62] });
    assert.ok(start.data.every(n => Math.abs(n - 40) <= 1), `${type} 起点不连续`);
    assert.ok(end.data.every(n => Math.abs(n - 210) <= 1), `${type} 终点边缘不连续`);
  }
});

test('内置PNG编码可独立解压恢复RGBA且拒绝损坏数据', async () => {
  assert.ok(existsSync(fileURLToPath(new URL('png.mjs', base))), '缺少内置PNG编码模块');
  const { encodePNG, inspectPNG } = await import(new URL('png.mjs', base));
  const raw = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 4, 5, 6, 255]);
  const png = encodePNG({ width: 2, height: 2, data: raw });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(inspectPNG(png), { width: 2, height: 2 });
  const parts = []; for (let p = 8; p < png.length;) { const size = png.readUInt32BE(p), type = png.toString('ascii', p + 4, p + 8); if (type === 'IDAT') parts.push(png.subarray(p + 8, p + 8 + size)); p += 12 + size; }
  const decoded = inflateSync(Buffer.concat(parts));
  assert.deepEqual([...decoded], [0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 4, 5, 6, 255]);
  const corrupt = Buffer.from(png); corrupt[corrupt.length - 5] ^= 1;
  assert.throws(() => inspectPNG(corrupt), /PNG|CRC/);
  assert.throws(() => encodePNG({ width: 2, height: 2, data: raw.subarray(0, 4) }), /RGBA/);
});

test('导出CLI校验配置，并给出易读的失败退出码', async () => {
  assert.ok(existsSync(fileURLToPath(new URL('export.mjs', base))), '缺少导出CLI');
  const { parseArgs } = await import(new URL('export.mjs', base));
  assert.throws(() => parseArgs(['--fps', '0']), /fps/);
  assert.throws(() => parseArgs(['--width', '641']), /尺寸|width/);
  assert.throws(() => parseArgs(['--resume']), /frames-dir/);
  assert.throws(() => parseArgs(['--unknown']), /未知/);
  assert.throws(() => parseArgs(['--sfx']), /storyboard/);
  assert.throws(() => parseArgs(['--sfx-gain', '2.5', '--storyboard', 'x.json']), /sfx-gain/);
  assert.throws(() => parseArgs(['--sfx-gain', 'NaN', '--storyboard', 'x.json']), /sfx-gain/);
  assert.equal(parseArgs(['--sfx', '--storyboard', 'x.json']).sfx, true);
  assert.equal(parseArgs(['--sfx', '--storyboard', 'x.json']).sfxGain, 0.85);
  assert.equal(parseArgs(['--sfx-gain', '0.6', '--storyboard', 'x.json']).sfxGain, 0.6);
  assert.equal(parseArgs(['--ffmpeg', './tools/ffmpeg.exe']).ffmpeg, resolve('./tools/ffmpeg.exe'));
  const cli = fileURLToPath(new URL('export.mjs', base));
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 });
  const help = run(['--help']); assert.equal(help.status, 0); assert.match(help.stdout, /用法/);
  const invalid = run(['--fps', '0']); assert.equal(invalid.status, 1); assert.doesNotMatch(invalid.stderr, /\n\s+at /);
  const unavailable = run(['--ffmpeg', join(process.cwd(), 'missing-ffmpeg-starter-991.exe')]);
  assert.equal(unavailable.status, 1); assert.match(unavailable.stderr, /ffmpeg/); assert.doesNotMatch(unavailable.stderr, /\n\s+at /);
});

test('实际编码后的输出路径错误返回失败，清理临时MP4和音轨目录', t => {
  const tools = requireMediaTools(t, ['ffmpeg', 'ffprobe']); if (!tools) return;
  const root = resolve(process.cwd(), '..', 'starter-check'); mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'export-failure-test-')), target = join(directory, 'cannot-replace-directory.mp4');
  mkdirSync(target);
  t.after(() => { assert.ok(resolve(directory).startsWith(root + sep)); rmSync(directory, { recursive: true, force: true }); });
  const cli = fileURLToPath(new URL('export.mjs', base));
  const result = spawnSync(process.execPath, [cli, '--out', target, '--width', '640', '--height', '360', '--fps', '1', '--ffmpeg', tools.ffmpeg, '--ffprobe', tools.ffprobe], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(result.error, undefined); assert.equal(result.status, 1); assert.match(result.stderr, /导出失败/);
  assert.ok(existsSync(target)); assert.deepEqual(readdirSync(directory), ['cannot-replace-directory.mp4']);
});

test('minimal-renderer rejects default writes inside the skill and accepts project work outputs', t => {
  const temp = mkdtempSync(join(tmpdir(), 'minimal-renderer-isolated-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const isolatedSkill = join(temp, 'lyric-driven-code-mv');
  cpSync(fileURLToPath(new URL('../skills/lyric-driven-code-mv/', import.meta.url)), isolatedSkill, { recursive: true });
  const renderer = join(isolatedSkill, 'scripts/minimal-renderer.py');
  const storyboard = join(isolatedSkill, 'assets/storyboard-example.json');
  const python = process.env.PYTHON || 'python';
  const denied = spawnSync(python, ['-X', 'utf8', renderer, storyboard, '--probe', '0'], { cwd: isolatedSkill, encoding: 'utf8', windowsHide: true });
  assert.notEqual(denied.status, 0);
  assert.match(`${denied.stdout}\n${denied.stderr}`, /技能安装目录/);
  assert.equal(existsSync(join(isolatedSkill, 'work')), false);
  const projectWork = join(temp, 'project/work/probe');
  const allowed = spawnSync(python, ['-X', 'utf8', renderer, storyboard, '--probe', '0', '--out', projectWork], { cwd: isolatedSkill, encoding: 'utf8', windowsHide: true });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(readdirSync(projectWork).length, 1);
});

test('恢复导出核对配置及每个已存PNG尺寸，拒绝混用和损坏', async t => {
  assert.ok(existsSync(fileURLToPath(new URL('export.mjs', base))), '缺少可恢复导出');
  const { parseArgs, prepareFrames } = await import(new URL('export.mjs', base));
  const { encodePNG } = await import(new URL('png.mjs', base));
  const root = resolve(process.cwd(), '..', 'starter-check');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'resume-test-'));
  t.after(() => { assert.ok(resolve(directory).startsWith(root + sep)); rmSync(directory, { recursive: true, force: true }); });
  const config = parseArgs(['--frames-dir', directory, '--fps', '1', '--width', '640', '--height', '360']);
  await prepareFrames(config, () => {});
  assert.equal(readdirSync(directory).filter(n => /^frame-\d{6}\.png$/.test(n)).length, 12);
  const first = readFileSync(join(directory, 'frame-000000.png'));
  await prepareFrames({ ...config, resume: true }, () => {});
  assert.deepEqual(readFileSync(join(directory, 'frame-000000.png')), first);
  await assert.rejects(() => prepareFrames({ ...config, resume: true, fps: 2 }, () => {}), /配置/);
  writeFileSync(join(directory, 'frame-000000.png'), readFileSync(join(directory, 'frame-000001.png')));
  await assert.rejects(() => prepareFrames({ ...config, resume: true }, () => {}), /哈希|指纹/);
  writeFileSync(join(directory, 'frame-000000.png'), first);
  const manifestPath = join(directory, 'render-config.json'), untrusted = JSON.parse(readFileSync(manifestPath, 'utf8'));
  delete untrusted.frames;
  writeFileSync(manifestPath, JSON.stringify(untrusted));
  writeFileSync(join(directory, 'frame-000000.png'), readFileSync(join(directory, 'frame-000001.png')));
  await prepareFrames({ ...config, resume: true }, () => {});
  assert.deepEqual(readFileSync(join(directory, 'frame-000000.png')), first, '无可信帧哈希时必须重算，不能复用错置PNG');
  writeFileSync(join(directory, 'frame-000000.png'), encodePNG({ width: 2, height: 2, data: new Uint8ClampedArray(16) }));
  await assert.rejects(() => prepareFrames({ ...config, resume: true }, () => {}), /尺寸/);
});
