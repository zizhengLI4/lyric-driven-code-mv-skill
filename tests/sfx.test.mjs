import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { SFX, SAMPLE_RATE, collectSfx, encodeWav, listSfx, renderSfx, renderTimeline } from '../skills/lyric-driven-code-mv/scripts/sfx.mjs';
import { analyzeStoryboard } from '../skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs';

const EXPECTED = ['chime', 'click', 'confirm', 'error', 'riser', 'tick', 'type', 'whoosh'];

const loadExample = () => JSON.parse(
  readFileSync(new URL('../skills/lyric-driven-code-mv/assets/storyboard-example.json', import.meta.url), 'utf8'),
);

test('SFX guide distinguishes BGM beat anchors from visual-event anchors and verifies mix causality', () => {
  const guide = readFileSync(new URL('../skills/lyric-driven-code-mv/references/sfx-and-beat.md', import.meta.url), 'utf8');
  assert.match(guide, /sourceOffset/);
  assert.match(guide, /clip 秒|成片秒/);
  assert.match(guide, /起始.*峰值|峰值.*起始/);
  assert.match(guide, /RMS.*不能|不能.*RMS/);
  assert.match(guide, /BGM-only 与 BGM\+SFX/);
  assert.match(guide, /anchor: "visual" \| "beat" \| "free"/u);
  assert.match(guide, /不能证明瞬变由 SFX 引起/u);
});

test('README and skill routing documents do not state that SFX must avoid beats', () => {
  const paths = [
    '../README.md',
    '../skills/lyric-driven-code-mv/SKILL.md',
    '../skills/lyric-driven-code-mv/assets/templates/starter/README.md',
  ];
  for (const path of paths) {
    const document = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(document, /音效不踩拍|音效落在画面事件上（不是拍点上）/u, path);
  }
});

test('SFX timing metadata records waveform start separately from the intended impact time', () => {
  const result = renderTimeline([
    { at: 1.39, hitAt: 1.6, anchor: 'beat', type: 'whoosh', gain: 0.4 },
  ], 3);
  assert.deepEqual(result.report.placed[0], {
    index: 0, at: 1.39, type: 'whoosh', startFrame: Math.round(1.39 * SAMPLE_RATE),
    frames: Math.ceil(SFX.whoosh.duration * SAMPLE_RATE), gain: 0.4,
    hitAt: 1.6, hitFrame: Math.round(1.6 * SAMPLE_RATE), anchor: 'beat',
  });
});

test('mixed-only verifier labels RMS as transient evidence rather than SFX attribution', async () => {
  const { verifySfxEvents } = await import('../skills/lyric-driven-code-mv/scripts/verify-sfx.mjs');
  const rate = 1000, duration = 1, events = [{ id: 'drum', at: 0.4 }];
  const samples = new Float32Array(rate * duration);
  samples.fill(0.5, 400, 450); // A BGM drum transient can resemble a short SFX.
  const report = verifySfxEvents({ events, samples, sampleRate: rate, duration, windowMs: 20 });
  assert.equal(report.status, 'transient-only');
  assert.equal(report.events[0].transientDetected, true);
  assert.equal(report.events[0].sfxAttributedCandidate, null);
});

test('reference difference rejects a BGM-only transient and detects an added localized SFX candidate', async () => {
  const { verifySfxEvents } = await import('../skills/lyric-driven-code-mv/scripts/verify-sfx.mjs');
  const rate = 1000, duration = 1, events = [{ id: 'impact', at: 0.39, hitAt: 0.4, anchor: 'beat' }];
  const bed = new Float32Array(rate * duration);
  bed.fill(0.5, 400, 450);
  const musicOnly = verifySfxEvents({ events, samples: bed, referenceSamples: bed, sampleRate: rate, duration, windowMs: 20 });
  assert.equal(musicOnly.status, 'no-localized-difference');
  assert.equal(musicOnly.events[0].sfxAttributedCandidate, false);

  const mixed = bed.slice();
  for (let i = 400; i < 410; i++) mixed[i] += 0.3;
  const withSfx = verifySfxEvents({ events, samples: mixed, referenceSamples: bed, sampleRate: rate, duration, windowMs: 20 });
  assert.equal(withSfx.status, 'difference-candidate');
  assert.equal(withSfx.events[0].sfxAttributedCandidate, true);
});

