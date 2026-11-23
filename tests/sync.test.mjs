import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, linkSync, mkdirSync, readdirSync } from 'node:fs';
import { rename as renameFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildSyncReport, renderSyncSVG, writeSyncReport, parseArgs } from '../skills/lyric-driven-code-mv/scripts/visualize-sync.mjs';

const fixture = () => ({
  storyboard: { schemaVersion: 1, timebase: 'clip', project: { duration: 4, sourceOffset: 37.2 }, music: { status: 'draft', captionRole: 'narration' }, scenes: [{ id: 'first', start: 0, end: 2.1 }, { id: 'second', start: 2.1, end: 4 }], lyrics: [{ id: 'line', start: 1.3, end: 3, text: '原创叙事字幕 <灯> & "雪"' }] },
  analysis: { schemaVersion: 1, status: 'draft', timebase: 'clip', sourceOffset: 37.2, duration: 4, sampleRate: 8000, energy: { envelope: [{ at: 0, normalized: 0 }, { at: 1, normalized: 1 }, { at: 2, normalized: 0.1 }] }, beats: [0, 1, 2, 3], tempo: { status: 'estimated', bpm: 60 } },
});

test('所有轨道使用同一成片时钟，报告有符号候选误差且不升级状态', () => {
  const { storyboard, analysis } = fixture();
  const before = JSON.stringify({ storyboard, analysis });
  const report = buildSyncReport(storyboard, analysis);
  assert.equal(report.timebase, 'clip');
  assert.equal(report.status, 'candidate-review');
  assert.equal(report.musicStatus, 'draft');
  assert.equal(report.captionRole, 'narration');
  assert.equal(report.sceneStarts[1].nearestBeat, 2);
  assert.equal(report.sceneStarts[1].deltaSeconds, 0.1);
  assert.equal(report.captions[0].deltaSeconds, 0.3);
  assert.equal(report.summary.internalSceneStarts.count, 1);
  assert.equal(JSON.stringify({ storyboard, analysis }), before);
  const svg = renderSyncSVG(report);
  assert.ok(svg.includes('原创叙事字幕 &lt;灯&gt; &amp; &quot;雪&quot;'));
  assert.ok(svg.includes('候选节拍'));
});

test('最近拍点平距选早拍，负数代表提前', () => {
  const { storyboard, analysis } = fixture();
  storyboard.lyrics[0].start = 1.9;
  storyboard.scenes[0].end = storyboard.scenes[1].start = 2.5;
  const report = buildSyncReport(storyboard, analysis);
  assert.equal(report.captions[0].deltaSeconds, -0.1);
  assert.equal(report.sceneStarts[1].nearestBeat, 2);
  assert.equal(report.sceneStarts[1].deltaSeconds, 0.5);
});

test('为镜头切点和明确的踩拍事件给出带证据的建议但不修改分镜', () => {
  const { storyboard, analysis } = fixture();
  storyboard.scenes[1].events = [
    { at: 2.9, action: '动作峰值', sync: 'beat' },
    { at: 2.7, action: '自由叙事动作', sync: 'none' },
  ];
  analysis.beatDetails = analysis.beats.map((at, index) => ({
    at, confidence: index === 3 ? 0.32 : 0.9,
    evidence: index === 3 ? 'predicted' : 'observed',
  }));
  const before = JSON.stringify(storyboard);
  const report = buildSyncReport(storyboard, analysis);
  assert.equal(report.alignmentSuggestions.length, 2);
  const cut = report.alignmentSuggestions.find(item => item.kind === 'scene-cut');
  assert.equal(cut.targetAt, 2.1);
  assert.equal(cut.suggestedAt, 2);
  assert.equal(cut.deltaMs, 100);
  assert.equal(cut.evidence, 'observed');
  const action = report.alignmentSuggestions.find(item => item.kind === 'event');
  assert.equal(action.cueId, 'second:event-1');
  assert.equal(action.status, 'low-confidence');
  assert.equal(action.suggestedAt, null);
  assert.equal(JSON.stringify(storyboard), before);
});

test('无候选节拍仍能画能量与字幕，误差为空', () => {
  const { storyboard, analysis } = fixture();
  analysis.beats = [];
  const report = buildSyncReport(storyboard, analysis);
  assert.equal(report.captions[0].nearestBeat, null);
  assert.equal(report.captions[0].deltaSeconds, null);
  assert.equal(report.summary.captionStarts.meanAbsMs, null);
  assert.ok(renderSyncSVG(report).includes('无候选拍点'));
});

