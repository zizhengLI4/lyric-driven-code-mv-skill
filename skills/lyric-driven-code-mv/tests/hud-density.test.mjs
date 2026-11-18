import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeDensity, describeDensity } from '../scripts/hud-density.mjs';

// 8 秒、两镜的最小分镜：只包含字段约定里出现的字段。
const fixture = {
  schemaVersion: 1,
  timebase: 'clip',
  project: { fps: 30, duration: 8, width: 1920, height: 1080, virtualWidth: 384, virtualHeight: 216, seed: 'density-fixture' },
  lyrics: [
    { id: 'l1', start: 0.5, end: 2, text: '第一句', en: 'first' },
    { id: 'l2', start: 5, end: 7, text: '第二句', en: 'second' },
  ],
  chapters: [],
  scenes: [
    {
      id: 's1',
      start: 0,
      end: 4,
      hud: [{ id: 'spark', type: 'counter', label: '火花', value: 1, meaning: '等待累积' }],
      events: [{ at: 1, action: '发出第一条' }, { at: 2.5, action: '对方已读', hud: '火花 2' }],
    },
    {
      id: 's2',
      start: 4,
      end: 8,
      materialVariant: { id: 'night', label: '夜水', change: '水面换高光' },
      events: [{ at: 6, action: '灯光回应' }],
    },
  ],
};

test('统计五类变化并区分 hud 与 event', () => {
  const report = analyzeDensity(fixture, { maxGap: 12, window: 4 });
  assert.equal(report.duration, 8);
  assert.equal(report.counts.cut, 1);
  assert.equal(report.counts.material, 1);
  assert.equal(report.counts.hud, 2);
  assert.equal(report.counts.event, 2);
  assert.equal(report.counts.lyric, 2);
  assert.equal(report.markCount, 8);
});

test('同一时刻的多个变化只算一个节奏点', () => {
  const report = analyzeDensity(fixture);
  // 4.0s 同时是切镜与新材质，只应产生一个时间点
  assert.deepEqual(report.marks.filter((mark) => mark.at === 4).map((mark) => mark.type).sort(), ['cut', 'material']);
  assert.equal(report.distinctTimes, 7);
});

test('空窗包含片头与片尾', () => {
  const report = analyzeDensity(fixture);
  assert.equal(report.gaps[0].start, 0);
  assert.equal(report.gaps[0].end, 0.5);
  assert.equal(report.gaps.at(-1).end, 8);
  assert.equal(report.gaps.at(-1).length, 2);
  assert.equal(report.longestGap, 2);
});

test('阈值内不产生 sparseGaps，阈值收紧后才产生', () => {
  assert.deepEqual(analyzeDensity(fixture, { maxGap: 12 }).sparseGaps, []);
  const tight = analyzeDensity(fixture, { maxGap: 1 });
  assert.ok(tight.sparseGaps.length > 0);
  assert.ok(tight.sparseGaps.every((gap) => gap.length > 1));
});

test('单镜内部空窗按镜边界计算', () => {
  const report = analyzeDensity(fixture);
  const s1 = report.perScene.find((scene) => scene.id === 's1');
  const s2 = report.perScene.find((scene) => scene.id === 's2');
  // s1 内的时间点：0.5、0.8（hud 代表点）、1、2.5；结尾到 4 的空隙 1.5s
  assert.equal(s1.longestInsideGap, 1.5);
  // s2 内的时间点：5、6；结尾到 8 的空隙 2s
  assert.equal(s2.longestInsideGap, 2);
});

test('窗口统计标出零变化窗口', () => {
  const report = analyzeDensity(fixture, { window: 4 });
  assert.equal(report.windows.length, 2);
  assert.equal(report.windows[0].marks, 4);
  assert.equal(report.windows[1].marks, 3);
});

test('每分钟变化率按整片时长折算', () => {
  const report = analyzeDensity(fixture);
  assert.equal(report.perMinute, 52.5);
});

test('描述文本包含关键结论', () => {
  const text = describeDensity(analyzeDensity(fixture, { maxGap: 1 }));
  assert.match(text, /可读变化点 7 个/);
  assert.match(text, /最长空窗 2s/);
  assert.match(text, /超过阈值/);
  assert.match(text, /单镜最长内部空窗/);
});

test('缺 project.duration 时不崩溃且不编造时长', () => {
  const report = analyzeDensity({ scenes: [{ id: 'a', start: 0, end: 3, events: [{ at: 1 }] }] });
  assert.equal(report.duration, null);
  assert.equal(report.perMinute, null);
  assert.deepEqual(report.gaps, []);
  assert.match(describeDensity(report), /时长 未知/);
});

test('跳过 null 与其他非对象输入', () => {
  const report = analyzeDensity({
    project: { duration: 4 },
    scenes: [null, { id: 'a', start: 0, end: 4, events: [null, { at: 2 }, 'x'] }, 7],
    lyrics: [null, { start: 1 }, 3],
  });
  assert.equal(report.counts.event, 1);
  assert.equal(report.counts.lyric, 1);
  assert.equal(report.distinctTimes, 2);
});
