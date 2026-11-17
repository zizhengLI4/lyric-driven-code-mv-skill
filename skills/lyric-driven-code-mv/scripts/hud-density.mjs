#!/usr/bin/env node
// hud-density.mjs —— 量"可读变化"的密度，找超过阈值的空白窗。
//
// 依据：参考片复盘得到的判据是"每 8–12 秒至少出现一次可读变化"，而不是固定的镜长。
// 这个脚本把五类变化摊到时间轴上，告诉你哪个段落其实在空转。
//
// 六类变化（与 references/story-devices.md 的字段约定一致）：
//   cut       scene 起点（第一镜除外）
//   material  scene.materialVariant 出现（同一构图换材质）
//   hud       scene.hud[] 建立的读数，或带 event.hud 的事件
//   event     scene.events[].at
//   sfx       project.sfx[] / scene.sfx[] 的音效落点（听得见的变化也算一次变化）
//   lyric     lyrics[].start
//
// 用法：
//   node hud-density.mjs storyboard.json
//   node hud-density.mjs storyboard.json --max-gap 10 --window 20 --strict
//   node hud-density.mjs storyboard.json --json
//
// 它不证明歌词语义正确、真实音乐同步或成片质量。

import { readFileSync } from 'node:fs';

const TYPES = ['cut', 'material', 'hud', 'event', 'sfx', 'lyric'];

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const round = (value) => Math.round(value * 1000) / 1000;

export function analyzeDensity(data, options = {}) {
  const maxGap = num(options.maxGap) ?? 12;
  const windowSize = num(options.window) ?? 10;

  const duration = num(data?.project?.duration);
  const scenes = Array.isArray(data?.scenes) ? data.scenes.filter((scene) => scene && typeof scene === 'object') : [];
  const lyrics = Array.isArray(data?.lyrics) ? data.lyrics.filter((line) => line && typeof line === 'object') : [];

  const marks = [];
  const push = (at, type, label) => {
    const time = num(at);
    if (time === null) return;
    marks.push({ at: round(time), type, label: label ?? '' });
  };

  scenes.forEach((scene, index) => {
    if (index > 0) push(scene.start, 'cut', String(scene.id ?? `scene-${index + 1}`));

    if (scene.materialVariant && typeof scene.materialVariant === 'object') {
      push(scene.start, 'material', String(scene.materialVariant.id ?? scene.materialVariant.label ?? 'variant'));
    }

    // HUD 没有独立时间戳，取本镜前 20% 作为"读数被建立"的代表时刻。
    if (Array.isArray(scene.hud) && scene.hud.length) {
      const start = num(scene.start) ?? 0;
      const end = num(scene.end) ?? start;
      push(start + (end - start) * 0.2, 'hud', scene.hud.map((item) => item?.label ?? item?.id ?? 'hud').join('/'));
    }

    if (Array.isArray(scene.events)) {
      scene.events.forEach((event) => {
        if (!event || typeof event !== 'object') return;
        push(event.at, event.hud !== undefined ? 'hud' : 'event', String(event.action ?? ''));
      });
    }

    if (Array.isArray(scene.sfx)) {
      scene.sfx.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        push(item.at, 'sfx', String(item.type ?? 'sfx'));
      });
    }
  });

  if (Array.isArray(data?.project?.sfx)) {
    data.project.sfx.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      push(item.at, 'sfx', String(item.type ?? 'sfx'));
    });
  }

  lyrics.forEach((line, index) => {
    push(line.start, 'lyric', String(line.id ?? `line-${index + 1}`));
  });

  marks.sort((a, b) => a.at - b.at);

  const counts = Object.fromEntries(TYPES.map((type) => [type, 0]));
  marks.forEach((mark) => { counts[mark.type] += 1; });

  // 同一时刻的多个变化只算一个时间点，避免把"切镜同时换材质"当成两次节奏点。
  const times = [...new Set(marks.map((mark) => mark.at))].sort((a, b) => a - b);

  const gaps = [];
  if (duration !== null) {
    if (!times.length || times[0] > 0) gaps.push({ start: 0, end: times[0] ?? duration, length: round((times[0] ?? duration) - 0) });
    for (let i = 1; i < times.length; i += 1) {
      gaps.push({ start: times[i - 1], end: times[i], length: round(times[i] - times[i - 1]) });
    }
    const tail = times.length ? times[times.length - 1] : 0;
    if (duration > tail) gaps.push({ start: tail, end: round(duration), length: round(duration - tail) });
  }

  const longestGap = gaps.reduce((best, gap) => (gap.length > best ? gap.length : best), 0);
  const sparseGaps = gaps.filter((gap) => gap.length > maxGap);

  const perScene = scenes.map((scene, index) => {
    const start = num(scene.start) ?? 0;
    const end = num(scene.end) ?? start;
    const inside = times.filter((time) => time >= start && time < end);
    const longest = inside.reduce((best, time, i) => {
      const prev = i === 0 ? start : inside[i - 1];
      return Math.max(best, time - prev);
    }, inside.length ? 0 : 0);
    const tailGap = inside.length ? end - inside[inside.length - 1] : end - start;
    return {
      id: String(scene.id ?? `scene-${index + 1}`),
      start: round(start),
      end: round(end),
      marks: inside.length,
      longestInsideGap: round(Math.max(longest, tailGap)),
    };
  });

  const windows = [];
  if (duration !== null) {
    for (let start = 0; start < duration; start += windowSize) {
      const end = Math.min(start + windowSize, duration);
      const inside = times.filter((time) => time >= start && time < end).length;
      windows.push({ start: round(start), end: round(end), marks: inside });
    }
  }

  return {
    duration: duration === null ? null : round(duration),
    maxGap,
    window: windowSize,
    markCount: marks.length,
    distinctTimes: times.length,
    counts,
    perMinute: duration ? round((times.length / duration) * 60) : null,
    gaps,
    longestGap: round(longestGap),
    sparseGaps,
    perScene,
    windows,
    marks,
  };
}

