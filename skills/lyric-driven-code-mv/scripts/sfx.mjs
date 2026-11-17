#!/usr/bin/env node
/**
 * sfx.mjs — 生成代码 MV 的音效层，不依赖任何外部素材。
 *
 * 参考片里"卡点"其实是两层结构：
 *   画面变化 → 落在音乐拍点上（music.beats，80ms 容差）
 *   音效      → 与画面变化同帧（offset 接近 0），不跟拍点
 * 所以音效必须由代码在导出时合成，才能和画面帧严格对齐、不会漂。
 *
 * 用法：
 *   node scripts/sfx.mjs --list
 *   node scripts/sfx.mjs tick --out work/tick.wav
 *   node scripts/sfx.mjs --timeline work/sfx.json --duration 12 --out work/sfx.wav --report work/sfx-report.json
 *
 * timeline 是 JSON 数组：
 *   [{ "at": 1.5, "type": "tick", "gain": 0.5, "pitch": 1.0 }, ...]
 * at 为成片秒；type 见 --list；gain 0–2；pitch 0.5–2。
 * 输出 44.1kHz / 16-bit / 立体声 WAV，长度严格等于 --duration。
 * 越界事件被裁掉并记入 report，不抛错。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_RATE = 44100;

// —— 基础振荡与包络（全部确定性，重复渲染逐采样一致）——
const sine = (t, f) => Math.sin(2 * Math.PI * f * t);
const square = (t, f) => (Math.sin(2 * Math.PI * f * t) >= 0 ? 1 : -1);
const saw = (t, f) => 2 * ((t * f) % 1) - 1;

function noise(i) {
  let x = (i + 0x2545f491) | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) / 4294967296) * 2 - 1;
}

function env(t, attack, decay) {
  if (t < 0) return 0;
  if (t < attack) return attack === 0 ? 1 : t / attack;
  const d = (t - attack) / decay;
  if (d >= 1) return 0;
  return (1 - d) ** 2 * Math.exp(-2.5 * d);
}

/** 音效表：duration 为原始时长（秒），pitch 会缩它。 */
export const SFX = {
  // 数字跳变、刻度、进度条推进
  tick: {
    duration: 0.045,
    synth: (t) => square(t, 1200) * env(t, 0.002, 0.030) * 0.5,
  },
  // 打字机：三连短噪
  type: {
    duration: 0.10,
    synth: (t, i) => {
      let v = 0;
      for (const [k, at] of [0, 0.030, 0.062].entries()) {
        const d = t - at;
        if (d >= 0 && d < 0.016) {
          v += noise(i + k * 977) * env(d, 0.001, 0.014) * (0.55 - k * 0.12);
        }
      }
      return v * 0.9;
    },
  },
  // UI 点击
  click: {
    duration: 0.035,
    synth: (t, i) => (square(t, 2200) * 0.4 + noise(i) * 0.6) * env(t, 0.0005, 0.020) * 0.6,
  },
  // 转场扫风：噪声从中频扫到高频
  whoosh: {
    duration: 0.42,
    synth: (t, i, dur) => {
      const p = t / dur;
      const cut = 0.10 + 0.85 * p * p;
      const mixed = noise(i * 3.1) * cut + noise(i * 0.7) * (1 - cut);
      return mixed * Math.sin(Math.PI * Math.min(1, p)) ** 1.6 * 0.55;
    },
  },
  // 勾选/确认：两音上行
  confirm: {
    duration: 0.22,
    synth: (t) => {
      const a = t < 0.075 ? sine(t, 880) * env(t, 0.002, 0.070) * 0.5 : 0;
      const b = t >= 0.075 ? sine(t - 0.075, 1320) * env(t - 0.075, 0.002, 0.130) * 0.55 : 0;
      return a + b;
    },
  },
  // 失败/否定：下行锯齿
  error: {
    duration: 0.30,
    synth: (t, _i, dur) => {
      const p = t / dur;
      return saw(t, 520 * 0.35 ** p) * env(t, 0.003, dur * 0.85) * 0.40;
    },
  },
  // 预热：段落前 0.6 秒的上升
  riser: {
    duration: 0.60,
    synth: (t, i, dur) => {
      const p = t / dur;
      const f = 180 * 6.0 ** p;
      return (saw(t, f) * 0.35 + noise(i * 1.7) * 0.25 * p) * p ** 1.4 * 0.5;
    },
  },
  // 结算/收束：三音和弦
  chime: {
    duration: 0.85,
    synth: (t) => {
      let v = 0;
      for (const [f, at] of [[523.25, 0], [659.25, 0.012], [783.99, 0.024]]) {
        const d = t - at;
        if (d >= 0) v += sine(d, f) * env(d, 0.004, 0.80) * 0.28;
      }
      return v;
    },
  },
};

