#!/usr/bin/env node
// hud-density.mjs —— 量"可读变化"的密度，找超过阈值的空白窗。
//
// 依据：参考片复盘得到的判据是"每 8–12 秒至少出现一次可读变化"，而不是固定的镜长。
// 这个脚本把各类变化摊到时间轴上，告诉你哪个段落其实在空转。
//
// 七类变化（与 references/story-devices.md 的字段约定一致）：
//   cut       scene 起点（第一镜除外）
//   material  scene.materialVariant 出现（同一构图换材质）
//   hud       scene.hud[] 建立的读数，或带 event.hud 的事件
//   event     scene.events[].at
//   sfx       project.sfx[] / scene.sfx[] 的音效落点（听得见的变化也算一次变化）
//   lyric     lyrics[].start
//   chapter   章节牌出现（有 title 的 chapter.start）
//
// 只统计"有没有变化点"会骗人：一段被记为最空的区间里可能塞满了事件，
// 所以每处空窗都附带段内事件清单，让人自己判断是真空还是口径问题。
// 另外列出 device.rules 的落地覆盖：写了规则却没有任何事件 action 命中，就标出来。
//
// 用法：
//   node hud-density.mjs storyboard.json
//   node hud-density.mjs storyboard.json --max-gap 10 --window 20 --strict
//   node hud-density.mjs storyboard.json --json
//
// 它不证明歌词语义正确、真实音乐同步或成片质量；规则覆盖只用字面匹配，
// 命中的是文字，不是语义，"未落地"也只是一条需要人去核对的线索。

import { readFileSync } from 'node:fs';

const TYPES = ['cut', 'material', 'hud', 'event', 'sfx', 'lyric', 'chapter'];
const EVENT_LIST_LIMIT = 8;
// 每处空窗都带清单，但要给清单封顶，免得 90 秒里 70 处空窗把 JSON 撑爆。
const GAP_LIST_LIMIT = 20;
// 规则片段的最短长度：中文两字、西文两字以下基本没有分辨力，匹配上也不算证据。
const RULE_FRAGMENT_MIN = 2;

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const round = (value) => Math.round(value * 1000) / 1000;
const text = (value) => (typeof value === 'string' ? value : '');

