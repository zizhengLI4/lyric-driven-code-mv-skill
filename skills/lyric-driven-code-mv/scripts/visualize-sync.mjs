#!/usr/bin/env node
import { readFile, mkdir, mkdtemp, writeFile, rename, rm, stat, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const EPSILON = 1e-6;
const MAX_ENERGY_POINTS = 1600;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const round = n => Math.round(n * 1e6) / 1e6;
const fail = message => { throw new Error(message); };
const preview = value => typeof value === 'string' ? value.slice(0, 300) : '';
const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');

function array(value, name, limit) {
  if (!Array.isArray(value) || value.length > limit) fail(`${name} 须为数组，且不得超过 ${limit} 项`);
  return value;
}

function id(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) fail(`${name} 须为 1–200 字符的非空文本`);
  return value;
}

function interval(entry, name, duration) {
  if (!object(entry) || !finite(entry.start) || !finite(entry.end) || entry.start < 0 || entry.start >= duration || entry.end <= entry.start || entry.end > duration + EPSILON) fail(`${name} 区间须满足 0 <= start < end <= duration`);
}

/** Min/max pairs retain narrow peaks while keeping the chart and JSON bounded. */
function sampleEnvelope(envelope) {
  if (envelope.length <= MAX_ENERGY_POINTS) return envelope.map(({ at, normalized }) => ({ at: round(at), normalized: round(normalized) }));
  const result = [], buckets = MAX_ENERGY_POINTS / 2;
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = Math.floor(bucket * envelope.length / buckets), end = Math.floor((bucket + 1) * envelope.length / buckets);
    let min = start, max = start;
    for (let i = start + 1; i < end; i++) {
      if (envelope[i].normalized < envelope[min].normalized) min = i;
      if (envelope[i].normalized > envelope[max].normalized) max = i;
    }
    for (const index of [...new Set([min, max])].sort((a, b) => a - b)) result.push({ at: round(envelope[index].at), normalized: round(envelope[index].normalized) });
  }
  return result;
}

function nearestBeat(at, beats) {
  if (!beats.length) return { nearestBeat: null, deltaSeconds: null, deltaMs: null };
  let lo = 0, hi = beats.length;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (beats[mid] < at) lo = mid + 1; else hi = mid; }
  const earlier = beats[Math.max(0, lo - 1)], later = beats[Math.min(lo, beats.length - 1)];
  const nearest = Math.abs(at - earlier) <= Math.abs(at - later) ? earlier : later;
  return { nearestBeat: nearest, deltaSeconds: round(at - nearest), deltaMs: round((at - nearest) * 1000) };
}

function summarize(items) {
  const deltas = items.map(item => item.deltaMs).filter(finite);
  return { count: items.length, comparedCount: deltas.length, meanAbsMs: deltas.length ? round(deltas.reduce((sum, delta) => sum + Math.abs(delta), 0) / deltas.length) : null, maxAbsMs: deltas.length ? Math.max(...deltas.map(Math.abs)) : null };
}

