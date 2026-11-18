// sync-audit.py 的用例。它替代了此前四个分散的临时脚本，所以每类错位都要有回归。
// 关键设计前提：脚本自己不知道"强起音"是什么，全靠 --analysis 传进来；
// 没有它时只能按拍点核对歌词，而那个判据不可靠，必须只提示不判错。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '..', 'skills', 'lyric-driven-code-mv', 'scripts', 'sync-audit.py');
const PYTHON = process.env.PYTHON || 'python';

const run = (args) => spawnSync(PYTHON, [SCRIPT, ...args], { encoding: 'utf8' });

const PERIOD = 0.4;
const PHASE = 0.0;
const DUR = 12;

// 12 秒 / 0.4 秒一拍 = 30 个拍点；所有容器都对齐到它
const grid = Array.from({ length: Math.floor(DUR / PERIOD) }, (_, i) => Number((PHASE + i * PERIOD).toFixed(6)));

function storyboard(overrides = {}) {
  const data = {
    project: { duration: DUR, fps: 30 },
    scenes: [
      { id: 's1', start: 0, end: 6 },
      { id: 's2', start: 6, end: 12 },
    ],
    chapters: [
      { id: 'c1', start: 0, end: 6 },
      { id: 'c2', start: 6, end: 12 },
    ],
    lyrics: [
      { id: 'l1', start: 2.0, end: 5.0, text: 'first line' },
      { id: 'l2', start: 7.0, end: 10.0, text: 'second line' },
    ],
    music: {
      beats: grid,
      sections: [
        { id: 's1', start: 0, end: 6 },
        { id: 's2', start: 6, end: 12 },
      ],
    },
  };
  return { ...data, ...overrides };
}

function analysis(onsets) {
  return {
    tempo: {
      bpm: 150,
      periodSeconds: PERIOD,
      phaseSeconds: PHASE,
      onsetFit: { medianMs: 12.0, within40ms: 0.8 },
    },
    onsets,
  };
}

// 强起音：10 个强（strength 0.9）、10 个弱（strength 0.1）
// 前 40% 的阈值会落在 0.9 这一档，所以"强起音"就是下面这几个时刻
function onsets(strongTimes, weakTimes) {
  return [
    ...strongTimes.map(at => ({ at, strength: 0.9 })),
    ...weakTimes.map(at => ({ at, strength: 0.1 })),
  ];
}

function setup(t, board, report) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-audit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sb = join(dir, 'storyboard.json');
  writeFileSync(sb, JSON.stringify(board));
  const args = [sb];
  if (report) {
    const an = join(dir, 'audio.json');
    writeFileSync(an, JSON.stringify(report));
    args.push('--analysis', an);
  }
  return { dir, sb, args };
}

// ── 网格一致性 ────────────────────────────────────────────────────────
test('网格与离线分析一致时通过', t => {
  const { args } = setup(t, storyboard(), analysis(onsets([2.0, 7.0], [1.0, 3.0, 8.0])));
  const r = run(args);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /一致/);
});

test('分镜网格是错的时候必须报错，而不是只比切点', t => {
  // 分镜按 150 BPM 排（0.4s），分析说 100 BPM（0.6s）——切点再过齐也没用
  const wrong = storyboard();
  wrong.music.beats = Array.from({ length: 20 }, (_, i) => Number((i * 0.4).toFixed(6)));
  const reportData = analysis(onsets([2.0], [1.0]));
  reportData.tempo.bpm = 100;
  reportData.tempo.periodSeconds = 0.6;
  const { args } = setup(t, wrong, reportData);
  const r = run(args);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /先换网格再谈对齐/);
});

test('半速/双速关系要单独点出来', t => {
  const reportData = analysis(onsets([2.0], [1.0]));
  reportData.tempo.bpm = 300;   // = 150 * 2
  reportData.tempo.periodSeconds = 0.2;
  const { args } = setup(t, storyboard(), reportData);
  const r = run(args);
  assert.match(r.stdout, /双速/);
});

// ── 切点 ──────────────────────────────────────────────────────────────
test('切点全部落在网格上时通过', t => {
  const { args } = setup(t, storyboard(), analysis(onsets([2.0, 7.0], [1.0, 3.0])));
  const r = run(args);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /切点：1 项/);   // 第一镜从 0 起不算
});

test('切点偏离网格要报错并给出毫秒数', t => {
  const board = storyboard();
  board.scenes[1].start = 6.25;         // 网格上是 6.0
  board.chapters[1].start = 6.25;
  board.music.sections[1].start = 6.25;
  const { args } = setup(t, board, analysis(onsets([2.0, 7.0], [1.0, 3.0])));
  const r = run(args);
  assert.equal(r.status, 2);
  // 带符号偏离是「实际 - 最近参考点」= 6.25 - 6.0 = -150ms
  assert.match(r.stdout, /偏离最近参考点 -150ms/);
});