export function describeDensity(report) {
  const lines = [];
  lines.push(`时长 ${report.duration ?? '未知'}s，可读变化点 ${report.distinctTimes} 个` +
    (report.perMinute === null ? '' : `（每分钟 ${report.perMinute} 个）`));
  lines.push('按类型：' + TYPES.map((type) => `${type} ${report.counts[type]}`).join(' / '));
  lines.push(`最长空窗 ${report.longestGap}s（阈值 ${report.maxGap}s）`);

  if (report.sparseGaps.length) {
    lines.push(`有 ${report.sparseGaps.length} 处超过阈值：`);
    report.sparseGaps.forEach((gap) => {
      lines.push(`  ${gap.start}s → ${gap.end}s，${gap.length}s`);
    });
  } else {
    lines.push('没有超过阈值的空窗。');
  }

  const worst = report.perScene.reduce((a, b) => (b.longestInsideGap > a.longestInsideGap ? b : a), { longestInsideGap: 0, id: '-', start: 0 });
  if (report.perScene.length) {
    lines.push(`单镜最长内部空窗：${worst.longestInsideGap}s（${worst.id}，${worst.start}s 起）`);
  }
  if (report.windows.length) {
    const quiet = report.windows.filter((item) => item.marks === 0);
    lines.push(`每 ${report.window}s 窗口里有 ${quiet.length} 个零变化窗口。`);
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log('用法：node hud-density.mjs <storyboard.json> [--max-gap 12] [--window 10] [--strict] [--json]');
    return args.length ? 0 : 1;
  }
  const file = args.find((arg) => !arg.startsWith('--'));
  const flag = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const strict = args.includes('--strict');
  const asJson = args.includes('--json');

  if (!file) {
    console.error('缺少 storyboard.json');
    return 1;
  }

  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`读取失败：${error.message}`);
    return 1;
  }

  const report = analyzeDensity(data, {
    maxGap: flag('--max-gap') === undefined ? undefined : Number(flag('--max-gap')),
    window: flag('--window') === undefined ? undefined : Number(flag('--window')),
  });

  if (asJson) console.log(JSON.stringify(report, null, 2));
  else console.log(describeDensity(report));

  return strict && report.sparseGaps.length ? 1 : 0;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('hud-density.mjs')) {
  process.exit(main());
}
