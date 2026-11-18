import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { SFX, SAMPLE_RATE, collectSfx, encodeWav, listSfx, renderSfx, renderTimeline } from '../scripts/sfx.mjs';
import { analyzeStoryboard } from '../scripts/validate-storyboard.mjs';

const EXPECTED = ['chime', 'click', 'confirm', 'error', 'riser', 'tick', 'type', 'whoosh'];

const loadExample = () => JSON.parse(
  readFileSync(new URL('../assets/storyboard-example.json', import.meta.url), 'utf8'),
);

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

test('示范分镜本身通过校验，且事件时间都落在 0.5s 拍点网格上', () => {
  const demo = JSON.parse(
    readFileSync(new URL('../assets/storyboard-sfx-demo.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(analyzeStoryboard(demo).errors, []);
  const beats = new Set(demo.music.beats);
  for (const scene of demo.scenes) {
    for (const event of scene.events) {
      assert.ok(beats.has(event.at), `${scene.id} 的 ${event.at}s 不在拍点网格上`);
      assert.equal(event.sync, 'beat');
    }
    for (const item of scene.sfx ?? []) {
      assert.ok(demo.music.beats.some((beat) => Math.abs(beat - item.at) < 1e-9), `${scene.id} 的音效 ${item.at}s 不在拍点网格上`);
    }
  }
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
  const { mixSfx } = await import('../assets/templates/starter/export.mjs');
  await mixSfx({ ffmpeg: tools.ffmpeg, sfx: events, sfxGain: 0.85, duration: 3 }, directory, () => {});
  const mixedRms = decode(join(directory, 'audio.wav'));
  assert.ok(mixedRms >= originalRms * 0.9, `mixed RMS ${mixedRms} must remain >= 90% of source RMS ${originalRms}`);
});