// ── 场景事件 ──────────────────────────────────────────────────────────
test('标记 sync:beat 的事件偏离网格要报错', t => {
  const board = storyboard();
  board.scenes[0].events = [{ at: 2.15, sync: 'beat', action: '灯灭' }];
  const { args } = setup(t, board, analysis(onsets([2.0, 7.0], [1.0, 3.0])));
  const r = run(args);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /事件（sync:beat）/);
  assert.match(r.stdout, /偏离最近参考点 \+150ms/);
});

test('没声明 sync:beat 的事件不参与拍点检查', t => {
  const board = storyboard();
  // 2.15 明显不在拍点上，但没声明 sync，属于语义安排，不该被判错
  board.scenes[0].events = [{ at: 2.15, action: '随手加的一点动静' }];
  const { args } = setup(t, board, analysis(onsets([2.0, 7.0], [1.0, 3.0])));
  const r = run(args);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /没有标记 sync:"beat"/);
});

// ── 歌词 ──────────────────────────────────────────────────────────────
test('歌词对齐强起音时通过', t => {
  const board = storyboard();
  board.lyrics = [
    { id: 'l1', start: 2.0, end: 5.0, text: 'a' },
    { id: 'l2', start: 7.0, end: 10.0, text: 'b' },
  ];
  const { args } = setup(t, board, analysis(onsets([2.0, 7.0], [1.0, 3.0, 8.0])));
  const r = run(args);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /歌词 vs 强起音：2 项/);
});

test('没有 --analysis 时歌词只按拍点提示，不判错', t => {
  // 关键回归：判据不可靠就不该让出片流程失败。1.9 不在 0.4 秒网格上（网格是 2.0）
  const board = storyboard();
  board.lyrics = [{ id: 'l1', start: 1.9, end: 5.0, text: '有人声拖音的一行' }];
  const { args } = setup(t, board);
  const r = run(args);
  assert.equal(r.status, 0, '缺分析数据时不能因为歌词偏离就退出 2');
  assert.match(r.stdout, /仅供参考/);
  assert.match(r.stdout, /必须提供 analyze-audio\.mjs 的输出/);
});

test('无解的歌词行要报候选并明确说不能自动改', t => {
  // 复刻真实情形：LRC 说 23.37，两侧强起音在 22.43 与 24.30，方向相反
  const board = storyboard();
  board.lyrics = [{ id: 'l9', start: 23.37, end: 29.0, text: 'But here you are' }];
  board.project.duration = 30;
  board.scenes = [{ id: 's1', start: 0, end: 30 }];
  board.chapters = [{ id: 'c1', start: 0, end: 30 }];
  board.music.sections = [{ id: 's1', start: 0, end: 30 }];
  board.music.beats = Array.from({ length: 75 }, (_, i) => Number((i * 0.4).toFixed(6)));
  const { args } = setup(t, board, analysis(
    onsets([22.43, 24.30], [1.0, 2.0, 3.0, 25.0, 26.0, 27.0, 28.0])));
  const r = run(args);
  // 候选按离当前时刻由近到远排：24.300(+930ms) 先于 22.430(-940ms)
  assert.match(r.stdout, /候选 24\.300s\(\+930ms\)、22\.430s\(-940ms\)/);
  assert.match(r.stdout, /必须听着人声定/);
  assert.match(r.stdout, /不要按最近距离自动改/);
});

// ── 章节 ──────────────────────────────────────────────────────────────
test('chapters 与 sections 边界不一致要报错', t => {
  const board = storyboard();
  board.chapters[1].start = 5.5;   // sections 仍是 6.0
  const { args } = setup(t, board, analysis(onsets([2.0, 7.0], [1.0, 3.0])));
  const r = run(args);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /章节牌与段落边界对不上/);
});

test('章节边界不在切点上给出警告', t => {
  const board = storyboard();
  board.chapters[1].start = 6.4;
  board.chapters[1].end = 12;
  board.music.sections[1].start = 6.4;
  const { args } = setup(t, board, analysis(onsets([2.0, 7.0], [1.0, 3.0])));
  const r = run(args);
  assert.match(r.stdout, /不在任何切点上/);
});

// ── JSON 报告 ─────────────────────────────────────────────────────────
test('--json 写出机器可读报告', t => {
  const { dir, args } = setup(t, storyboard(), analysis(onsets([2.0, 7.0], [1.0, 3.0])));
  const out = join(dir, 'report.json');
  const r = run([...args, '--json', out]);
  assert.equal(r.status, 0, r.stdout);
  const payload = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(payload.ok, true);
  assert.equal(payload.gridSource, 'analysis');
  assert.equal(payload.summary.errors, 0);
  assert.ok(payload.gridPoints > 0);
  assert.ok(Array.isArray(payload.items));
});

test('分镜没有 beats 时用分析网格并明确来源', t => {
  const board = storyboard();
  delete board.music.beats;
  const { args } = setup(t, board, analysis(onsets([2.0, 7.0], [1.0, 3.0])));
  const r = run([...args, '--quiet']);
  assert.match(r.stdout, /来自离线分析/);
});
