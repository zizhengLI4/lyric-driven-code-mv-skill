import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = new URL('../', import.meta.url);
const resolveSkill = path => fileURLToPath(new URL(path, repo));
const importSkill = path => import(pathToFileURL(resolveSkill(path)).href);

test('export accepts a custom SFX module path and reports missing modules with a remedy', async () => {
  const { parseArgs, loadProject } = await import(new URL('assets/templates/starter/export.mjs', repo));
  const parsed = parseArgs(['--storyboard', 'storyboard.json', '--sfx', '--sfx-script', './custom-sfx.mjs']);
  assert.equal(parsed.sfxScript, join(process.cwd(), 'custom-sfx.mjs'));
  const dir = mkdtempSync(join(tmpdir(), 'sfx-module-'));
  try {
    const storyboard = join(dir, 'storyboard.json');
    writeFileSync(storyboard, JSON.stringify({ schemaVersion: 1, timebase: 'clip', project: { duration: 1, fps: 1, width: 384, height: 216, seed: 'test', sourceOffset: 0, virtualWidth: 384, virtualHeight: 216, audio: { path: 'song.wav', timebase: 'clip' } }, music: { status: 'illustrative' }, scenes: [{ id: 'send', start: 0, end: 1, exit: { type: 'cut', dur: 0 } }], lyrics: [] }));
    const c = parseArgs(['--storyboard', storyboard, '--sfx', '--sfx-script', join(dir, 'missing.mjs')]);
    await assert.rejects(loadProject(c), error => /--sfx-script/.test(error.message) && /检查路径|复制|指定/.test(error.message));
    const modulePath = join(dir, 'custom.mjs');
    writeFileSync(modulePath, 'export const collectSfx = () => [{ at: 0.25, type: "tick" }]; export const renderTimeline = () => ({}); export const encodeWav = () => Buffer.alloc(44);');
    const custom = await loadProject(parseArgs(['--storyboard', storyboard, '--sfx', '--sfx-script', modulePath]));
    assert.deepEqual(custom.sfx, [{ at: 0.25, type: 'tick' }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SFX verifier uses 50 ms envelopes and returns one evidence row per event', async () => {
  const path = resolveSkill('scripts/verify-sfx.mjs');
  assert.ok(existsSync(path), 'scripts/verify-sfx.mjs must exist');
  const { verifySfxEvents } = await import(pathToFileURL(path).href);
  assert.equal(typeof verifySfxEvents, 'function');
  const duration = 12, events = Array.from({ length: 45 }, (_, i) => ({ id: `sfx-${i + 1}`, at: 0.2 + i * 0.25 }));
  const rate = 8000, mono = new Float32Array(duration * rate);
  for (const event of events) mono.fill(0.5, Math.round(event.at * rate), Math.round(event.at * rate) + 400);
  const report = verifySfxEvents({ events, samples: mono, sampleRate: rate, duration, windowMs: 50 });
  assert.equal(report.events.length, 45);
  assert.ok(report.events.every(event => event.hit));
  assert.equal(report.windowMs, 50);
  assert.ok(report.events[0].evidence.peak > report.events[0].evidence.baseline);
});

test('SFX verifier CLI prints a 45-event hit table and writes evidence JSON', async t => {
  const { requireMediaTools } = await import('./media-tools.mjs');
  const tools = requireMediaTools(t, ['ffmpeg']); if (!tools) return;
  const dir = mkdtempSync(join(tmpdir(), 'verify-sfx-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { encodeWav, renderTimeline } = await importSkill('scripts/sfx.mjs');
  const events = Array.from({ length: 45 }, (_, i) => ({ at: 0.2 + i * 0.25, type: 'tick' }));
  const { pcm } = renderTimeline(events, 12);
  const audio = join(dir, 'mixed.wav'), storyboard = join(dir, 'storyboard.json'), reportPath = join(dir, 'evidence.json');
  writeFileSync(audio, encodeWav(pcm));
  writeFileSync(storyboard, JSON.stringify({ project: { duration: 12, sfx: events }, scenes: [] }));
  const result = spawnSync(process.execPath, [resolveSkill('scripts/verify-sfx.mjs'), '--audio', audio, '--storyboard', storyboard, '--ffmpeg', tools.ffmpeg, '--out', reportPath], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /45\/45 命中/);
  assert.match(result.stdout, /事件\s+时点\s+结果\s+基线 RMS/);
  const evidence = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(evidence.events.length, 45); assert.ok(evidence.events.every(event => event.hit && event.evidence.method.includes('50.000ms')));
});

test('FB glow is a true underlay when a layer draws its subject afterward', async () => {
  const { FB } = await importSkill('assets/templates/starter/frame.mjs');
  const fb = new FB(48, 48);
  fb.layer({
    subject: target => target.rect(180, 96, 24, 24, [240, 20, 30]),
    glow: target => target.glow(192, 108, 22, [250, 180, 20]),
  });
  const center = (24 * fb.width + 24) * 4;
  const outside = (24 * fb.width + 27) * 4;
  assert.deepEqual([...fb.data.subarray(center, center + 3)], [240, 20, 30]);
  assert.ok(fb.data[outside] > 0 || fb.data[outside + 1] > 0 || fb.data[outside + 2] > 0);
});

test('the 12 scene assets expose configurable duration, subject framing, and palette', async () => {
  const ids = ['window', 'leave', 'empty', 'turn', 'neon', 'street', 'shatter', 'lesson', 'night', 'dawn', 'path', 'lookback'];
  for (const id of ids) {
    const modulePath = resolveSkill(`assets/scenes/${id}.mjs`);
    assert.ok(existsSync(modulePath), `missing assets/scenes/${id}.mjs`);
    const module = await import(pathToFileURL(modulePath).href);
    const factory = module[`create${id[0].toUpperCase()}${id.slice(1)}Scene`];
    assert.equal(typeof factory, 'function', `${id} should export a scene factory`);
    const scene = factory({ duration: 8, subject: { x: 204, y: 104 }, palette: { neon: [10, 20, 30] } });
    assert.equal(scene.id, id);
    assert.equal(scene.duration, 8);
    assert.deepEqual(scene.subject, { x: 204, y: 104 });
    const frame = scene.render(3, { width: 32, height: 18, seed: 'fixture' });
    assert.equal(frame.width, 32); assert.equal(frame.height, 18); assert.equal(frame.data.length, 32 * 18 * 4);
  }
});

test('LRC conversion applies source offset, infers ends, and marks cross-scene lyrics', async () => {
  const path = resolveSkill('scripts/lrc.mjs');
  assert.ok(existsSync(path), 'scripts/lrc.mjs must exist');
  const { parseLrc } = await import(pathToFileURL(path).href);
  const lyrics = parseLrc('[00:02.00]first line\n[00:04.00]second line', { offset: 12, lastDuration: 4, scenes: [{ start: 0, end: 15 }, { start: 15, end: 20 }] });
  assert.deepEqual(lyrics.map(({ start, end }) => [start, end]), [[14, 16], [16, 20]]);
  assert.equal(lyrics[0].allowSceneSplit, true);
  assert.equal(typeof lyrics[0].splitReason, 'string');
});

test('LRC CLI accepts --lrc and --offset and emits a directly usable lyrics array', t => {
  const dir = mkdtempSync(join(tmpdir(), 'lrc-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'song lyrics.lrc'), out = join(dir, 'lyrics.json');
  writeFileSync(source, '[00:01.00]first\n[00:02.50]second');
  const result = spawnSync(process.execPath, [resolveSkill('scripts/lrc.mjs'), '--lrc', source, '--offset', '12', '--duration', '20', '--out', out], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).map(cue => [cue.start, cue.end]), [[13, 14.5], [14.5, 17.5]]);
});

test('draft 默认不烧水印，显式 draftMark:true 才加，状态仍进资产清单', async () => {
  const { createTimeline } = await importSkill('assets/templates/starter/timeline.mjs');
  const data = JSON.parse(readFileSync(resolveSkill('assets/storyboard-example.json'), 'utf8'));
  data.music.status = 'draft';
  delete data.project.draftMark;
  assert.equal(createTimeline(data).notice, '', 'draft 默认不该烧水印');
  data.project.draftMarkText = '暂定';
  assert.equal(createTimeline(data).notice, '');
  data.project.draftMark = true;
  assert.equal(createTimeline(data).notice, '暂定');
  data.project.draftMark = false;
  assert.equal(createTimeline(data).notice, '');
  data.music.status = 'illustrative';
  delete data.project.draftMark;
  delete data.music.presentationNotice;
  assert.match(createTimeline(data).notice, /演示时点/);
});

test('unknown props report the complete allowed-value list alongside all validation errors', async () => {
  const { analyzeStoryboard } = await importSkill('scripts/validate-storyboard.mjs');
  const data = JSON.parse(readFileSync(resolveSkill('assets/storyboard-example.json'), 'utf8'));
  data.scenes[0].props.push('空椅');
  // 示例只有一镜，补一个派生镜，让第二个错误落在 scenes[1] 上。
  const extra = { ...structuredClone(data.scenes[0]), id: 'reply', start: 24, end: 30, events: [], hud: [], props: ['未知道具'], meaning: '第二镜', lyricIds: [] };
  data.scenes.push(extra);
  data.project.duration = 30;
  data.chapters[data.chapters.length - 1].end = 30;
  data.music.beats = data.music.beats.filter(b => b < 30);
  data.music.sections[data.music.sections.length - 1].end = 30;
  data.scenes[0].meaning = '';
  const { errors } = analyzeStoryboard(data);
  assert.equal(errors.length, 3);
  assert.match(errors.join('\n'), /空椅.*候选|候选.*paper-boat/);
  assert.match(errors.join('\n'), /未知道具/);
  assert.match(errors.join('\n'), /meaning/);
});

test('narrative-12 generator emits a valid 12-shot starter from duration and lyrics', async () => {
  const path = resolveSkill('scripts/new-storyboard.mjs');
  assert.ok(existsSync(path), 'scripts/new-storyboard.mjs must exist');
  const { buildNarrative12Storyboard } = await import(pathToFileURL(path).href);
  const data = buildNarrative12Storyboard({ duration: 90, lyrics: [{ id: 'l1', start: 1, end: 3, text: 'sample' }] });
  assert.equal(data.scenes.length, 12);
  assert.equal(data.scenes.at(-1).end, 90);
  assert.equal(data.lyrics[0].text, 'sample');
  const { analyzeStoryboard } = await importSkill('scripts/validate-storyboard.mjs');
  assert.deepEqual(analyzeStoryboard(data).errors, []);
});

test('narrative-12 CLI reads lyrics.json and writes a 12-scene skeleton', t => {
  const dir = mkdtempSync(join(tmpdir(), 'storyboard-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lyricsPath = join(dir, 'lyrics.json'), outputPath = join(dir, 'storyboard.json');
  writeFileSync(lyricsPath, JSON.stringify([{ id: 'l1', start: 1, end: 4, text: 'verse' }]));
  const result = spawnSync(process.execPath, [resolveSkill('scripts/new-storyboard.mjs'), '--preset', 'narrative-12', '--duration', '90', '--lyrics', lyricsPath, '--out', outputPath], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const storyboard = JSON.parse(readFileSync(outputPath, 'utf8'));
  assert.equal(storyboard.scenes.length, 12); assert.equal(storyboard.lyrics[0].id, 'l1');
});

test('composition QA reports low subject area, low luminance, and dominant-color warnings', async () => {
  const { measureComposition } = await importSkill('scripts/qa.mjs');
  assert.equal(typeof measureComposition, 'function');
  const width = 20, height = 20, data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i * 4] = 20; data[i * 4 + 1] = 20; data[i * 4 + 2] = 20; data[i * 4 + 3] = 255; }
  const subjectMask = new Uint8Array(width * height); subjectMask[0] = 1;
  const result = measureComposition({ width, height, data }, { subjectMask });
  assert.ok(result.subjectFraction < 0.005);
  assert.ok(result.meanLuminance < 30);
  assert.ok(result.dominantColorFraction > 0.6);
  assert.equal(result.warnings.length, 3);
});

// —— 渲染核心合并后的回归：唯一实现、subject 夹取、调色板显式传参、场景真源 ——

const sceneIds = ['window', 'leave', 'empty', 'turn', 'neon', 'street', 'shatter', 'lesson', 'night', 'dawn', 'path', 'lookback'];
const frameCore = () => importSkill('assets/frame-core.mjs');

test('starter 与 12 个场景资产共用同一份 frame-core.mjs，两侧都不再自带 FB', async () => {
  const core = await frameCore();
  const starter = await importSkill('assets/templates/starter/frame.mjs');
  assert.equal(starter.FB, core.FB, 'starter 的 FB 必须就是 frame-core 的 FB');
  assert.equal(typeof core.FB.prototype.glow, 'function');
  assert.equal(typeof core.FB.prototype.layer, 'function');
  for (const path of ['assets/templates/starter/frame.mjs', 'assets/scenes/shared.mjs']) {
    const source = readFileSync(resolveSkill(path), 'utf8');
    assert.match(source, /frame-core\.mjs/, `${path} 必须 import frame-core.mjs`);
    assert.doesNotMatch(source, /class FB\b/, `${path} 不应再自带 FB 实现`);
    // 只允许转发式壳：出现转场分支或自建混合缓冲就说明又抄了一份实现
    assert.doesNotMatch(source, /exit\.type === 'ripple'/, `${path} 不应再自带转场实现`);
    assert.doesNotMatch(source, /new Uint8ClampedArray\(previous\.data\.length\)/, `${path} 不应再自建转场缓冲`);
  }
  // 场景层与成片层拿到的是同一个构造器：用 core 造的帧和 starter 造的帧同型
  const frame = new core.FB(8, 8).frame();
  assert.equal(frame.data.constructor, new starter.FB(8, 8).frame().data.constructor);
});

test('FB.layer 的 underlay 语义在 frame-core 中唯一实现，neon 画法真的用它定序', async () => {
  const { FB } = await frameCore();
  const fb = new FB(48, 48);
  fb.layer({
    subject: target => target.rect(180, 96, 24, 24, [240, 20, 30]),
    glow: target => target.glow(192, 108, 22, [250, 180, 20]),
  });
  const center = (24 * fb.width + 24) * 4;
  const outside = (24 * fb.width + 27) * 4;
  assert.deepEqual([...fb.data.subarray(center, center + 3)], [240, 20, 30], 'subject 必须盖在 glow 之上');
  assert.ok(fb.data[outside] > 0 || fb.data[outside + 1] > 0 || fb.data[outside + 2] > 0, '光晕必须在主体之外可见');
  assert.match(readFileSync(resolveSkill('assets/scenes/neon.mjs'), 'utf8'), /fb\.layer\(/);
});

test('subject 愿望值超出摄像机范围时夹取并只提示一次，不再抛错', async () => {
  const { resetCameraWarnings } = await frameCore();
  const { createNeonScene } = await importSkill('assets/scenes/neon.mjs');
  const warnings = [], original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    resetCameraWarnings();
    const scene = createNeonScene({ subject: { x: 100, y: 100 } });
    for (const local of [1, 2]) {
      const frame = scene.render(local, { width: 64, height: 36, seed: 'fixture' });
      assert.equal(frame.width, 64); assert.equal(frame.height, 36); assert.equal(frame.data.length, 64 * 36 * 4);
    }
    assert.equal(warnings.length, 1, '夹取只提示一次，避免逐帧刷屏');
    assert.match(warnings[0], /夹取/);
    assert.match(warnings[0], /实际 x=264/);
    resetCameraWarnings();
    createNeonScene({}).render(1, { width: 64, height: 36, seed: 'fixture' });
    assert.equal(warnings.length, 1, '默认取景不越界，不应提示');
  } finally { console.warn = original; }
});

test('调色板是显式参数：交替渲染不同 palette 的资产互不污染', async () => {
  const { createNeonScene } = await importSkill('assets/scenes/neon.mjs');
  const render = scene => scene.render(4, { width: 384, height: 216, seed: 'palette' });
  const pink = render(createNeonScene({ palette: { neon: [255, 0, 0] } }));
  const blue = render(createNeonScene({ palette: { neon: [0, 0, 255] } }));
  const pinkAgain = render(createNeonScene({ palette: { neon: [255, 0, 0] } }));
  assert.notDeepEqual([...pink.data], [...blue.data], 'palette 覆盖必须真的改变画面');
  assert.deepEqual([...pink.data], [...pinkAgain.data], '同一 palette 必须逐像素可复现');
  assert.throws(() => createNeonScene({ palette: { nope: [1, 2, 3] } }), /未知调色板键/);
  const source = readFileSync(resolveSkill('assets/scenes/shared.mjs'), 'utf8');
  assert.doesNotMatch(source, /let\s+P\s*=/, '不允许再出现模块级可变调色板');
  assert.match(source, /draw\(fb, t, seed, palette\)/);
});

test('12 个场景各自持有画法，SCENE_RENDERERS 由模块注册而不是下标查表', async () => {
  const index = await importSkill('assets/scenes/index.mjs');
  const { SCENE_RENDERERS } = await importSkill('assets/scenes/core.mjs');
  assert.deepEqual([...index.SCENE_IDS].sort(), [...sceneIds].sort());
  for (const id of sceneIds) {
    assert.equal(typeof index.SCENE_FACTORIES[id], 'function', `${id} 必须有工厂`);
    assert.equal(typeof SCENE_RENDERERS[id], 'function', `${id} 必须注册成片渲染器`);
    const frame = SCENE_RENDERERS[id](2, { width: 48, height: 27, seed: 'registry' });
    assert.equal(frame.data.length, 48 * 27 * 4);
    assert.ok(frame.data.some((n, i) => i % 4 !== 3 && n > 0), `${id} 的成片渲染不应是空帧`);
    // 每个模块只画自己的那一个镜头：换 id 的画法不会跟着变
    const module = await importSkill(`assets/scenes/${id}.mjs`);
    assert.equal(module[`create${id[0].toUpperCase()}${id.slice(1)}Scene`]({}).id, id);
  }
  const core = readFileSync(resolveSkill('assets/scenes/core.mjs'), 'utf8');
  assert.doesNotMatch(core, /DRAW\s*=/, 'core.mjs 不应再有 DRAW 下标表');
  assert.doesNotMatch(core, /SCENE_IDS\.indexOf/, 'core.mjs 不应再按 id 反查下标');
  for (const id of sceneIds) {
    const before = SCENE_RENDERERS[id](1, { width: 32, height: 18, seed: 'own' });
    const other = SCENE_RENDERERS[sceneIds.find(other => other !== id)](1, { width: 32, height: 18, seed: 'own' });
    assert.notDeepEqual([...before.data], [...other.data], `${id} 不应与其它镜头画出同一帧`);
  }
});