export function listSfx() {
  return Object.keys(SFX).sort();
}

/**
 * 从分镜收集音效事件：project.sfx[] 与每个 scene.sfx[] 合并，按 at 排序。
 * 分镜里写 sfx 而不是另开时间轴，才能和同一镜的画面事件一起被校验。
 */
export function collectSfx(storyboard) {
  const out = [];
  for (const item of (storyboard && storyboard.project && storyboard.project.sfx) || []) out.push(item);
  for (const scene of (storyboard && storyboard.scenes) || []) {
    for (const item of (scene && scene.sfx) || []) out.push(item);
  }
  return out
    .filter((item) => item && typeof item === 'object')
    .sort((a, b) => Number(a.at) - Number(b.at));
}

/**
 * 渲染单个音效为立体声交错 Float32。
 * @param {string} type
 * @param {{gain?:number, pitch?:number, rate?:number}} opts
 */
export function renderSfx(type, { gain = 1, pitch = 1, rate = SAMPLE_RATE } = {}) {
  const def = SFX[type];
  if (!def) throw new Error(`未知音效类型：${type}（可用：${listSfx().join(', ')}）`);
  if (!(gain >= 0 && gain <= 2)) throw new Error(`gain 必须在 0–2：${gain}`);
  if (!(pitch >= 0.5 && pitch <= 2)) throw new Error(`pitch 必须在 0.5–2：${pitch}`);

  const dur = def.duration / pitch;
  const n = Math.max(1, Math.ceil(dur * rate));
  const out = new Float32Array(n * 2);
  const spread = type.length % 2 === 0 ? 0.06 : -0.06;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const v = def.synth(t * pitch, i, def.duration) * gain;
    out[i * 2] = Math.max(-1, Math.min(1, v * (1 + spread)));
    out[i * 2 + 1] = Math.max(-1, Math.min(1, v * (1 - spread)));
  }
  return out;
}

/**
 * 把时间轴叠加成整条音效轨。
 * @param {Array<{at:number,type:string,gain?:number,pitch?:number}>} timeline
 * @param {number} duration
 */