/** Structural review only: never modifies or promotes the source storyboard. */
export function buildSyncReport(storyboard, analysis) {
  if (!object(storyboard) || storyboard.schemaVersion !== 1 || storyboard.timebase !== 'clip') fail('分镜须为 schemaVersion=1、timebase=clip');
  if (!object(analysis) || analysis.schemaVersion !== 1 || analysis.timebase !== 'clip' || analysis.status !== 'draft') fail('分析须为 analyze-audio 的 schemaVersion=1、timebase=clip、status=draft 报告');
  const project = storyboard.project;
  if (!object(project) || !finite(project.duration) || project.duration <= 0 || project.duration > 600 || !finite(project.sourceOffset) || project.sourceOffset < 0) fail('分镜 duration 须为 0–600 秒，sourceOffset 须为非负数');
  if (![8000, 16000].includes(analysis.sampleRate) || !finite(analysis.duration) || !finite(analysis.sourceOffset)) fail('分析 duration/sourceOffset 缺失或无效，sampleRate 须为 8000/16000');
  const tolerance = Math.max(EPSILON, 1 / analysis.sampleRate);
  if (Math.abs(analysis.duration - project.duration) > tolerance) fail('分析与分镜时长错配；请分析同一成片区间');
  if (Math.abs(analysis.sourceOffset - project.sourceOffset) > EPSILON) fail('分析与分镜 sourceOffset 错配；不能直接混用原曲时点与成片时点');
  const duration = project.duration;
  const beats = array(analysis.beats, 'analysis.beats', 12000).map((at, i, source) => {
    if (!finite(at) || at < 0 || at >= duration || (i && at <= source[i - 1])) fail('候选拍点须在 [0,duration) 内且严格递增');
    return at;
  });
  const envelope = array(analysis.energy?.envelope, 'energy.envelope', 150000);
  envelope.forEach((point, i) => {
    if (!object(point) || !finite(point.at) || point.at < 0 || point.at >= analysis.duration || !finite(point.normalized) || point.normalized < 0 || point.normalized > 1 || (i && point.at <= envelope[i - 1].at)) fail('能量包络时点须递增且在分析时长内，normalized 须为 0–1');
  });
  const scenes = array(storyboard.scenes, 'scenes', 500);
  if (!scenes.length) fail('scenes 不得为空');
  const sceneIds = new Set(); let end = 0;
  const sceneStarts = scenes.map((scene, i) => {
    interval(scene, `scenes[${i}]`, duration); id(scene.id, `scenes[${i}].id`);
    if (sceneIds.has(scene.id) || Math.abs(scene.start - end) > EPSILON) fail('镜头 ID 须唯一，时间区间须连续覆盖成片');
    sceneIds.add(scene.id); end = scene.end;
    return { id: scene.id, start: scene.start, end: Math.min(scene.end, duration), ...nearestBeat(scene.start, beats) };
  });
  if (Math.abs(end - duration) > EPSILON) fail('镜头末尾须覆盖成片时长');
  const cueIds = new Set();
  const captions = array(storyboard.lyrics, 'lyrics', 1000).map((cue, i) => {
    interval(cue, `lyrics[${i}]`, duration); id(cue.id, `lyrics[${i}].id`);
    if (cueIds.has(cue.id)) fail('字幕 ID 须唯一'); cueIds.add(cue.id);
    const text = cue.zh ?? cue.text;
    if (typeof text !== 'string' || !text.trim()) fail('字幕须提供非空 text/zh');
    return { id: cue.id, start: cue.start, end: Math.min(cue.end, duration), textPreview: preview(text), textTruncated: text.length > 300, ...nearestBeat(cue.start, beats) };
  });
  const musicStatus = preview(storyboard.music?.status) || 'unspecified';
  const captionRole = preview(storyboard.music?.captionRole ?? storyboard.captionRole) || 'unspecified';
  const energy = sampleEnvelope(envelope);
  return {
    schemaVersion: 1, status: 'candidate-review', timebase: 'clip', duration, sourceOffset: project.sourceOffset, musicStatus, captionRole,
    tempo: { bpm: finite(analysis.tempo?.bpm) ? analysis.tempo.bpm : null, status: preview(analysis.tempo?.status) || 'unknown' },
    beats, energy, sceneStarts, captions,
    summary: { internalSceneStarts: summarize(sceneStarts.slice(1)), captionStarts: summarize(captions) },
    sampling: { originalEnergyPoints: envelope.length, displayedEnergyPoints: energy.length, maxEnergyPoints: MAX_ENERGY_POINTS },
    warnings: [
      '此图仅比对结构与机器候选网格，不证明真实歌曲已核听，也不升级 music.status。',
      'delta=落点-最近候选拍点：正数表示较晚，负数表示较早；平距时取较早拍点。',
      '字幕起点不必逐句落拍。器乐叙事字幕可依据段落、能量、语义与留白选择时点，须另行试听核对。',
      '图示能量包络可能降采样；报告记录原始点数。字幕 textPreview 最多 300 字符，完整文案保留在输入分镜。',
    ],
  };
}

