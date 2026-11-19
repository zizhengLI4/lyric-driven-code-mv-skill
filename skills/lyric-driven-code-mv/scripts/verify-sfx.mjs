#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { collectSfx } from './sfx.mjs';

const finite = (value, name, minimum = 0) => {
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${name} 必须为不小于 ${minimum} 的有限数`);
};

function rmsRange(samples, start, end) {
  const first = Math.max(0, Math.min(samples.length, start)), last = Math.max(first, Math.min(samples.length, end));
  let energy = 0;
  for (let i = first; i < last; i++) energy += samples[i] * samples[i];
  return Math.sqrt(energy / Math.max(1, last - first));
}

export function verifySfxEvents({ events, samples, sampleRate = 8000, duration, windowMs = 50, thresholdRatio = 1.5, floor = 1e-5 } = {}) {
  if (!Array.isArray(events)) throw new Error('events 必须为数组');
  if (!(samples instanceof Float32Array || samples instanceof Float64Array)) throw new Error('samples 必须为浮点 PCM 数组');
  finite(sampleRate, 'sampleRate', 1); finite(duration, 'duration', Number.EPSILON); finite(windowMs, 'windowMs', Number.EPSILON);
  finite(thresholdRatio, 'thresholdRatio', 1); finite(floor, 'floor');
  if (samples.length > sampleRate * (duration + 1 / sampleRate) || samples.length < Math.floor(duration * sampleRate * 0.95)) throw new Error('PCM 样本长度与 duration 不匹配');
  if (events.length === 0) return { schemaVersion: 1, status: 'skip', reason: '分镜没有音效事件，跳过起音证据检查。', duration, sampleRate, windowMs, total: 0, hits: 0, events: [] };
  const windowSamples = Math.max(1, Math.round(sampleRate * windowMs / 1000)), actualWindowMs = windowSamples / sampleRate * 1000;
  const results = events.map((event, index) => {
    if (!event || !Number.isFinite(event.at) || event.at < 0 || event.at >= duration) throw new Error(`事件${index + 1}的 at 必须位于 [0,duration)`);
    const start = Math.round(event.at * sampleRate), baselineStart = Math.max(0, start - windowSamples);
    const baseline = rmsRange(samples, baselineStart, start);
    const after = Array.from({ length: 3 }, (_, i) => rmsRange(samples, start + i * windowSamples, start + (i + 1) * windowSamples));
    const peak = Math.max(...after);
    const ratio = peak / Math.max(baseline, floor);
    const hit = peak >= floor && ratio >= thresholdRatio;
    return {
      id: String(event.id ?? `${event.type ?? 'event'}-${String(index + 1).padStart(2, '0')}`), at: event.at,
      hit,
      evidence: {
        method: `${actualWindowMs.toFixed(3)}ms RMS envelope + onset rise`, windowMs: Number(actualWindowMs.toFixed(3)),
        baseline: Number(baseline.toFixed(6)), peak: Number(peak.toFixed(6)), ratio: Number(ratio.toFixed(3)),
        baselineWindow: [Number((baselineStart / sampleRate).toFixed(4)), Number(event.at.toFixed(4))],
        onsetWindow: [Number(event.at.toFixed(4)), Number(Math.min(duration, (start + after.length * windowSamples) / sampleRate).toFixed(4))],
        threshold: { minimumRms: floor, minimumRiseRatio: thresholdRatio },
      },
    };
  });
  return { schemaVersion: 1, status: results.every(event => event.hit) ? 'pass' : 'fail', duration, sampleRate, windowMs: Number(actualWindowMs.toFixed(3)), total: results.length, hits: results.filter(event => event.hit).length, events: results };
}

async function decodePcm(ffmpeg, audioPath, sampleRate) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(ffmpeg, ['-v', 'error', '-i', audioPath, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let size = 0, stderr = '';
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 512 * 1024 * 1024) { child.kill(); reject(new Error('解码PCM超过512MiB限制')); } else chunks.push(chunk); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) return reject(new Error(`ffmpeg 解码失败（${ffmpeg}）：${stderr || `exit ${code}`}`));
      const bytes = Buffer.concat(chunks);
      if (bytes.length % 4) return reject(new Error('ffmpeg 返回了不完整的 f32le 样本'));
      const aligned = new Float32Array(bytes.length / 4);
      for (let i = 0; i < aligned.length; i++) aligned[i] = bytes.readFloatLE(i * 4);
      resolvePromise(aligned);
    });
  });
}

async function run(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!['--audio', '--storyboard', '--ffmpeg', '--window-ms', '--out'].includes(key) || !value || value.startsWith('--') || Object.hasOwn(opts, key)) throw new Error(`未知参数、重复参数或缺少值：${key}`);
    opts[key] = value;
  }
  if (!opts['--audio'] || !opts['--storyboard']) throw new Error('用法：node scripts/verify-sfx.mjs --audio mixed.wav --storyboard storyboard.json [--window-ms 50] [--out evidence.json]');
  const storyboard = JSON.parse((await readFile(resolve(opts['--storyboard']), 'utf8')).replace(/^\uFEFF/u, ''));
  const events = collectSfx(storyboard).map((event, index) => ({ ...event, id: event.id ?? `${event.type ?? 'sfx'}-${String(index + 1).padStart(2, '0')}` }));
  const duration = storyboard.project.duration, sampleRate = 8000;
  const configuredFfmpeg = opts['--ffmpeg'] ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const ffmpeg = /[\\/]/u.test(configuredFfmpeg) ? resolve(configuredFfmpeg) : configuredFfmpeg;
  const samples = await decodePcm(ffmpeg, resolve(opts['--audio']), sampleRate);
  const report = verifySfxEvents({ events, samples, sampleRate, duration, windowMs: Number(opts['--window-ms'] ?? 50) });
  if (opts['--out']) await import('node:fs/promises').then(fs => fs.writeFile(resolve(opts['--out']), `${JSON.stringify(report, null, 2)}\n`));
  if (report.status === 'skip') { console.log(report.reason); return; }
  console.log(`音效起音检查 ${report.status}：${report.hits}/${report.total} 命中（包络窗 ${report.windowMs}ms）`);
  console.log('事件\t时点\t结果\t基线 RMS\t起音峰值\t倍率\t起音证据窗');
  for (const event of report.events) console.log(`${event.id}\t${event.at.toFixed(3)}s\t${event.hit ? '命中' : '未命中'}\t${event.evidence.baseline}\t${event.evidence.peak}\t${event.evidence.ratio}×\t${event.evidence.onsetWindow.join('–')}s`);
  console.log(JSON.stringify({ method: '50ms RMS envelope + onset rise', total: report.total, hits: report.hits, events: report.events.map(({ id, at, hit, evidence }) => ({ id, at, hit, evidence })) }, null, 2));
  if (report.status === 'fail') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) run(process.argv.slice(2)).catch(error => { console.error(`音效证据校验失败：${error.message}`); process.exitCode = 1; });