test('SFX beat anchor validates hitAt while preserving a pre-roll at', () => {
  const data = loadExample();
  data.project.sfx = [{ at: 1.29, hitAt: 1.5, anchor: 'beat', type: 'whoosh' }];
  assert.deepEqual(analyzeStoryboard(data).errors, []);
  assert.ok(!analyzeStoryboard(data).warnings.some(item => item.includes('project.sfx[0].hitAt')));

  data.project.sfx[0].hitAt = 1.6;
  assert.ok(analyzeStoryboard(data).warnings.some(item => item.includes('project.sfx[0].hitAt') && item.includes('偏差')));
  data.project.sfx[0] = { at: 1.6, hitAt: 1.5, anchor: 'beat', type: 'whoosh' };
  assert.ok(analyzeStoryboard(data).errors.some(item => item.includes('hitAt') && item.includes('at')));
  data.project.sfx[0] = { at: 1.29, anchor: 'beat', type: 'whoosh' };
  assert.ok(analyzeStoryboard(data).errors.some(item => item.includes('project.sfx[0].hitAt')));
  data.project.sfx[0] = { at: 1.29, hitAt: 1.5, anchor: 'unknown', type: 'whoosh' };
  assert.ok(analyzeStoryboard(data).errors.some(item => item.includes('project.sfx[0].anchor')));
});

test('beat-anchored scene SFX is checked against the beat grid after scene collection', () => {
  const data = loadExample();
  data.scenes[0].sfx = [{ at: 4.3, hitAt: 4.7, anchor: 'beat', type: 'whoosh' }];
  const warning = analyzeStoryboard(data).warnings.find(item => item.includes('scenes[0].sfx[0].hitAt'));
  assert.match(warning, /偏差/);
});

test('SFX CLI refuses to overwrite its storyboard with a WAV or report', t => {
  const dir = mkdtempSync(join(tmpdir(), 'sfx-overwrite-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const storyboard = join(dir, 'storyboard.json');
  const original = JSON.stringify({ project: { duration: 1, sfx: [{ at: 0.2, type: 'tick' }] }, scenes: [] });
  writeFileSync(storyboard, original);
  const script = fileURLToPath(new URL('../skills/lyric-driven-code-mv/scripts/sfx.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--from-storyboard', storyboard, '--out', storyboard], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /alias|overwrite|覆盖/i);
  assert.equal(readFileSync(storyboard, 'utf8'), original);
});

test('verification report preserves waveform start, intended hit, and anchor separately', async () => {
  const { verifySfxEvents } = await import('../skills/lyric-driven-code-mv/scripts/verify-sfx.mjs');
  const event = { id: 'lead-in-whoosh', at: 0.2, hitAt: 0.4, anchor: 'beat' };
  const report = verifySfxEvents({ events: [event], samples: new Float32Array(1000), sampleRate: 1000, duration: 1 });
  assert.equal(report.events[0].at, 0.2);
  assert.equal(report.events[0].hitAt, 0.4);
  assert.equal(report.events[0].anchor, 'beat');
});

test('SFX verifier refuses to overwrite its storyboard before decoding audio', t => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-sfx-overwrite-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const storyboard = join(dir, 'storyboard.json');
  const original = JSON.stringify({ project: { duration: 1, sfx: [{ at: 0.2, type: 'tick' }] }, scenes: [] });
  writeFileSync(storyboard, original);
  const script = fileURLToPath(new URL('../skills/lyric-driven-code-mv/scripts/verify-sfx.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--audio', join(dir, 'missing.wav'), '--storyboard', storyboard, '--out', storyboard], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /alias|overwrite|覆盖/i);
  assert.equal(readFileSync(storyboard, 'utf8'), original);
});

test('visual SFX anchor must point to an event in the same scene', () => {
  const data = loadExample();
  data.scenes[0].sfx = [{ at: 4.3, hitAt: 4.5, anchor: 'visual', type: 'whoosh' }];
  assert.deepEqual(analyzeStoryboard(data).errors, []);
  assert.ok(!analyzeStoryboard(data).warnings.some(item => item.includes('scenes[0].sfx[0].hitAt')));
  data.scenes[0].sfx[0].hitAt = 4.6;
  assert.ok(analyzeStoryboard(data).warnings.some(item => item.includes('scenes[0].sfx[0].hitAt') && item.includes('visual')));
  data.project.sfx = [{ at: 4.3, hitAt: 4.5, anchor: 'visual', type: 'whoosh' }];
  assert.ok(analyzeStoryboard(data).errors.some(item => item.includes('project.sfx[0].anchor')));
});

test('音效表就是这八种，顺序稳定', () => {
  assert.deepEqual(listSfx(), EXPECTED);
  for (const name of EXPECTED) assert.ok(SFX[name].duration > 0, `${name} 必须有正时长`);
});

test('单个音效长度 = duration / pitch', () => {
  const base = renderSfx('tick');
  assert.equal(base.length / 2, Math.ceil(SFX.tick.duration * SAMPLE_RATE));
  const fast = renderSfx('tick', { pitch: 2 });
  assert.ok(fast.length < base.length);
  assert.equal(fast.length / 2, Math.ceil((SFX.tick.duration / 2) * SAMPLE_RATE));
});

test('gain 与 pitch 越界、未知类型都直接抛错', () => {
  assert.throws(() => renderSfx('nope'), /未知音效类型/);
  assert.throws(() => renderSfx('tick', { gain: 2.5 }), /gain 必须在 0–2/);
  assert.throws(() => renderSfx('tick', { gain: -0.1 }), /gain 必须在 0–2/);
  assert.throws(() => renderSfx('tick', { pitch: 0.4 }), /pitch 必须在 0.5–2/);
  assert.throws(() => renderSfx('tick', { pitch: 2.1 }), /pitch 必须在 0.5–2/);
});

test('同一事件重复渲染逐采样一致', () => {
  const a = renderSfx('whoosh', { gain: 0.7 });
  const b = renderSfx('whoosh', { gain: 0.7 });
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i += 97) assert.equal(a[i], b[i]);
});