test('拒绝原曲时钟、偏移错配、时长错配和异常拍点', () => {
  for (const mutate of [a => { a.timebase = 'source'; }, a => { a.sourceOffset = 0; }, a => { a.duration = 5; }, a => { a.beats = [0, 4]; }, a => { a.beats = [2, 1]; }, a => { a.energy.envelope[0].normalized = NaN; }]) {
    const { storyboard, analysis } = fixture(); mutate(analysis);
    assert.throws(() => buildSyncReport(storyboard, analysis));
  }
});

test('允许帧数换算与六位小数舍入，仍拒绝真实越界和空区间', () => {
  const { storyboard, analysis } = fixture();
  storyboard.project.duration = 4064 / 30;
  storyboard.scenes[1].end = 135.466667;
  analysis.duration = 135.466667;
  assert.doesNotThrow(() => buildSyncReport(storyboard, analysis));
  storyboard.lyrics[0].end = 136;
  assert.throws(() => buildSyncReport(storyboard, analysis), /区间/);
  storyboard.lyrics[0].end = storyboard.lyrics[0].start;
  assert.throws(() => buildSyncReport(storyboard, analysis), /区间/);
});

test('包络降采样限制输出规模并保留短促峰值', () => {
  const { storyboard, analysis } = fixture();
  analysis.energy.envelope = Array.from({ length: 20000 }, (_, i) => ({ at: i * 4 / 20000, normalized: i === 12345 ? 1 : 0 }));
  const report = buildSyncReport(storyboard, analysis);
  assert.ok(report.energy.length <= 1600);
  assert.equal(Math.max(...report.energy.map(p => p.normalized)), 1);
  assert.ok(renderSyncSVG(report).length < 200000);
  assert.equal(report.sampling.originalEnergyPoints, 20000);
});