/** 规则片段：先按标点/空白切分，再用长度门槛滤掉无分辨力的碎片。 */
export function ruleFragments(rule) {
  return [...new Set(
    text(rule)
      .toLowerCase()
      .split(/[\s、，。；：,.;:!？?！"'“”‘’（）()【】\[\]「」《》<>/\\|—-]+/u)
      .map((fragment) => fragment.trim())
      .filter((fragment) => fragment.length >= RULE_FRAGMENT_MIN),
  )];
}

/**
 * 规则里的长短滑窗，从长到短试。
 * 中文规则往往是一整句，整句包含几乎永远不命中；4 字以上的重叠算强命中，
 * 3 字只算弱线索 —— 都是字面匹配，不代表规则真的落地。
 */
export function ruleProbeWindows(rule) {
  const clean = text(rule).toLowerCase().replace(/[\s、，。；：,.;:!？?！"'“”‘’（）()【】\[\]「」《》<>/\\|—-]+/gu, '');
  const windows = [];
  for (const length of RULE_PROBE_LENGTHS) {
    for (let i = 0; i + length <= clean.length; i += 1) windows.push(clean.slice(i, i + length));
  }
  return windows;
}

/** 一条规则是否被某个事件 action 命中：整条规则 / 切分片段为强命中，长滑窗次之，三字滑窗只算弱线索。 */
export function matchRule(rule, action) {
  const haystack = text(action).toLowerCase();
  if (haystack.length < RULE_FRAGMENT_MIN) return null;
  const whole = text(rule).toLowerCase().trim();
  if (whole && (haystack.includes(whole) || whole.includes(haystack))) {
    return { matched: 'rule', fragment: whole, strength: 'strong' };
  }
  for (const fragment of ruleFragments(rule)) {
    if (haystack.includes(fragment)) return { matched: 'fragment', fragment, strength: 'strong' };
  }
  const clean = text(rule).toLowerCase().replace(/[\s、，。；：,.;:!？?！"'“”‘’（）()【】\[\]「」《》<>/\\|—-]+/gu, '');
  for (const length of RULE_PROBE_LENGTHS) {
    for (let i = 0; i + length <= clean.length; i += 1) {
      const window = clean.slice(i, i + length);
      if (haystack.includes(window)) {
        return { matched: `${length}-char-overlap`, fragment: window, strength: length >= 4 ? 'strong' : 'weak' };
      }
    }
  }
  return null;
}

/** 装置规则覆盖表：每条 device.rules 命中了几个镜头、几个事件。为 0 即"未在任何事件中体现"。 */
export function buildRuleCoverage(device, events) {
  const rules = Array.isArray(device?.rules) ? device.rules.filter((rule) => typeof rule === 'string' && rule.trim()) : [];
  const covered = rules.map((rule) => {
    const hits = [];
    const weakHits = [];
    for (const event of events) {
      const match = matchRule(rule, event.action);
      if (!match) continue;
      const record = { scene: event.scene, at: event.at, action: event.action, matched: match.matched, fragment: match.fragment };
      (match.strength === 'strong' ? hits : weakHits).push(record);
    }
    const scenes = [...new Set(hits.map((hit) => hit.scene))];
    const weakScenes = [...new Set(weakHits.map((hit) => hit.scene))];
    return {
      rule,
      sceneCount: scenes.length,
      eventCount: hits.length,
      scenes,
      hits,
      weakSceneCount: weakScenes.length,
      weakEventCount: weakHits.length,
      weakScenes,
      weakHits,
      covered: hits.length > 0,
      status: hits.length > 0 ? 'covered' : 'unrepresented',
      label: hits.length > 0 ? '已在事件中体现' : '未在任何事件中体现',
    };
  });
  return {
    available: rules.length > 0,
    deviceId: device?.id ?? null,
    deviceType: device?.type ?? null,
    deviceName: device?.name ?? null,
    ruleCount: rules.length,
    coveredCount: covered.filter((item) => item.covered).length,
    unrepresentedCount: covered.filter((item) => !item.covered).length,
    weakOnlyCount: covered.filter((item) => !item.covered && item.weakEventCount > 0).length,
    eventCount: events.length,
    note: '字面、大小写不敏感匹配：整条规则或规则片段被 action 包含算落地，三字滑窗只算弱线索。命中的是文字，不是语义；"未落地"是需要人核对的线索，不是违规判定。',
    rules: covered,
  };
}

export function analyzeDensity(data, options = {}) {
  const maxGap = num(options.maxGap) ?? 12;
  const windowSize = num(options.window) ?? 10;

  const duration = num(data?.project?.duration);
  const scenes = Array.isArray(data?.scenes) ? data.scenes.filter((scene) => scene && typeof scene === 'object') : [];
  const lyrics = Array.isArray(data?.lyrics) ? data.lyrics.filter((line) => line && typeof line === 'object') : [];
  const chapters = Array.isArray(data?.chapters) ? data.chapters.filter((chapter) => chapter && typeof chapter === 'object') : [];
  const device = data?.device && typeof data.device === 'object' ? data.device : null;

  const marks = [];
  const events = [];
  const push = (at, type, label, scene = null) => {
    const time = num(at);
    if (time === null) return;
    marks.push({ at: round(time), type, label: label ?? '', scene });
  };

  scenes.forEach((scene, index) => {
    const sceneId = String(scene.id ?? `scene-${index + 1}`);
    if (index > 0) push(scene.start, 'cut', sceneId, sceneId);

    if (scene.materialVariant && typeof scene.materialVariant === 'object') {
      push(scene.start, 'material', String(scene.materialVariant.id ?? scene.materialVariant.label ?? 'variant'), sceneId);
    }

    // HUD 没有独立时间戳，取本镜前 20% 作为"读数被建立"的代表时刻。
    if (Array.isArray(scene.hud) && scene.hud.length) {
      const start = num(scene.start) ?? 0;
      const end = num(scene.end) ?? start;
      push(start + (end - start) * 0.2, 'hud', scene.hud.map((item) => item?.label ?? item?.id ?? 'hud').join('/'), sceneId);
    }

    if (Array.isArray(scene.events)) {
      scene.events.forEach((event) => {
        if (!event || typeof event !== 'object') return;
        const action = String(event.action ?? '');
        const time = num(event.at);
        push(event.at, event.hud !== undefined ? 'hud' : 'event', action, sceneId);
        // 事件清单独立于 marks：它记录"这段里本来发生了什么"，用于判断空窗是真空还是口径问题。
        if (time !== null) {
          events.push({
            scene: sceneId,
            at: round(time),
            action,
            hud: event.hud === undefined ? null : String(event.hud),
            type: event.hud !== undefined ? 'hud' : 'event',
          });
        }
      });
    }

    if (Array.isArray(scene.sfx)) {
      scene.sfx.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        push(item.at, 'sfx', String(item.type ?? 'sfx'), sceneId);
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

  // 章节牌出现：只有写了 title 的 chapter 才是观众看得见的一块牌子。
  const chapterCards = [];
  chapters.forEach((chapter, index) => {
    const title = text(chapter.title).trim();
    if (!title) return;
    const card = {
      id: String(chapter.id ?? `chapter-${index + 1}`),
      at: round(num(chapter.start) ?? 0),
      title,
      label: text(chapter.label),
      deviceState: chapter.deviceState === undefined ? null : String(chapter.deviceState),
    };
    chapterCards.push(card);
    push(card.at, 'chapter', title, card.id);
  });

  marks.sort((a, b) => a.at - b.at);
  events.sort((a, b) => a.at - b.at);

  const counts = Object.fromEntries(TYPES.map((type) => [type, 0]));
  marks.forEach((mark) => { counts[mark.type] += 1; });

  // 同一时刻的多个变化只算一个时间点，避免把"切镜同时换材质"当成两次节奏点。
  const times = [...new Set(marks.map((mark) => mark.at))].sort((a, b) => a - b);

  const within = (from, to) => ({
    // 证据清单两端都算：窗口边上的那条事件正是"这个窗口为什么这么长"的答案。
    marks: marks.filter((mark) => mark.at >= from && mark.at <= to),
    events: events.filter((event) => event.at >= from && event.at <= to),
  });

  /**
   * 空窗的证据：段内到底有什么，以及它是真空还是口径问题。
   * 记时间的字段都会成为变化点，所以"被记为最空"的窗口里真正可能存在的，是那些不靠时间戳表达的东西：
   *   - 跨界字幕行：字幕整段压在窗口上，只在句头记一个变化点，句中间的 6.9 秒看起来就"没有变化"
   *   - 常驻 HUD：本镜建立的读数一直显示，但只在建立时刻记一个变化点
   *   - 界内事件：真出现了才说明统计漏算
   */
  const evidenceFor = (from, to) => {
    const inside = within(from, to);
    const interior = inside.events.filter((event) => event.at > from && event.at < to);
    const spanningLyrics = lyrics
      .map((line, index) => ({
        id: String(line.id ?? `line-${index + 1}`),
        start: num(line.start),
        end: num(line.end) ?? num(line.start),
        text: text(line.text),
      }))
      .filter((line) => line.start !== null && line.end !== null && line.end > from && line.start < to && line.start <= from)
      .map((line) => ({ id: line.id, start: round(line.start), end: round(line.end), text: line.text }));
    const standingHud = scenes
      .filter((scene) => {
        const start = num(scene.start);
        const end = num(scene.end);
        return start !== null && end !== null && end > from && start < to && Array.isArray(scene.hud) && scene.hud.length;
      })
      .map((scene) => ({
        scene: String(scene.id ?? ''),
        hud: scene.hud.map((item) => String(item?.label ?? item?.id ?? 'hud')),
      }));
    const verdict = interior.length
      ? 'interior-events-not-counted'
      : (spanningLyrics.length ? 'spanned-lyrics-not-counted'
        : (standingHud.length ? 'standing-hud-present' : (inside.events.length ? 'edge-events-only' : 'empty-window')));
    return {
      marks: inside.marks.map((mark) => ({ at: mark.at, type: mark.type, label: mark.label, scene: mark.scene })),
      events: inside.events,
      eventCount: inside.events.length,
      interiorEventCount: interior.length,
      spanningLyrics,
      standingHud,
      verdict,
    };
  };

  /** 只保留前 GAP_LIST_LIMIT 条用于展示；计数与 verdict 永远按全部条目算。 */
  const capEvents = (events) => ({
    eventsListed: Math.min(events.length, GAP_LIST_LIMIT),
    eventsTruncated: events.length > GAP_LIST_LIMIT,
  });

  const gaps = [];
  if (duration !== null) {
    if (!times.length || times[0] > 0) gaps.push({ start: 0, end: times[0] ?? duration, length: round((times[0] ?? duration) - 0) });
    for (let i = 1; i < times.length; i += 1) {
      gaps.push({ start: times[i - 1], end: times[i], length: round(times[i] - times[i - 1]) });
    }
    const tail = times.length ? times[times.length - 1] : 0;
    if (duration > tail) gaps.push({ start: tail, end: round(duration), length: round(duration - tail) });
  }
  // 每处空窗都带段内清单：没有事件才是真空，有事件就是统计口径的问题。
  gaps.forEach((gap) => {
    const evidence = evidenceFor(gap.start, gap.end);
    gap.marks = evidence.marks;
    gap.markedCount = evidence.marks.length;
    gap.events = evidence.events;
    gap.eventCount = evidence.eventCount;
    gap.interiorEventCount = evidence.interiorEventCount;
    gap.spanningLyrics = evidence.spanningLyrics;
    gap.standingHud = evidence.standingHud;
    gap.verdict = evidence.verdict;
    Object.assign(gap, capEvents(evidence.events));
  });

  const longestGap = gaps.reduce((best, gap) => (gap.length > best ? gap.length : best), 0);
  const sparseGaps = gaps.filter((gap) => gap.length > maxGap);
  const longestGapDetail = gaps.find((gap) => gap.length === longestGap && gap.length > 0) ?? null;

  const perScene = scenes.map((scene, index) => {
    const start = num(scene.start) ?? 0;
    const end = num(scene.end) ?? start;
    const inside = times.filter((time) => time >= start && time < end);
    // 同时记下最长空窗的区间与段内清单，否则 6.9s 这种数字没法复核。
    let from = start;
    let to = end;
    let longest = 0;
    if (!inside.length) {
      longest = end - start;
    } else {
      let cursor = start;
      for (const time of inside) {
        if (time - cursor > longest) { longest = time - cursor; from = cursor; to = time; }
        cursor = time;
      }
      if (end - cursor > longest) { longest = end - cursor; from = cursor; to = end; }
    }
    const sceneId = String(scene.id ?? `scene-${index + 1}`);
    const evidence = evidenceFor(from, to);
    return {
      id: sceneId,
      start: round(start),
      end: round(end),
      marks: inside.length,
      longestInsideGap: round(longest),
      longestInsideGapStart: round(from),
      longestInsideGapEnd: round(to),
      longestInsideGapMarks: evidence.marks,
      longestInsideGapEvents: evidence.events,
      longestInsideGapEventCount: evidence.eventCount,
      longestInsideGapInteriorEventCount: evidence.interiorEventCount,
      longestInsideGapSpanningLyrics: evidence.spanningLyrics,
      longestInsideGapStandingHud: evidence.standingHud,
      longestInsideGapVerdict: evidence.verdict,
      ...capEvents(evidence.events),
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
    longestGapDetail,
    sparseGaps,
    perScene,
    windows,
    marks,
    events,
    chapterCards,
    ruleCoverage: buildRuleCoverage(device, events),
  };
}

/** 「157.7s 判定窗；163.1s 附注」这样的可读清单。 */
function describeEvents(events, eventCount = events.length) {
  if (!events.length) return '段内没有任何事件记录（真空窗）';
  const shown = events.slice(0, EVENT_LIST_LIMIT)
    .map((event) => `${event.at}s ${event.action || '(无名事件)'}${event.hud === null ? '' : `[hud ${event.hud}]`}`);
  const rest = eventCount > shown.length ? ` …另有 ${eventCount - shown.length} 条` : '';
  return `段内事件 ${eventCount} 条：${shown.join('；')}${rest}`;
}

/** 空窗的判定结尾：别让人以为片子真的空转，也别说成没问题。 */
function gapVerdictLine(verdict, interiorEventCount, spanningLyrics = [], standingHud = []) {
  if (verdict === 'interior-events-not-counted') {
    return `  ⚠ 窗口内还有 ${interiorEventCount} 条事件却没有任何变化点：这是统计口径问题，不是真空。`;
  }
  if (verdict === 'spanned-lyrics-not-counted') {
    const sample = spanningLyrics.slice(0, 3).map((line) => `${line.start}–${line.end}s「${line.text || line.id}」`).join('；');
    return `  ⚠ 窗口整段压着字幕（${sample}）：字幕只在句头算一次变化点，不代表这段没有可读内容。`;
  }
  if (verdict === 'standing-hud-present') {
    const sample = standingHud.slice(0, 3).map((item) => `${item.scene}[${item.hud.join('/')}]`).join('；');
    return `  ⚠ 窗口内有常驻 HUD（${sample}）：读数一直在屏上，只是在建立时刻算了一次变化点。`;
  }
  if (verdict === 'edge-events-only') return '  窗口两端有事件，内段确实没有记录。';
  return '  窗口内确实没有任何事件记录。';
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

  if (report.longestGapDetail && report.longestGap > 0) {
    const gap = report.longestGapDetail;
    lines.push(`最长空窗明细（${gap.start}s → ${gap.end}s，${gap.length}s）：${describeEvents(gap.events ?? [], gap.eventCount ?? 0)}`);
    lines.push(gapVerdictLine(gap.verdict, gap.interiorEventCount ?? 0, gap.spanningLyrics ?? [], gap.standingHud ?? []));
  }

  const fallback = { longestInsideGap: 0, id: '-', start: 0, longestInsideGapStart: 0, longestInsideGapEnd: 0, longestInsideGapEvents: [] };
  const worst = report.perScene.reduce((a, b) => (b.longestInsideGap > a.longestInsideGap ? b : a), fallback);
  if (report.perScene.length) {
    lines.push(`单镜最长内部空窗：${worst.longestInsideGap}s（${worst.id}，${worst.longestInsideGapStart ?? worst.start}s–${worst.longestInsideGapEnd ?? '-'}s）`);
    lines.push(`  ${describeEvents(worst.longestInsideGapEvents ?? [], worst.longestInsideGapEventCount ?? 0)}`);
    lines.push(gapVerdictLine(worst.longestInsideGapVerdict, worst.longestInsideGapInteriorEventCount ?? 0,
      worst.longestInsideGapSpanningLyrics ?? [], worst.longestInsideGapStandingHud ?? []));
  }
  if (report.windows.length) {
    const quiet = report.windows.filter((item) => item.marks === 0);
    lines.push(`每 ${report.window}s 窗口里有 ${quiet.length} 个零变化窗口。`);
  }

  const coverage = report.ruleCoverage;
  if (coverage?.available) {
    lines.push(`装置规则覆盖（device.rules ${coverage.ruleCount} 条：命中 ${coverage.coveredCount} 条，未落地 ${coverage.unrepresentedCount} 条）`);
    coverage.rules.forEach((item) => {
      const detail = item.covered
        ? `命中 ${item.sceneCount} 镜 / ${item.eventCount} 个事件：` +
          item.hits.slice(0, 3).map((hit) => `${hit.at}s ${hit.action}`).join('；')
        : (item.weakEventCount
          ? `未在任何事件中体现（只有 ${item.weakEventCount} 处弱线索：` +
            item.weakHits.slice(0, 2).map((hit) => `${hit.at}s ${hit.action}`).join('；') + '）'
          : '未在任何事件中体现');
      lines.push(`  [${item.covered ? '已落地' : '未落地'}] ${item.rule} —— ${detail}`);
    });
    if (coverage.unrepresentedCount) lines.push('  未落地只是字面匹配的线索：请人工确认这条规则是否本来就不该由事件体现。');
  } else {
    lines.push('装置规则覆盖：分镜没有 device.rules，无法核对。');
  }

  if (report.chapterCards?.length) {
    lines.push(`章节牌 ${report.chapterCards.length} 块计入可读变化：` +
      report.chapterCards.slice(0, EVENT_LIST_LIMIT).map((card) => `${card.at}s ${card.title}`).join('；'));
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