test('整条音效轨长度严格等于 duration', () => {
  for (const duration of [12, 3.5, 0.2]) {
    const { pcm, report } = renderTimeline([{ at: 0, type: 'tick' }], duration);
    assert.equal(pcm.length, Math.ceil(duration * SAMPLE_RATE) * 2);
    assert.equal(report.totalFrames, Math.ceil(duration * SAMPLE_RATE));
    assert.equal(report.duration, duration);
  }
});

test('越界事件被裁掉并记入 clipped，不抛错', () => {
  const { report } = renderTimeline([
    { at: 0.5, type: 'tick' },
    { at: 11.9, type: 'chime' },
  ], 12);
  assert.equal(report.events, 2);
  assert.equal(report.clipped.length, 1);
  assert.equal(report.clipped[0].type, 'chime');
});

test('音效证据校验接受0、1、9和46个事件，不硬编码事件数量', async () => {
  const { verifySfxEvents } = await import('../skills/lyric-driven-code-mv/scripts/verify-sfx.mjs');
  const rate = 1000;
  for (const count of [0, 1, 9, 46]) {
    const duration = Math.max(1, count * 0.2 + 0.5);
    const events = Array.from({ length: count }, (_, index) => ({ id: `e-${index + 1}`, at: 0.1 + index * 0.2 }));
    const samples = new Float32Array(Math.ceil(duration * rate));
    for (const event of events) {
      const start = Math.round(event.at * rate);
      samples.fill(0.5, start, start + 50);
    }
    const report = verifySfxEvents({ events, samples, sampleRate: rate, duration, windowMs: 50 });
    if (count === 0) {
      assert.equal(report.status, 'skip');
      assert.equal(report.total, 0);
    } else {
      assert.equal(report.status, 'transient-only');
      assert.equal(report.events.every(event => event.sfxAttributedCandidate === null), true);
      assert.equal(report.total, count);
      assert.equal(report.hits, count);
    }
  }
});

test('事件时刻决定起音：at 之前必须近乎静音', () => {
  const { pcm } = renderTimeline([{ at: 1.0, type: 'tick', gain: 1 }], 2);
  const at = Math.round(1.0 * SAMPLE_RATE);
  let before = 0;
  for (let i = 0; i < at - 100; i++) before = Math.max(before, Math.abs(pcm[i * 2]));
  let inside = 0;
  for (let i = at; i < at + 200; i++) inside = Math.max(inside, Math.abs(pcm[i * 2]));
  assert.ok(before < 0.01, `at 之前应近乎静音，实测 ${before}`);
  assert.ok(inside > 0.2, `at 之后应有明显能量，实测 ${inside}`);
});

