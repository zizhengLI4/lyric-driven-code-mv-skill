#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const timestamp = (minutes, seconds, fraction = '') => {
  const value = Number(minutes) * 60 + Number(seconds) + (fraction ? Number(`0.${fraction}`) : 0);
  if (!Number.isFinite(value) || Number(seconds) >= 60) throw new Error('LRC 时间戳无效');
  return value;
};

export function parseLrc(source, { offset = 0, duration = null, lastDuration = 3, scenes = [] } = {}) {
  if (typeof source !== 'string') throw new Error('LRC 内容必须为文本');
  if (!Number.isFinite(offset)) throw new Error('offset 必须为有限数');
  if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) throw new Error('duration 必须为正有限数');
  if (!Number.isFinite(lastDuration) || lastDuration <= 0) throw new Error('lastDuration 必须为正有限数');
  const timed = [];
  let sequence = 0;
  for (const line of source.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const tags = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/gu)];
    if (!tags.length) continue;
    const text = line.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/gu, '').trim();
    if (!text) continue;
    for (const tag of tags) timed.push({ sourceStart: timestamp(...tag.slice(1)), text, sequence: sequence++ });
  }
  timed.sort((a, b) => a.sourceStart - b.sourceStart || a.sequence - b.sequence);
  const clipEnd = duration ?? (timed.length ? timed.at(-1).sourceStart + lastDuration + offset : 0);
  const scenesSorted = [...scenes].filter(scene => Number.isFinite(scene?.start) && Number.isFinite(scene?.end) && scene.end > scene.start).sort((a, b) => a.start - b.start);
  return timed.map((cue, index) => {
    const start = Math.max(0, cue.sourceStart + offset);
    const nextDistinct = timed.slice(index + 1).find(next => next.sourceStart > cue.sourceStart);
    const naturalEnd = (nextDistinct?.sourceStart ?? cue.sourceStart + lastDuration) + offset;
    const end = Math.min(clipEnd, Math.max(start, naturalEnd));
    const crossed = scenesSorted.some(scene => scene.end > start + 1e-6 && scene.end < end - 1e-6 && scenesSorted.some(next => Math.abs(next.start - scene.end) <= 1e-6));
    return {
      id: `lyric-${String(index + 1).padStart(3, '0')}`,
      start: Number(start.toFixed(6)), end: Number(end.toFixed(6)), text: cue.text,
      ...(crossed ? { allowSceneSplit: true, splitReason: 'LRC 字幕时间段横跨分镜边界，保留同一行连续呈现' } : {}),
    };
  }).filter(cue => cue.end > cue.start);
}

function parseArgs(argv) {
  const options = { '--lrc': 'lrc', '--offset': 'offset', '--duration': 'duration', '--last-duration': 'lastDuration', '--scenes': 'scenes', '--storyboard': 'storyboard', '--out': 'out' };
  const result = { offset: 0, duration: null, lastDuration: 3 };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i], key = options[flag], value = argv[++i];
    if (!key || value === undefined || value.startsWith('--')) throw new Error(`未知参数或缺少值：${argv[i - 1] ?? argv[i]}`);
    if (seen.has(key)) throw new Error(`重复参数：${key}`);
    seen.add(key);
    result[key] = ['offset', 'duration', 'lastDuration'].includes(key) ? Number(value) : value;
  }
  if (!result.lrc) throw new Error('用法：node scripts/lrc.mjs --lrc song.lrc [--offset 12] [--duration 90] [--storyboard storyboard.json] [--out lyrics.json]');
  return result;
}

async function main(argv) {
  const args = parseArgs(argv);
  const source = await readFile(resolve(args.lrc), 'utf8');
  let scenes = [];
  if (args.storyboard) {
    const storyboard = JSON.parse(await readFile(resolve(args.storyboard), 'utf8').then(text => text.replace(/^\uFEFF/u, '')));
    scenes = storyboard.scenes ?? [];
    args.duration ??= storyboard.project?.duration ?? null;
  }
  if (args.scenes) {
    const parsed = JSON.parse(await readFile(resolve(args.scenes), 'utf8'));
    scenes = Array.isArray(parsed) ? parsed : parsed.scenes ?? [];
  }
  const lyrics = parseLrc(source, args);
  const output = `${JSON.stringify(lyrics, null, 2)}\n`;
  if (args.out) await writeFile(resolve(args.out), output, 'utf8');
  else process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`LRC 转换失败：${error.message}`); process.exitCode = 1; });
}