export function renderTimeline(timeline, duration, { rate = SAMPLE_RATE } = {}) {
  if (!Array.isArray(timeline)) throw new Error('timeline 必须是数组');
  if (!(duration > 0)) throw new Error('duration 必须为正数');

  const total = Math.ceil(duration * rate);
  const mix = new Float32Array(total * 2);
  const placed = [];
  const clipped = [];
  for (const [index, event] of timeline.entries()) {
    if (!event || typeof event !== 'object') throw new Error(`timeline[${index}] 不是对象`);
    const at = Number(event.at);
    if (!Number.isFinite(at) || at < 0) throw new Error(`timeline[${index}].at 必须是非负数字：${event.at}`);
    const type = String(event.type || '');
    const pcm = renderSfx(type, { gain: event.gain ?? 1, pitch: event.pitch ?? 1, rate });
    const start = Math.round(at * rate);

    let written = 0;
    for (let i = 0; i < pcm.length; i += 2) {
      const frame = start + i / 2;
      if (frame >= total) { clipped.push({ index, at, type }); break; }
      mix[frame * 2] += pcm[i];
      mix[frame * 2 + 1] += pcm[i + 1];
      written += 1;
    }
    placed.push({ index, at, type, startFrame: start, frames: written, gain: event.gain ?? 1 });
  }

  let peak = 0;
  for (let i = 0; i < mix.length; i++) peak = Math.max(peak, Math.abs(mix[i]));
  const norm = peak > 0.98 ? 0.98 / peak : 1;
  if (norm !== 1) for (let i = 0; i < mix.length; i++) mix[i] *= norm;

  // 首尾各 8ms 淡入淡出：被 duration 截断的尾音不会爆音
  const fade = Math.min(total, Math.round(rate * 0.008));
  for (let i = 0; i < fade; i++) {
    const gain = i / fade;
    const head = i * 2;
    const tail = (total - fade + i) * 2;
    mix[head] *= gain;
    mix[head + 1] *= gain;
    mix[tail] *= gain;
    mix[tail + 1] *= gain;
  }

  return {
    pcm: mix,
    report: {
      duration,
      sampleRate: rate,
      totalFrames: total,
      events: placed.length,
      perMinute: Number((placed.length / (duration / 60)).toFixed(2)),
      peakBeforeNorm: Number(peak.toFixed(4)),
      normalization: Number(norm.toFixed(4)),
      clipped,
      placed,
    },
  };
}

/** 16-bit PCM 立体声 WAV。 */
export function encodeWav(pcm, { rate = SAMPLE_RATE } = {}) {
  const dataBytes = (pcm.length / 2) * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.length; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), 44 + i * 2);
  }
  return buf;
}

function flag(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    console.log('可用音效：');
    for (const name of listSfx()) console.log(`  ${name.padEnd(9)} ${(SFX[name].duration * 1000).toFixed(0)}ms`);
    return 0;
  }

  const out = flag('--out');
  if (!out) {
    console.error('用法：node scripts/sfx.mjs <type> --out file.wav [--gain 1] [--pitch 1]');
    console.error('      node scripts/sfx.mjs --timeline sfx.json --duration 12 --out sfx.wav [--report report.json]');
    return 2;
  }

  const timelinePath = flag('--timeline');
  const storyboardPath = flag('--from-storyboard');
  if (timelinePath || storyboardPath) {
    let timeline;
    let fallbackDuration = 0;
    if (timelinePath) {
      timeline = JSON.parse(readFileSync(timelinePath, 'utf8'));
    } else {
      const storyboard = JSON.parse(readFileSync(storyboardPath, 'utf8'));
      timeline = collectSfx(storyboard);
      fallbackDuration = Number(storyboard?.project?.duration ?? 0);
    }
    const duration = Number(flag('--duration', String(fallbackDuration)));
    if (!(duration > 0)) { console.error('必须给 --duration（秒），或分镜里写 project.duration'); return 2; }
    const { pcm, report } = renderTimeline(timeline, duration);
    writeFileSync(out, encodeWav(pcm));
    const reportPath = flag('--report');
    if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    const tail = report.clipped.length ? `｜裁掉 ${report.clipped.length} 个越界事件` : '';
    console.log(`音效轨 ${out}｜${report.events} 个事件 / 每分钟 ${report.perMinute} 个｜峰值 ${report.peakBeforeNorm}${tail}`);
    return 0;
  }

  const type = argv.find((a) => !a.startsWith('--'));
  if (!type) { console.error('缺少音效类型，用 --list 查看'); return 2; }
  const pcm = renderSfx(type, { gain: Number(flag('--gain', '1')), pitch: Number(flag('--pitch', '1')) });
  writeFileSync(out, encodeWav(pcm));
  console.log(`已生成 ${out}（${type}，${(pcm.length / 2 / SAMPLE_RATE).toFixed(3)}s）`);
  return 0;
}

const entry = process.argv[1];
const isMain = entry ? resolve(entry) === resolve(fileURLToPath(import.meta.url)) : false;
if (isMain) {
  try {
    process.exit(main());
  } catch (error) {
    console.error('失败：' + error.message);
    process.exit(1);
  }
}