test('叠加后峰值归一，不超过 0.98', () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ at: 0.5 + i * 0.01, type: 'chime', gain: 2 }));
  const { pcm, report } = renderTimeline(many, 3);
  assert.ok(report.peakBeforeNorm <= 0.98 + 1e-6 || report.normalization < 1);
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  assert.ok(peak <= 0.98 + 1e-6, `归一后峰值 ${peak}`);
});

test('首尾各有淡入淡出，截断处不爆音', () => {
  const { pcm } = renderTimeline([{ at: 0, type: 'chime', gain: 1 }], 0.5);
  assert.ok(Math.abs(pcm[0]) < 1e-6, '第一采样应为 0');
  const last = pcm.length - 2;
  assert.ok(Math.abs(pcm[last]) < 0.02, `末采样应已淡出，实测 ${pcm[last]}`);
});

test('WAV 头符合 44.1kHz / 16-bit / 立体声', () => {
  const buf = encodeWav(renderSfx('click'));
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
  assert.equal(buf.readUInt16LE(20), 1);
  assert.equal(buf.readUInt16LE(22), 2);
  assert.equal(buf.readUInt32LE(24), SAMPLE_RATE);
  assert.equal(buf.readUInt16LE(34), 16);
  assert.equal(buf.readUInt32LE(4), buf.length - 8);
});

test('collectSfx 合并 project 与各镜并按时间排序', () => {
  const storyboard = {
    project: { sfx: [{ at: 0, type: 'riser' }] },
    scenes: [
      { sfx: [{ at: 5, type: 'type' }, null, 'x'] },
      { sfx: [{ at: 6, type: 'whoosh' }] },
    ],
  };
  const merged = collectSfx(storyboard);
  assert.deepEqual(merged.map((item) => item.at), [0, 5, 6]);
  assert.deepEqual(merged.map((item) => item.type), ['riser', 'type', 'whoosh']);
});

test('校验器接受八种合法音效，拒绝未知类型与越界数值', () => {
  const base = (sfx) => { const data = loadExample(); data.project.sfx = sfx; return data; };

  const ok = base(EXPECTED.map((type, i) => ({ at: 0.5 * i, type, gain: 1, pitch: 1 })));
  assert.deepEqual(analyzeStoryboard(ok).errors, []);

  assert.match(analyzeStoryboard(base([{ at: 1, type: 'boom' }])).errors.join('\n'), /project\.sfx\[0\]\.type: 必须为/);
  assert.match(analyzeStoryboard(base([{ at: 1, type: 'tick', gain: 2.5 }])).errors.join('\n'), /gain: 必须在 0–2 之间/);
  assert.match(analyzeStoryboard(base([{ at: 1, type: 'tick', pitch: 0.2 }])).errors.join('\n'), /pitch: 必须在 0.5–2 之间/);
  // 越界值要从示例分镜自己的时长推出来，别写死数字：示例从 12 秒改成 26 秒后，
  // 写死的 at:12 变成了合法时点，这条断言就会静默失效。
  const { duration } = loadExample().project;
  assert.match(analyzeStoryboard(base([{ at: duration + 1, type: 'tick' }])).errors.join('\n'), /必须小于 project\.duration/);
  assert.match(analyzeStoryboard(base([{ at: -1, type: 'tick' }])).errors.join('\n'), /必须为非负数/);
});

test('校验器同时检查 scene.sfx，路径能定位到具体镜', () => {
  const data = loadExample();
  // 示例只有一镜，这里补一个派生镜来验证 scenes[i] 路径能定位到具体镜。
  // lyricIds 必须清空：复制来的歌词区间只覆盖第一镜，会让派生镜多出不相交的错误。
  const extra = { ...structuredClone(data.scenes[0]), id: 'reply', start: 24, end: 30, events: [], hud: [], lyricIds: [] };
  data.scenes.push(extra);
  data.project.duration = 30;
  data.chapters[data.chapters.length - 1].end = 30;
  data.scenes[0].sfx = [{ at: 1, type: 'tick' }];
  data.scenes[1].sfx = [{ at: 25, type: 'nope' }];
  const { errors } = analyzeStoryboard(data);
  assert.deepEqual(errors, ['scenes[1].sfx[0].type: 必须为 chime、click、confirm、error、riser、tick、type、whoosh 之一']);
});

test('没有 sfx 字段时校验不受影响（向后兼容）', () => {
  const data = loadExample();
  assert.equal(data.project.sfx, undefined);
  assert.deepEqual(analyzeStoryboard(data).errors, []);
});

