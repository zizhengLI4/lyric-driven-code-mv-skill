#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectPNG } from './png.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const text = value => typeof value === 'string' && value.trim().length > 0;
const here = dirname(fileURLToPath(import.meta.url));
export const STARTER_VISUAL_SOURCES = ['frame.mjs', 'frame-core.mjs', 'timeline.mjs', 'png.mjs', 'export.mjs'].map(name => resolve(here, name));

function reject(detail) {
  throw new Error('场景与人物静帧确认未通过：' + detail);
}

function checkCoverage(rows, required, name) {
  if (!Array.isArray(rows) || !Array.isArray(required)) reject(name + '清单必须为数组');
  const expected = new Set(required.map(row => row?.id));
  if (expected.size !== required.length || [...expected].some(id => !text(id))) reject('分镜中的' + name + 'ID缺失或重复');
  const found = new Set();
  for (const row of rows) {
    if (!expected.has(row?.id) || found.has(row.id)) reject(name + 'ID无效或重复：' + (row?.id ?? '缺失'));
    found.add(row.id);
    if (!text(row.decision)) reject(name + ' ' + row.id + ' 缺少用户确认依据');
  }
  const missing = [...expected].filter(id => !found.has(id));
  if (missing.length) reject(name + '尚未确认：' + missing.join('、'));
}

export async function checkVisualReview({ storyboardPath, reviewPath, requiredSources = [], expectedStoryboardHash, expectedFont } = {}) {
  if (!reviewPath) reject('请先让用户分别确认本次的场景和人物静帧，再传入 --review PATH。');
  let raw, storyboard, reviewRaw, review;
  try {
    raw = await readFile(storyboardPath);
    storyboard = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
    reviewRaw = await readFile(reviewPath);
    review = JSON.parse(reviewRaw.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    reject('无法读取分镜或确认记录：' + error.message);
  }
  if (review?.schemaVersion !== 1 || !text(review.reviewedAt) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(review.reviewedAt) ||
      !Number.isFinite(Date.parse(review.reviewedAt))) reject('请记录 schemaVersion:1 和含时区的 reviewedAt');
  if (expectedFont !== undefined && review.renderSettings?.font !== expectedFont) {
    reject('正式字幕字体已变更或未记录，请核对带字幕静帧');
  }
  const storyboardHash = sha256(raw);
  if (review.storyboardSha256 !== storyboardHash || (expectedStoryboardHash && expectedStoryboardHash !== storyboardHash)) {
    reject('分镜版本已变更，核对受影响静帧并更新用户确认记录');
  }
  if (!Array.isArray(review.sources) || !review.sources.length) reject('请记录当前绘制源码与视觉素材的哈希');
  checkCoverage(review.scenes, storyboard?.scenes, '场景');
  checkCoverage(review.actors, storyboard?.actors ?? [], '人物');

  const directory = dirname(reviewPath);
  const files = new Set();
  async function checkFile(entry, label, imageSize = null) {
    if (!text(entry?.path) || !/^[a-f0-9]{64}$/i.test(entry.sha256 ?? '')) reject(label + '缺少文件路径或 SHA-256');
    const path = resolve(directory, entry.path);
    try {
      const bytes = await readFile(path);
      if (sha256(bytes) !== entry.sha256.toLowerCase()) reject(label + '已变更：' + entry.path);
      if (imageSize) {
        if (extname(path).toLowerCase() !== '.png') reject(label + '应为 PNG 静帧');
        const image = inspectPNG(bytes, { template: false });
        if (imageSize.width && (image.width !== imageSize.width || image.height !== imageSize.height)) {
          reject(label + '须与正式输出尺寸相同');
        }
      }
      const canonical = await realpath(path);
      files.add(canonical);
      return canonical;
    } catch (error) {
      if (error.message.startsWith('场景与人物静帧确认未通过')) throw error;
      reject(label + '无法核查：' + entry.path + '。' + error.message);
    }
  }
  const checkedSources = new Set();
  for (const entry of review.sources) checkedSources.add(await checkFile(entry, '绘制文件'));
  for (const source of requiredSources) {
    const canonical = await realpath(source);
    if (!checkedSources.has(canonical)) reject('确认记录缺少实际绘制文件：' + source);
  }
  for (const row of review.scenes) {
    await checkFile(row.frame, '场景 ' + row.id + ' 静帧', storyboard.project);
    if (row.details !== undefined && !Array.isArray(row.details)) reject('场景 ' + row.id + ' 的 details 须为数组');
    for (const frame of row.details ?? []) await checkFile(frame, '场景 ' + row.id + ' 细节静帧', {});
  }
  for (const row of review.actors) {
    await checkFile(row.wide, '人物 ' + row.id + ' 远景静帧', {});
    await checkFile(row.close, '人物 ' + row.id + ' 近景静帧', {});
    if (row.wide.sha256.toLowerCase() === row.close.sha256.toLowerCase()) reject('人物 ' + row.id + ' 远近景必须分别提供');
    if (row.details !== undefined && !Array.isArray(row.details)) reject('人物 ' + row.id + ' 的 details 须为数组');
    for (const frame of row.details ?? []) await checkFile(frame, '人物 ' + row.id + ' 动作静帧', {});
  }
  return {
    path: resolve(reviewPath), sha256: sha256(reviewRaw), files: [...files],
    reviewedAt: review.reviewedAt, scenes: review.scenes.map(row => row.id), actors: review.actors.map(row => row.id),
  };
}

async function main(args) {
  const options = { requiredSources: [] };
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i], value = args[i + 1];
    if (!text(value) || value.startsWith('--')) throw new Error(name + ' 缺少路径');
    if (name === '--source') options.requiredSources.push(resolve(value));
    else if (name === '--storyboard' && !options.storyboardPath) options.storyboardPath = resolve(value);
    else if (name === '--review' && !options.reviewPath) options.reviewPath = resolve(value);
    else throw new Error('未知或重复参数：' + name);
  }
  if (!options.storyboardPath || !options.reviewPath || !options.requiredSources.length) {
    throw new Error('用法：node review-gate.mjs --storyboard 分镜.json --review 确认.json --source 绘制入口 [--source 其他绘制文件]');
  }
  const review = await checkVisualReview(options);
  console.log('用户静帧确认已核对：场景 ' + review.scenes.length + ' 个，人物 ' + review.actors.length + ' 位。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