export function renderSyncSVG(report) {
  const width = 1280, height = 660, left = 120, right = 1240, span = right - left;
  const x = at => left + Math.max(0, Math.min(report.duration, at)) / report.duration * span;
  const number = n => round(n).toString();
  const label = (value, available) => [...value].slice(0, Math.max(1, Math.floor(available / 14) - 1)).join('');
  const elements = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`, '<title>音频、镜头与字幕同步候选检查</title>', '<desc>所有轨道使用同一成片秒时间轴。此图不能代替人工试听或证明 verified。</desc>', '<rect width="1280" height="660" fill="#101827"/>', '<g font-family="Microsoft YaHei, sans-serif" font-size="13" fill="#e5e7eb">', '<text x="26" y="32" font-size="22">音频 · 镜头 · 字幕同步候选检查</text>', `<text x="26" y="58">成片 ${xml(number(report.duration))} 秒 · 原曲偏移 ${xml(number(report.sourceOffset))} 秒 · music.status=${xml(report.musicStatus)} · 字幕角色=${xml(report.captionRole)}</text>`, '<text x="26" y="83" fill="#f6c76b">结构与机器候选网格；未证明核听，不自动升级 verified</text>'];
  const tickStep = report.duration / 10;
  for (let i = 0; i <= 10; i++) {
    const at = i * tickStep;
    elements.push(`<line x1="${number(x(at))}" y1="112" x2="${number(x(at))}" y2="550" stroke="#293549"/><text x="${number(x(at))}" y="573" text-anchor="middle">${xml(number(at))}s</text>`);
  }
  elements.push('<text x="26" y="156">音频能量</text>', '<text x="26" y="179" font-size="11" fill="#9aa9bf">归一化 RMS</text>');
  if (report.energy.length) elements.push(`<polyline points="${report.energy.map(point => `${number(x(point.at))},${number(218 - point.normalized * 105)}`).join(' ')}" fill="none" stroke="#67d8c0" stroke-width="1.5"/>`);
  else elements.push('<text x="120" y="176" fill="#9aa9bf">无能量数据</text>');
  elements.push('<text x="26" y="253">候选节拍</text>');
  if (report.beats.length) for (const at of report.beats) elements.push(`<line x1="${number(x(at))}" y1="234" x2="${number(x(at))}" y2="260" stroke="#ae9bf3" opacity="0.55"><title>${xml(number(at))} 秒</title></line>`);
  else elements.push('<text x="120" y="253" fill="#9aa9bf">无候选拍点；落点误差为空</text>');
  elements.push('<text x="26" y="314">镜头区间</text>');
  report.sceneStarts.forEach((scene, i) => {
    const delta = scene.deltaMs === null ? '无候选误差' : `${number(scene.deltaMs)} ms`;
    elements.push(`<rect x="${number(x(scene.start))}" y="282" width="${number(x(scene.end) - x(scene.start))}" height="54" fill="${i % 2 ? '#354361' : '#263d58'}" stroke="#6e83a4"><title>${xml(scene.id)}: ${xml(number(scene.start))}–${xml(number(scene.end))} 秒；起点误差 ${xml(delta)}</title></rect>`);
    if (x(scene.end) - x(scene.start) > 65) elements.push(`<text x="${number((x(scene.start) + x(scene.end)) / 2)}" y="314" text-anchor="middle">${xml(label(scene.id, x(scene.end) - x(scene.start)))}</text>`);
    if (i) elements.push(`<line x1="${number(x(scene.start))}" y1="112" x2="${number(x(scene.start))}" y2="548" stroke="#f6c76b" stroke-dasharray="3 4" opacity="0.6"/>`);
  });
  elements.push('<text x="26" y="400">字幕区间</text>', '<text x="26" y="422" font-size="11" fill="#9aa9bf">悬停查看文案</text>');
  // Fixed lanes keep output height bounded; overlapping cues are all retained in JSON.
  report.captions.forEach((cue, i) => {
    const y = 367 + i % 7 * 24, delta = cue.deltaMs === null ? '无候选误差' : `${number(cue.deltaMs)} ms`;
    elements.push(`<rect x="${number(x(cue.start))}" y="${y}" width="${number(x(cue.end) - x(cue.start))}" height="19" rx="2" fill="#477e9e" stroke="#9dd7e8"><title>${xml(cue.id)}: ${xml(number(cue.start))}–${xml(number(cue.end))} 秒；起点误差 ${xml(delta)}\n${xml(cue.textPreview)}</title></rect>`);
    if (x(cue.end) - x(cue.start) > 60) elements.push(`<text x="${number(x(cue.start) + 4)}" y="${y + 14}" font-size="11">${xml(label(cue.id, x(cue.end) - x(cue.start)))}</text>`);
  });
  const summary = report.summary.internalSceneStarts;
  elements.push(`<text x="26" y="610">内部镜头起点 ${summary.count} 个；平均绝对候选误差 ${summary.meanAbsMs === null ? '无' : xml(number(summary.meanAbsMs)) + ' ms'}。正数较晚，负数较早。</text>`, '<text x="26" y="636" fill="#9aa9bf">器乐叙事字幕可依据段落、能量与语义落点；所有误差只供人工复核。精确区间和输入哈希见同名 JSON。</text>', '</g></svg>');
  return elements.join('\n') + '\n';
}

async function loadJSON(path) {
  if ((await stat(path)).size > MAX_INPUT_BYTES) fail(`输入超过 ${MAX_INPUT_BYTES} 字节上限`);
  const bytes = await readFile(path);
  if (bytes.length > MAX_INPUT_BYTES) fail('输入读取时超过大小上限');
  return { data: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')), sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function sameFile(first, second) {
  const normalize = path => process.platform === 'win32' ? path.toLowerCase() : path;
  if (normalize(resolve(first)) === normalize(resolve(second))) return true;
  try {
    if (normalize(await realpath(first)) === normalize(await realpath(second))) return true;
    const [a, b] = await Promise.all([stat(first), stat(second)]);
    return a.dev === b.dev && a.ino === b.ino;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function existingOutput(path) {
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (info.isDirectory()) fail(`报告输出不能是目录：${path}`);
  if (info.isSymbolicLink()) {
    try { if ((await stat(path)).isDirectory()) fail(`报告输出不能指向目录：${path}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  } else if (!info.isFile()) fail(`报告输出须为普通文件：${path}`);
  return true;
}