test('示范分镜视觉事件落在拍点，长音效波形可预启动而hitAt落在拍点', () => {
  const demo = JSON.parse(
    readFileSync(new URL('../skills/lyric-driven-code-mv/assets/storyboard-sfx-demo.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(analyzeStoryboard(demo).errors, []);
  const beats = new Set(demo.music.beats);
  for (const scene of demo.scenes) {
    for (const event of scene.events) {
      assert.ok(beats.has(event.at), `${scene.id} 的 ${event.at}s 不在拍点网格上`);
      assert.equal(event.sync, 'beat');
    }
    for (const item of scene.sfx ?? []) {
      assert.equal(item.anchor, 'beat');
      assert.ok(demo.music.beats.some((beat) => Math.abs(beat - item.hitAt) < 1e-9), `${scene.id} 的音效 hitAt ${item.hitAt}s 不在拍点网格上`);
      assert.ok(item.at <= item.hitAt, `${scene.id} 的音效波形起点不得晚于 hitAt`);
    }
  }
});

test('bundled nine-event evidence demo passes the CLI without event-count assumptions', async t => {
  const { requireMediaTools } = await import('./media-tools.mjs');
  const tools = requireMediaTools(t, ['ffmpeg']); if (!tools) return;
  const directory = mkdtempSync(join(tmpdir(), 'sfx-demo-nine-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const demoPath = new URL('../skills/lyric-driven-code-mv/assets/storyboard-sfx-demo.json', import.meta.url);
  const demo = JSON.parse(readFileSync(demoPath, 'utf8'));
  const events = collectSfx(demo);
  assert.equal(events.length, 9);
  const { pcm } = renderTimeline(events, demo.project.duration);
  const audioPath = join(directory, 'mixed.wav'), referencePath = join(directory, 'music-only.wav'), evidencePath = join(directory, 'evidence.json');
  writeFileSync(audioPath, encodeWav(pcm));
  writeFileSync(referencePath, encodeWav(new Float32Array(pcm.length)));
  const cliPath = fileURLToPath(new URL('../skills/lyric-driven-code-mv/scripts/verify-sfx.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cliPath, '--audio', audioPath, '--reference-audio', referencePath, '--storyboard', fileURLToPath(demoPath), '--ffmpeg', tools.ffmpeg, '--out', evidencePath], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /9\/9 个事件窗口检测到瞬变/);
  assert.match(result.stdout, /BGM-only 参考轨/);
  assert.match(result.stdout, /5\.790→6\.000s \(beat\)/);
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.events.length, 9);
  assert.equal(evidence.status, 'difference-candidate');
  assert.match(evidence.evidenceScope, /difference between aligned mixed PCM/);
  assert.ok(evidence.events.every(event => event.hit && event.sfxAttributedCandidate));
});

test('音效混音保持音乐 RMS 不低于原始 RMS 的 90%', async t => {
  const { requireMediaTools } = await import('./media-tools.mjs');
  const tools = requireMediaTools(t, ['ffmpeg']); if (!tools) return;
  const directory = mkdtempSync(join(tmpdir(), 'sfx-rms-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const audioPath = join(directory, 'audio.wav');
  const source = spawnSync(tools.ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-filter:a', 'volume=0.35', '-ac', '2', '-c:a', 'pcm_s16le', audioPath], { windowsHide: true });
  assert.equal(source.status, 0, source.stderr?.toString());
  const decode = path => {
    const result = spawnSync(tools.ffmpeg, ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr?.toString());
    let energy = 0, count = 0;
    for (let i = 0; i + 4 <= result.stdout.length; i += 4) { const sample = result.stdout.readFloatLE(i); energy += sample * sample; count++; }
    return Math.sqrt(energy / count);
  };
  const originalRms = decode(audioPath);
  const events = Array.from({ length: 45 }, (_, i) => ({ at: 0.1 + i * 0.064, type: 'click', gain: 0.1 }));
  const { mixSfx } = await import('../skills/lyric-driven-code-mv/assets/templates/starter/export.mjs');
  await mixSfx({ ffmpeg: tools.ffmpeg, sfx: events, sfxGain: 0.85, duration: 3 }, directory, () => {});
  const mixedRms = decode(join(directory, 'audio.wav'));
  assert.ok(mixedRms >= originalRms * 0.9, `mixed RMS ${mixedRms} must remain >= 90% of source RMS ${originalRms}`);
});
