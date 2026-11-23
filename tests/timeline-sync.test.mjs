// timeline-sync.py 的 --align 行为验收 + 回归
// 该脚本此前完全没有测试覆盖（sync.test.mjs 测的是 visualize-sync.mjs）
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const SCRIPT = resolve('skills/lyric-driven-code-mv/scripts/timeline-sync.py');
const PY = process.platform === 'win32' ? 'python' : 'python3';

// 8 秒 / 8kHz 单声道 WAV：在给定时刻放短促脉冲，其余近乎静音。
function writeWav(path, seconds = 8, sr = 8000, pulses = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]) {
  const total = Math.floor(seconds * sr);
  const data = Buffer.alloc(total * 2);
  for (const at of pulses) {
    const start = Math.floor(at * sr);
    for (let i = 0; i < 240 && start + i < total; i++) {
      const v = Math.round(20000 * Math.exp(-i / 60) * Math.sin(i * 0.9));
      data.writeInt16LE(Math.max(-32768, Math.min(32767, v)), (start + i) * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sr, 24); header.writeUInt32LE(sr * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

const storyboard = (extra = {}) => ({
  schemaVersion: 1,
  timebase: 'clip',
  project: { duration: 8, width: 1920, height: 1080, sourceOffset: 0 },
  music: {
    status: 'draft',
    beats: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0],
    sections: [{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 4, end: 8 }],
    ...extra.music,
  },
  lyrics: [{ id: 'l1', start: 1.0, end: 2.0, text: '第一句' }, { id: 'l2', start: 5.0, end: 6.0, text: '第二句' }],
  scenes: [
    { id: 's1', start: 0, end: 4, exit: { type: 'cut', dur: 0 } },
    { id: 's2', start: 4, end: 8, exit: { type: 'cut', dur: 0 } },
  ],
  chapters: [{ id: 'c1', start: 0, end: 8, title: '整段' }],
});

const run = (args) => spawnSync(PY, [SCRIPT, ...args], { encoding: 'utf8', timeout: 60000, windowsHide: true });

const setup = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tl-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const audio = join(dir, 'clip.wav');
  writeWav(audio);
  const sb = join(dir, 'storyboard.json');
  writeFileSync(sb, JSON.stringify(storyboard()));
  return { dir, audio, sb, png: join(dir, 'timeline.png'), json: join(dir, 'report.json') };
};

test('省略 --align 时，有 music.sections 就按 sections 口径', t => {
  const { audio, sb, png } = setup(t);
  const r = run([audio, '--storyboard', sb, '-o', png]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /align sections/);
  assert.match(r.stdout, /cut-to-section/);
});

test('--align beats 只输出拍点口径', t => {
  const { audio, sb, png } = setup(t);
  const r = run([audio, '--storyboard', sb, '-o', png, '--align', 'beats']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /cut-to-beats/);
  assert.doesNotMatch(r.stdout, /cut-to-lyrics/);
});

test('--align lyrics 输出歌词句头口径，且带符号偏移', t => {
  const { audio, sb, png } = setup(t);
  const r = run([audio, '--storyboard', sb, '-o', png, '--align', 'lyrics']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /cut-to-lyrics/);
  assert.match(r.stdout, /offset median/);
  assert.match(r.stdout, /signed/);
});

test('--align 多选时两种口径都出现', t => {
  const { audio, sb, png } = setup(t);
  const r = run([audio, '--storyboard', sb, '-o', png, '--align', 'beats,lyrics']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /cut-to-beats/);
  assert.match(r.stdout, /cut-to-lyrics/);
});

test('--align 未知口径报错退出，不静默忽略', t => {
  const { audio, sb, png } = setup(t);
  const r = run([audio, '--storyboard', sb, '-o', png, '--align', 'nonsense']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /--align 只接受|beats\/lyrics\/sections/);
  assert.equal(existsSync(png), false);
});

test('--align 空值报错', t => {
  const { audio, sb, png } = setup(t);
  const r = run([audio, '--storyboard', sb, '-o', png, '--align', '']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /--align 不能为空|--align 只接受/);
});

test('参考数据缺失时报告 unavailable，不伪造匹配', t => {
  const dir = mkdtempSync(join(tmpdir(), 'tl-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const audio = join(dir, 'clip.wav');
  writeWav(audio);
  const sb = join(dir, 'no-refs.json');
  const data = storyboard();
  data.music.beats = [];
  data.music.sections = [];
  data.lyrics = [];
  writeFileSync(sb, JSON.stringify(data));

  const r = run([audio, '--storyboard', sb, '-o', join(dir, 'x.png'), '--align', 'sections,lyrics']);
  assert.equal(r.status, 0, r.stderr);
  // 没有参考点时必须显式说明不可用，不能编一个 0ms 出来
  assert.match(r.stdout, /unavailable|n\/a|无可用|不可用|no reference/i);
});

test('--json 报告带对齐口径与状态字段', t => {
  const { audio, sb, png, json } = setup(t);
  const r = run([audio, '--storyboard', sb, '-o', png, '--json', json, '--align', 'beats,sections']);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(readFileSync(json, 'utf8'));
  assert.ok(report.alignment || report.align, '报告要含对齐信息');
  const text = JSON.stringify(report);
  assert.match(text, /beats/);
  assert.match(text, /sections/);
  // BPM 只能是推测
  assert.equal(report.bpm_status, 'speculative');
});

test('--analysis 使用统一的局部拍点及证据，不再从同一音频另算一条拍网格', t => {
  const { audio, sb, dir, png, json } = setup(t);
  const analysis = join(dir, 'analysis.json');
  const beatTimes = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
  writeFileSync(analysis, JSON.stringify({
    schemaVersion: 1, status: 'draft', timebase: 'clip', sourceOffset: 0,
    duration: 8, sampleRate: 8000, beats: beatTimes,
    beatDetails: beatTimes.map(at => ({ at, confidence: 0.9, evidence: 'observed' })),
    energy: { envelope: [] }, tempo: { bpm: 120, status: 'estimated' },
  }));
  const r = run([audio, '--storyboard', sb, '-o', png, '--json', json, '--analysis', analysis, '--align', 'beats']);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(readFileSync(json, 'utf8'));
  assert.equal(report.beat_source, 'analyze-audio');
  assert.equal(report.beats.length, beatTimes.length);
  assert.deepEqual(report.beats, beatTimes);
  assert.deepEqual(report.beatDetails.map(beat => beat.evidence), Array(beatTimes.length).fill('observed'));
  assert.equal(report.alignment.beats.source, 'storyboard-music-beats');
  assert.doesNotMatch(r.stdout, /speculative BPM/);
});

// ── BPM 对照：脚本估计 vs 分镜网格 ─────────────────────────────────
// 起因是实测发现两个工具对同一首歌给出不同 BPM（125 vs 98.8 vs 正确的 144.1），
// 谁照着错的那个数排拍点就重演「大部分没卡上」。脚本必须把分歧显式说出来。
test('分镜带拍点网格时，报告并排给出两个 BPM 与对照结论', t => {
  const { audio, sb, png, json } = setup(t);
  const r = run([audio, '--storyboard', sb, '-o', png, '--json', json, '--align', 'beats']);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(readFileSync(json, 'utf8'));
  assert.equal(report.bpm_status, 'speculative');
  assert.equal(report.bpm_grid_status, 'storyboard-grid');
  assert.equal(typeof report.bpm_grid, 'number');
  assert.ok(report.bpm_reconciliation, '必须给出对照结论，不能各报一个数就完事');
  assert.ok(['agree', 'disagree', 'octave-double', 'octave-half'].includes(report.bpm_reconciliation.status));
  // 人读的那一行也要有
  assert.match(r.stdout, /bpm from storyboard grid/);
});

test('分镜网格与脚本估计一致时判定 agree', t => {
  const dir = mkdtempSync(join(tmpdir(), 'tl-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const audio = join(dir, 'clip.wav');
  writeWav(audio);
  // 0.5s 等距的拍点 = 120 BPM，与脉冲位置一致，脚本也应估到附近
  const sb = join(dir, 'grid.json');
  writeFileSync(sb, JSON.stringify(storyboard()));
  const r = run([audio, '--storyboard', sb, '-o', join(dir, 'a.png'), '--json', join(dir, 'a.json')]);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(readFileSync(join(dir, 'a.json'), 'utf8'));
  assert.equal(report.bpm_grid_status, 'storyboard-grid');
  // 同一份拍的网格，两个数应落在 5% 内
  assert.equal(report.bpm_reconciliation.status, 'agree', `实际 ${report.bpm} vs ${report.bpm_grid}`);
});

test('分镜没有 music.beats 时对照为 null，不编造', t => {
  const dir = mkdtempSync(join(tmpdir(), 'tl-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const audio = join(dir, 'clip.wav');
  writeWav(audio);
  const data = storyboard();
  delete data.music.beats;
  const sb = join(dir, 'nobeats.json');
  writeFileSync(sb, JSON.stringify(data));
  const r = run([audio, '--storyboard', sb, '-o', join(dir, 'b.png'), '--json', join(dir, 'b.json')]);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(readFileSync(join(dir, 'b.json'), 'utf8'));
  assert.equal(report.bpm_grid, null);
  assert.equal(report.bpm_grid_status, null);
  assert.equal(report.bpm_reconciliation, null);
  assert.doesNotMatch(r.stdout, /bpm from storyboard grid/);
});

// ── beats 口径的参考点来源 ──────────────────────────────────────────
// 分镜自带 music.beats 时，切点必须拿它比对，而不是脚本从头估的拍点。
// 起因是实测：切点已精确吸附到分镜网格（偏差 0），但脚本拿自己估的拍点去比，
// 得出「4/12 卡在 80ms 内」的假结论，会让人误以为分镜没卡上。
test('beats 口径优先用分镜的 music.beats 作为参考点', t => {
  const dir = mkdtempSync(join(tmpdir(), 'tl-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const audio = join(dir, 'clip.wav');
  writeWav(audio);

  // 切点全部落在 music.beats 上：0 与 4 都在网格里，比对结果必须是 0ms
  const data = storyboard();
  data.music.beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5];
  data.scenes = [
    { id: 's1', start: 0, end: 4, exit: { type: 'cut', dur: 0 } },
    { id: 's2', start: 4, end: 8, exit: { type: 'cut', dur: 0 } },
  ];
  const sb = join(dir, 'grid.json');
  writeFileSync(sb, JSON.stringify(data));

  const r = run([audio, '--storyboard', sb, '-o', join(dir, 'g.png'), '--json', join(dir, 'g.json'), '--align', 'beats']);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(readFileSync(join(dir, 'g.json'), 'utf8'));
  const stats = report.alignment.beats;
  assert.equal(stats.status, 'ok');
  assert.equal(stats.source, 'storyboard-music-beats', '必须用分镜网格，不能用 estimated-beats');
  assert.equal(stats.reference_count, 16);
  assert.equal(stats.abs_offset_max, 0, '切点就在网格上，最大偏差必须是 0');
  assert.equal(stats.within_80ms, 2);
});

test('分镜没有 music.beats 时 beats 口径复用 audio-analysis 报告并如实标注', t => {
  const dir = mkdtempSync(join(tmpdir(), 'tl-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const audio = join(dir, 'clip.wav');
  writeWav(audio);
  const data = storyboard();
  delete data.music.beats;
  const sb = join(dir, 'nobeats.json');
  writeFileSync(sb, JSON.stringify(data));
  const r = run([audio, '--storyboard', sb, '-o', join(dir, 'n.png'), '--json', join(dir, 'n.json'), '--align', 'beats']);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(readFileSync(join(dir, 'n.json'), 'utf8'));
  assert.equal(report.alignment.beats.source, 'audio-analysis-beats', '没有分镜网格时要标出来自共享音频分析');
});

test('PNG 与 JSON 输出分别拒绝覆盖音频或分镜输入', t => {
  const first = setup(t);
  const audioBytes = readFileSync(first.audio), storyboardBytes = readFileSync(first.sb);
  assert.notEqual(run([first.audio, '--storyboard', first.sb, '-o', first.audio]).status, 0);
  assert.notEqual(run([first.audio, '--storyboard', first.sb, '-o', join(first.dir, 'safe.png'), '--json', first.sb]).status, 0);
  assert.deepEqual(readFileSync(first.audio), audioBytes);
  assert.deepEqual(readFileSync(first.sb), storyboardBytes);
});

test('输出拒绝覆盖音频或分镜输入', t => {
  const { audio, sb, dir } = setup(t);
  const audioBytes = readFileSync(audio), storyboardBytes = readFileSync(sb);
  assert.notEqual(run([audio, '--storyboard', sb, '-o', audio]).status, 0);
  assert.notEqual(run([audio, '--storyboard', sb, '-o', join(dir, 'safe.png'), '--json', sb]).status, 0);
  assert.deepEqual(readFileSync(audio), audioBytes);
  assert.deepEqual(readFileSync(sb), storyboardBytes);
});

test('输出 PNG 与 JSON 都真实落盘', t => {
  const { audio, sb, png, json } = setup(t);
  const r = run([audio, '--storyboard', sb, '-o', png, '--json', json]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(statSync(png).size > 1000, 'PNG 应该有实际内容');
  assert.ok(statSync(json).size > 50, 'JSON 应该有实际内容');
});