/** Publish the pair with recoverable backups. fileOps is a test seam for rename failures. */
async function publishPair(out, jsonOut, svg, json, fileOps) {
  const move = fileOps.rename ?? rename;
  const entries = [
    { path: out, fresh: 'report.svg', previous: 'previous.svg', backedUp: false, published: false },
    { path: jsonOut, fresh: 'report.json', previous: 'previous.json', backedUp: false, published: false },
  ];
  // Reject directories before creating temporary files or replacing either old report.
  for (const entry of entries) await existingOutput(entry.path);
  const temporary = await mkdtemp(join(dirname(out), '.sync-writing-'));
  try {
    await writeFile(join(temporary, 'report.svg'), svg); await writeFile(join(temporary, 'report.json'), json);
    for (const entry of entries) if (await existingOutput(entry.path)) {
      await move(entry.path, join(temporary, entry.previous)); entry.backedUp = true;
    }
    for (const entry of entries) {
      await move(join(temporary, entry.fresh), entry.path); entry.published = true;
    }
  } catch (error) {
    const failures = [];
    for (const entry of [...entries].reverse()) if (entry.published) {
      try { await rm(entry.path, { force: true }); entry.published = false; }
      catch (rollbackError) { failures.push(`${entry.path} 新输出移除失败：${rollbackError.message}`); }
    }
    for (const entry of entries) if (entry.backedUp) {
      // Never replace an output whose removal failed; keep that original backup for recovery.
      if (entry.published) continue;
      try { await move(join(temporary, entry.previous), entry.path); entry.backedUp = false; }
      catch (rollbackError) { failures.push(`${entry.path} 恢复失败：${rollbackError.message}`); }
    }
    if (failures.length) {
      const failure = new Error(`报告成对发布失败：${error.message}。回滚未完成，备份保留于 ${temporary}。${failures.join('；')}`, { cause: error });
      failure.backupDirectory = temporary;
      throw failure;
    }
    try { await rm(temporary, { recursive: true, force: true }); }
    catch (cleanupError) {
      const failure = new Error(`报告发布失败且旧输出已恢复：${error.message}。临时目录清理失败，保留于 ${temporary}：${cleanupError.message}`, { cause: error });
      failure.backupDirectory = temporary;
      throw failure;
    }
    throw error;
  }
  try { await rm(temporary, { recursive: true, force: true }); }
  catch (error) {
    const failure = new Error(`报告已成对发布，但临时备份清理失败，保留于 ${temporary}：${error.message}`, { cause: error });
    failure.backupDirectory = temporary;
    throw failure;
  }
}