test('CLI写SVG及相邻JSON，源输入哈希可追溯且不覆盖输入', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-chart-'));
  try {
    const { storyboard, analysis } = fixture();
    const sb = join(dir, 'storyboard.json'), an = join(dir, 'analysis.json'), out = join(dir, 'chart.svg');
    writeFileSync(sb, JSON.stringify(storyboard)); writeFileSync(an, JSON.stringify(analysis));
    const sources = [readFileSync(sb), readFileSync(an)];
    await writeSyncReport({ storyboard: sb, analysis: an, out });
    const saved = JSON.parse(readFileSync(join(dir, 'chart.json'), 'utf8'));
    assert.match(saved.inputs.storyboard.sha256, /^[a-f0-9]{64}$/);
    assert.equal(saved.sceneStarts[1].deltaSeconds, 0.1);
    await assert.rejects(writeSyncReport({ storyboard: sb, analysis: an, out: join(dir, 'storyboard.svg') }), /覆盖/);
    assert.deepEqual(readFileSync(sb), sources[0]); assert.deepEqual(readFileSync(an), sources[1]);
    const cli = fileURLToPath(new URL('../skills/lyric-driven-code-mv/scripts/visualize-sync.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [cli, sb, an, '--out', join(dir, 'cli.svg')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(readFileSync(join(dir, 'cli.svg'), 'utf8').startsWith('<svg'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI拒绝缺参数、未知选项、非SVG输出', () => {
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.equal(parseArgs(['s.json', 'a.json', '--out', 'r.svg']).out, 'r.svg');
  for (const args of [[], ['s.json'], ['s.json', 'a.json'], ['s.json', 'a.json', '--out', 'r.json'], ['s.json', 'a.json', '--x', 'r.svg']]) assert.throws(() => parseArgs(args));
});

test('SVG 与 JSON 输出通过硬链接指向同一文件时拒绝发布', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-output-hardlink-'));
  try {
    const { storyboard, analysis } = fixture();
    const sb = join(dir, 'storyboard.json'), an = join(dir, 'analysis.json');
    const svg = join(dir, 'report.svg'), json = join(dir, 'report.json');
    writeFileSync(sb, JSON.stringify(storyboard));
    writeFileSync(an, JSON.stringify(analysis));
    writeFileSync(svg, 'preserve existing deliverable');
    linkSync(svg, json);
    const before = readFileSync(svg);
    await assert.rejects(writeSyncReport({ storyboard: sb, analysis: an, out: svg }), /输出.*同一文件|同一.*输出/);
    assert.deepEqual(readFileSync(svg), before);
    assert.deepEqual(readFileSync(json), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('相邻JSON通过硬链接指向输入时也拒绝覆盖', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-alias-'));
  try {
    const { storyboard, analysis } = fixture();
    const sb = join(dir, 'source.json'), an = join(dir, 'analysis.json');
    writeFileSync(sb, JSON.stringify(storyboard)); writeFileSync(an, JSON.stringify(analysis));
    linkSync(an, join(dir, 'chart.json'));
    await assert.rejects(writeSyncReport({ storyboard: sb, analysis: an, out: join(dir, 'chart.svg') }), /覆盖/);
    assert.equal(JSON.parse(readFileSync(an, 'utf8')).status, 'draft');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('成片终点起始的微小区间不得被末尾容差接纳', () => {
  const { storyboard, analysis } = fixture();
  storyboard.lyrics[0].start = 4;
  storyboard.lyrics[0].end = 4 + 5e-7;
  assert.throws(() => buildSyncReport(storyboard, analysis), /区间/);
});

test('第二个输出是目录时保留旧SVG，且不留下孤立临时文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-directory-'));
  try {
    const { storyboard, analysis } = fixture();
    const sb = join(dir, 'source.json'), an = join(dir, 'analysis.json'), out = join(dir, 'chart.svg');
    writeFileSync(sb, JSON.stringify(storyboard)); writeFileSync(an, JSON.stringify(analysis));
    const original = Buffer.from('原SVG\n'); writeFileSync(out, original); mkdirSync(join(dir, 'chart.json'));
    await assert.rejects(writeSyncReport({ storyboard: sb, analysis: an, out }), /目录/);
    assert.deepEqual(readFileSync(out), original);
    assert.deepEqual(readdirSync(dir).sort(), ['analysis.json', 'chart.json', 'chart.svg', 'source.json']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('第二个新文件提交失败时整对恢复旧内容并清理临时文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-rollback-'));
  try {
    const { storyboard, analysis } = fixture();
    const sb = join(dir, 'source.json'), an = join(dir, 'analysis.json'), out = join(dir, 'chart.svg'), jsonOut = join(dir, 'chart.json');
    writeFileSync(sb, JSON.stringify(storyboard)); writeFileSync(an, JSON.stringify(analysis));
    const oldSVG = Buffer.from('old SVG bytes\n'), oldJSON = Buffer.from('{"old":"JSON"}\n');
    writeFileSync(out, oldSVG); writeFileSync(jsonOut, oldJSON);
    await assert.rejects(writeSyncReport({ storyboard: sb, analysis: an, out }, { rename: async (from, to) => {
      if (basename(from) === 'report.json' && to === jsonOut) throw new Error('模拟第二个提交失败');
      await renameFile(from, to);
    } }), /模拟第二个提交失败/);
    assert.deepEqual(readFileSync(out), oldSVG); assert.deepEqual(readFileSync(jsonOut), oldJSON);
    assert.deepEqual(readdirSync(dir).sort(), ['analysis.json', 'chart.json', 'chart.svg', 'source.json']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('回滚失败时保留原文件备份并返回备份位置', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-rollback-evidence-'));
  try {
    const { storyboard, analysis } = fixture();
    const sb = join(dir, 'source.json'), an = join(dir, 'analysis.json'), out = join(dir, 'chart.svg'), jsonOut = join(dir, 'chart.json');
    writeFileSync(sb, JSON.stringify(storyboard)); writeFileSync(an, JSON.stringify(analysis));
    const oldSVG = Buffer.from('old SVG bytes\n'), oldJSON = Buffer.from('{"old":"JSON"}\n');
    writeFileSync(out, oldSVG); writeFileSync(jsonOut, oldJSON);
    let caught;
    try { await writeSyncReport({ storyboard: sb, analysis: an, out }, { rename: async (from, to) => {
      if (basename(from) === 'report.json' && to === jsonOut) throw new Error('模拟第二个提交失败');
      if (basename(from) === 'previous.svg') throw new Error('模拟SVG回滚失败');
      await renameFile(from, to);
    } }); } catch (error) { caught = error; }
    assert.match(caught?.message ?? '', /备份保留于/);
    assert.ok(caught.backupDirectory.startsWith(dir));
    assert.deepEqual(readFileSync(join(caught.backupDirectory, 'previous.svg')), oldSVG);
    assert.deepEqual(readFileSync(jsonOut), oldJSON);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
