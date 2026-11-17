#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const NARRATIVE_12 = Object.freeze([
  ['window', '隔窗', '室内与玻璃窗外'], ['leave', '离开', '夜晚街道'], ['empty', '空房', '空置房间'],
  ['turn', '转身', '再次相遇的街角'], ['neon', '霓虹', '霓虹招牌下'], ['street', '长街', '雨夜道路'],
  ['shatter', '碎裂', '旧照片前'], ['lesson', '教训', '黑板与粉笔'], ['night', '夜色', '低矮城市上空'],
  ['dawn', '黎明', '晨光地平线'], ['path', '远路', '收敛的土路'], ['lookback', '回望', '逆光中的道路'],
]);

const round = value => Number(value.toFixed(6));

export function buildNarrative12Storyboard({ duration = 90, lyrics = [] } = {}) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('duration 必须为 0–3600 秒之间的正有限数');
  if (!Array.isArray(lyrics)) throw new Error('lyrics 必须为数组');
  const cueIds = new Set();
  const normalizedLyrics = lyrics.map((cue, i) => {
    if (!cue || typeof cue !== 'object' || Array.isArray(cue)) throw new Error(`lyrics[${i}] 必须为对象`);
    const text = cue.text ?? cue.zh;
    if (typeof text !== 'string' || !text.trim()) throw new Error(`lyrics[${i}].text 必须为非空字符串`);
    const start = Number(cue.start), end = Number(cue.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end || end > duration) throw new Error(`lyrics[${i}] 时间须位于 [0, duration] 且 start < end`);
    const id = String(cue.id ?? `lyric-${String(i + 1).padStart(3, '0')}`);
    if (cueIds.has(id)) throw new Error(`歌词 id 重复：${id}`);
    cueIds.add(id);
    return { id, start, end, text: text.trim(), ...(cue.en ? { en: String(cue.en) } : {}) };
  });
  const scenes = NARRATIVE_12.map(([id, label], i) => {
    const start = round(duration * i / NARRATIVE_12.length), end = i === NARRATIVE_12.length - 1 ? duration : round(duration * (i + 1) / NARRATIVE_12.length);
    return {
      id, start, end,
      meaning: `待填写：${label}镜头要表达的人物关系或意象变化`,
      location: `待填写：${label}镜头发生地点与空间关系`,
      objective: `待填写：主体在${label}镜头中的可见目标`,
      action: `待填写：主体在${label}镜头中执行的具体动作`,
      feedback: `待填写：环境或系统如何反馈这个动作`,
      outcome: `待填写：${label}镜头结束时可见的结果`,
      lyricIds: normalizedLyrics.filter(cue => cue.start < end && start < cue.end).map(cue => cue.id),
      actors: [], props: [], events: [],
      exit: i === NARRATIVE_12.length - 1 ? { type: 'cut', dur: 0 } : { type: 'dissolve', dur: Math.min(0.8, round((end - start) / 3)), target: 'next' },
    };
  });
  return {
    schemaVersion: 1, timebase: 'clip',
    project: {
      fps: 30, duration, sourceOffset: 0, width: 1920, height: 1080, virtualWidth: 384, virtualHeight: 216,
      seed: 'narrative-12', audio: { path: 'song.wav', timebase: 'clip', provenance: 'original', license: 'Original placeholder audio; replace before delivery', credit: '待填写作者署名', use: 'demo' },
    },
    note: '自动生成的叙事骨架；请将“待填写”字段替换为真实分镜，并把 illustrative 音乐状态改为真实适用状态。',
    lyrics: normalizedLyrics, music: { status: 'illustrative', presentationNotice: true, evidence: { method: '自动生成空白分镜骨架', limitations: '尚未核对音乐、歌词时点或授权' }, beats: [], sections: [{ id: 'full-clip', start: 0, end: duration }] },
    actors: [], props: [], scenes,
  };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!['--preset', '--duration', '--lyrics', '--out'].includes(key) || value === undefined || value.startsWith('--') || Object.hasOwn(opts, key)) throw new Error(`未知参数、重复参数或缺少值：${key}`);
    opts[key] = value;
  }
  if (opts['--preset'] !== 'narrative-12' || !opts['--duration']) throw new Error('用法：node scripts/new-storyboard.mjs --preset narrative-12 --duration 90 [--lyrics lyrics.json] [--out storyboard.json]');
  return opts;
}

async function main(argv) {
  const opts = parseArgs(argv);
  const lyrics = opts['--lyrics'] ? JSON.parse(await readFile(resolve(opts['--lyrics']), 'utf8').then(text => text.replace(/^\uFEFF/u, ''))) : [];
  const storyboard = buildNarrative12Storyboard({ duration: Number(opts['--duration']), lyrics: Array.isArray(lyrics) ? lyrics : lyrics.lyrics });
  const output = `${JSON.stringify(storyboard, null, 2)}\n`;
  if (opts['--out']) await writeFile(resolve(opts['--out']), output, 'utf8');
  else process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(`分镜骨架生成失败：${error.message}`); process.exitCode = 1; });