export async function writeSyncReport(options, fileOps = {}) {
  const storyboard = resolve(options.storyboard), analysis = resolve(options.analysis), out = resolve(options.out);
  if (extname(out).toLowerCase() !== '.svg') fail('--out 须使用 .svg 扩展名');
  const jsonOut = out.slice(0, -4) + '.json';
  if (await sameFile(out, jsonOut)) fail('SVG 与 JSON 输出路径指向同一文件');
  for (const output of [out, jsonOut]) for (const input of [storyboard, analysis]) if (await sameFile(output, input)) fail('SVG 或相邻 JSON 输出不能覆盖任何输入');
  const [sb, an] = await Promise.all([loadJSON(storyboard), loadJSON(analysis)]);
  const report = buildSyncReport(sb.data, an.data);
  report.inputs = { storyboard: { name: basename(storyboard), sha256: sb.sha256 }, analysis: { name: basename(analysis), sha256: an.sha256 } };
  const svg = renderSyncSVG(report), json = JSON.stringify(report, null, 2) + '\n';
  if (Buffer.byteLength(svg) > 4 * 1024 * 1024 || Buffer.byteLength(json) > 4 * 1024 * 1024) fail('报告输出超过 4 MB 上限，请缩短片段');
  await mkdir(dirname(out), { recursive: true });
  await publishPair(out, jsonOut, svg, json, fileOps);
  return { out, jsonOut, report };
}

export function parseArgs(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  if (args.length !== 4 || args[2] !== '--out' || args.some(value => typeof value !== 'string' || !value.trim()) || args[0].startsWith('--') || args[1].startsWith('--') || extname(args[3]).toLowerCase() !== '.svg') fail('用法：node visualize-sync.mjs storyboard.json analysis.json --out report.svg');
  return { storyboard: args[0], analysis: args[1], out: args[3] };
}

const usage = `用法：node visualize-sync.mjs storyboard.json analysis.json --out report.svg
analysis.json 使用 analyze-audio.mjs 对同一成片区间生成的 draft 报告。
输出 SVG 与同名 JSON：音频能量、候选节拍、镜头/字幕区间及起点候选误差。
所有轨道使用成片秒；检查 duration/sourceOffset 匹配，不覆盖输入。
此图不能证明核听或升级 verified；叙事字幕落点不必逐句贴拍。仅用 Node 内置模块。`;

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(usage);
    else { const result = await writeSyncReport(options); console.log(`已保存同步候选图：${result.out}\n结构与误差报告：${result.jsonOut}`); }
  } catch (error) { console.error(`同步图生成失败：${error.message}`); process.exitCode = 1; }
}
