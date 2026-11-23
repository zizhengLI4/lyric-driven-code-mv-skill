import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertNoPathAliases } from './path-safety.mjs';

const positive = (value, name) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 必须为正有限数`);
};

export function collectSampleTimes({ duration, fps, scenes = [], music = {}, samples = 16 }) {
  positive(duration, 'duration');
  positive(fps, 'fps');
  if (!Number.isInteger(samples) || samples < 2 || samples > 1000) throw new Error('samples 必须为 2–1000 的整数');
  const last = Math.max(0, duration - 1 / fps);
  const times = new Set([0, last]);
  const add = t => {
    if (Number.isFinite(t) && t >= 0 && t <= last + 1e-8) times.add(Math.min(t, last));
  };
  const around = t => [t - 1 / fps, t, t + 1 / fps].forEach(add);
  for (let i = 0; i < samples; i++) add(last * i / (samples - 1));
  for (const scene of scenes) {
    around(scene.start);
    around(scene.end);
    add((scene.start + scene.end) / 2);
    if (scene.exit && scene.exit.type !== 'cut' && Number.isFinite(scene.exit.dur)) {
      around(scene.end - scene.exit.dur);
      add(scene.end - scene.exit.dur / 2);
    }
    for (const event of scene.events ?? []) around(event.at);
  }
  for (const beat of music?.beats ?? []) {
    if (Number.isFinite(beat)) add(Math.max(0, Math.min(last, beat - 1 / fps)));
  }
  return [...times].sort((a, b) => a - b);
}

export function buildShotReviewIndex(storyboard) {
  const { duration, fps } = storyboard.project ?? {};
  positive(duration, 'duration');
  positive(fps, 'fps');
  if (!Array.isArray(storyboard.scenes) || !storyboard.scenes.length) throw new Error('审片索引需要场景清单');
  const numberAt = time => Math.ceil(time * fps - 1e-9);
  const totalFrames = numberAt(duration);
  const ids = new Set();
  const scenes = storyboard.scenes.map(scene => {
    if (typeof scene.id !== 'string' || !Number.isFinite(scene.start) || !Number.isFinite(scene.end) ||
        scene.start < 0 || scene.end > duration + 1e-8 || scene.end <= scene.start) throw new Error('场景 ID 或时段无效');
    if (!scene.id.trim() || ids.has(scene.id)) throw new Error('审片索引场景 ID 缺失或重复');
    ids.add(scene.id);
    const first = numberAt(scene.start), after = Math.min(totalFrames, numberAt(scene.end));
    if (first >= after) throw new Error('场景 ' + scene.id + ' 在输出帧率下没有可见帧');
    const points = new Map();
    const add = (frame, label) => {
      if (frame < 0 || frame >= totalFrames) return;
      if (!points.has(frame)) points.set(frame, []);
      points.get(frame).push(label);
    };
    const around = (frame, label) => {
      add(frame - 1, label + ':before');
      add(frame, label);
      add(frame + 1, label + ':after');
    };
    add(first, 'start');
    add(first + Math.floor((after - first - 1) / 2), 'middle');
    add(after - 1, 'end');
    for (const [i, event] of (scene.events ?? []).entries()) {
      if (!Number.isFinite(event.at) || event.at < scene.start || event.at >= scene.end) continue;
      around(Math.min(after - 1, numberAt(event.at)), 'event:' + (event.id ?? i + 1));
    }
    if (scene.exit?.type && scene.exit.type !== 'cut' && scene.exit.dur > 0) {
      around(numberAt(scene.end - scene.exit.dur), 'transition-start');
      add(numberAt(scene.end - scene.exit.dur / 2), 'transition-middle');
    }
    around(after, 'boundary');
    const lyrics = (storyboard.lyrics ?? []).filter(cue => cue.start < scene.end && cue.end > scene.start)
      .map(cue => ({ id: cue.id, start: cue.start, end: cue.end, text: cue.zh ?? cue.text }));
    return {
      id: scene.id, start: scene.start, end: scene.end, lyrics,
      frames: [...points].sort(([a], [b]) => a - b).map(([frame, reasons]) => ({ frame, time: frame / fps, reasons })),
      visualReview: 'pending',
    };
  });
  return { schemaVersion: 1, duration, fps, totalFrames, scenes, use: '按零基帧号读取最终视频，逐镜核对后填写检查结果。' };
}

function frameHash(frame) {
  const { width, height, data } = frame ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 16777216) {
    throw new Error('帧宽高必须为正整数，最多 16777216 像素');
  }
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || data.length !== width * height * 4) {
    throw new Error('renderFrame 必须返回 {width,height,data}，data 为完整 RGBA 字节数组');
  }
  return createHash('sha256').update(`${width}x${height}:`).update(data).digest('hex');
}

/** Cheap raster heuristics; an explicit subjectMask takes priority over the border-color proxy. */
export function measureComposition(frame, { subjectMask } = {}) {
  const { width, height, data } = frame ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || data.length !== width * height * 4) {
    throw new Error('构图分析需要完整 RGBA 帧');
  }
  const pixels = width * height, colors = new Map();
  let luminance = 0, visible = 0;
  for (let i = 0; i < pixels; i++) {
    const offset = i * 4;
    if (data[offset + 3] === 0) continue;
    visible++;
    luminance += 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
    const key = `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
    colors.set(key, (colors.get(key) ?? 0) + 1);
  }
  let dominantColorCount = 0;
  for (const count of colors.values()) dominantColorCount = Math.max(dominantColorCount, count);
  const dominantColorFraction = visible ? dominantColorCount / visible : 0;
  let subjectPixels = 0, subjectMethod = 'border-color proxy';
  if (subjectMask !== undefined) {
    if (!(subjectMask instanceof Uint8Array || subjectMask instanceof Uint8ClampedArray || Array.isArray(subjectMask)) || subjectMask.length !== pixels) throw new Error('subjectMask 长度须等于 width×height');
    for (let i = 0; i < pixels; i++) if (subjectMask[i]) subjectPixels++;
    subjectMethod = 'explicit subject mask';
  } else if (visible) {
    const border = new Map();
    const addBorder = i => {
      const o = i * 4; if (!data[o + 3]) return;
      const key = `${data[o]},${data[o + 1]},${data[o + 2]}`; border.set(key, (border.get(key) ?? 0) + 1);
    };
    for (let x = 0; x < width; x++) { addBorder(x); addBorder((height - 1) * width + x); }
    for (let y = 1; y < height - 1; y++) { addBorder(y * width); addBorder(y * width + width - 1); }
    const background = [...border].sort((a, b) => b[1] - a[1])[0]?.[0];
    const backgroundRgb = background?.split(',').map(Number);
    for (let i = 0; i < pixels; i++) {
      const o = i * 4;
      if (data[o + 3] && (data[o] !== backgroundRgb?.[0] || data[o + 1] !== backgroundRgb?.[1] || data[o + 2] !== backgroundRgb?.[2])) subjectPixels++;
    }
  }
  const subjectFraction = visible ? subjectPixels / visible : 0, meanLuminance = visible ? luminance / visible : 0;
  const warnings = [];
  if (subjectFraction < 0.005) warnings.push(`主体像素估算占比 ${(subjectFraction * 100).toFixed(3)}% 低于 0.5%（${subjectMethod}）`);
  if (meanLuminance < 30) warnings.push(`整帧平均亮度 ${meanLuminance.toFixed(1)} 低于 30/255`);
  if (dominantColorFraction > 0.6) warnings.push(`单一颜色占比 ${(dominantColorFraction * 100).toFixed(1)}% 高于 60%`);
  return { subjectFraction, subjectMethod, meanLuminance, dominantColorFraction, warnings };
}

function shuffled(values) {
  const copy = [...values];
  let seed = 0x6c797269;
  for (let i = copy.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function preserveCleanupError(error, cleanupError) {
  // 保留原始异常身份；冻结异常或非对象异常无法附加字段时，仍报告清理失败。
  try {
    Object.defineProperty(error, 'cleanupError', { value: cleanupError, configurable: true });
  } catch {
    console.error(`资源清理失败：${cleanupError?.message ?? String(cleanupError)}`);
  }
}

export async function runDeterminismQA(renderFrame, { times, frameOptions = {}, warmupFrames = 0, teardown, onWarning, subjectMaskAt } = {}) {
  if (teardown !== undefined && typeof teardown !== 'function') throw new Error('teardown 必须为函数');
  let failed = false;
  let operationError;
  try {
    if (typeof renderFrame !== 'function') throw new Error('模块必须导出 renderFrame(t, options)');
    if (!Array.isArray(times) || !times.length || times.length > 10000 || times.some(t => !Number.isFinite(t) || t < 0)) {
      throw new Error('检查时间必须为 1–10000 个非负有限数');
    }
    if (![0, 2, 3].includes(warmupFrames)) throw new Error('warmupFrames 必须为 0、2 或 3；0 为禁用预热');
    if (onWarning !== undefined && typeof onWarning !== 'function') throw new Error('onWarning 必须为函数');
    const ordered = [...new Set(times)].sort((a, b) => a - b);
    const baseline = new Map();
    const failures = [];
    const warmupHashes = new Map();
    const warnings = [];
    const compositionByTime = new Map();
    let renderCount = 0;
    const renderHash = async (time, captureComposition = false) => {
      // 预热与正式检查使用同一 profile，立即哈希以兼容复用缓冲。
      const frame = await renderFrame(time, frameOptions);
      const hash = frameHash(frame);
      if (!warnings.length && frame.width * frame.height > 1e6) {
        const warning = `RGBA帧为${frame.width}×${frame.height}，每帧${frame.data.length}字节；大量浏览器传输可能耗尽资源。优先检查低分辨率世界层，再单独检查正式分辨率的字幕/合成层；缩小尺寸的QA不能证明正式尺寸一致。`;
        warnings.push(warning); onWarning?.(warning);
      }
      if (captureComposition && frame.width * frame.height >= 4096 && frame.width * frame.height <= 1e6) {
        const mask = subjectMaskAt ? await subjectMaskAt(time, frame, frameOptions) : frame.subjectMask;
        const composition = measureComposition(frame, { subjectMask: mask });
        compositionByTime.set(time, composition);
        for (const warning of composition.warnings) {
          const full = `构图提示 t=${time.toFixed(3)}s：${warning}`;
          if (!warnings.includes(full)) { warnings.push(full); onWarning?.(full); }
        }
      }
      renderCount++;
      return hash;
    };
    for (const time of ordered) {
      if (!warmupFrames) break;
      const hashes = [];
      for (let i = 0; i < warmupFrames; i++) hashes.push(await renderHash(time));
      warmupHashes.set(time, hashes);
    }
    const warmupRenderCount = renderCount;
    const orders = [
      ['forward', ordered], ['repeat', ordered],
      ['reverse', [...ordered].reverse()], ['random', shuffled(ordered)]
    ];
    for (const [order, sequence] of orders) {
      for (const time of sequence) {
        const actualHash = await renderHash(time, order === 'forward');
        if (order === 'forward') baseline.set(time, actualHash);
        else if (baseline.get(time) !== actualHash) failures.push({ time, order, expectedHash: baseline.get(time), actualHash });
      }
    }
    const failedTimes = new Set(failures.map(failure => failure.time));
    const warmupMismatch = [...warmupHashes].filter(([time, hashes]) => new Set([...hashes, baseline.get(time)]).size > 1)
      .map(([time, hashes]) => ({ time, hashes, baselineHash: baseline.get(time), stabilized: !failedTimes.has(time) }));
    return {
      schemaVersion: 1, status: failures.length ? 'fail' : 'pass',
      testedFrameCount: ordered.length, renderCount,
      formalRenderCount: renderCount - warmupRenderCount,
      warmupFrames, warmupRenderCount,
      warmupStatus: !warmupFrames ? 'disabled' : warmupMismatch.length ? 'mismatch' : 'stable',
      warmupMismatch, renderProfile: frameOptions,
      orders: orders.map(([name]) => name),
      frames: ordered.map(time => ({ time, sha256: baseline.get(time), ...(compositionByTime.has(time) ? { composition: compositionByTime.get(time) } : {}) })),
      failures, warnings,
      limitation: '仅证明所抽样时间在本次渲染环境中的像素一致性；预热差异单独记录，不证明歌词对齐、授权或成片观感。'
    };
  } catch (error) {
    failed = true;
    operationError = error;
    throw error;
  } finally {
    try { await teardown?.(); }
    catch (cleanupError) {
      if (failed) preserveCleanupError(operationError, cleanupError);
      else throw cleanupError;
    }
  }
}

async function main(args) {
  if (args[0] === '--review-index') {
    const [, storyboard, outFlag, output, ...extra] = args;
    if (!storyboard || outFlag !== '--out' || !output || extra.length) throw new Error('用法：node qa.mjs --review-index storyboard.json --out review-index.json');
    assertNoPathAliases({ inputs: [storyboard], outputs: [output] });
    const raw = await readFile(resolve(storyboard));
    const report = buildShotReviewIndex(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')));
    report.storyboardSha256 = createHash('sha256').update(raw).digest('hex');
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n');
    console.log('已生成 ' + report.scenes.length + ' 镜审片索引：' + output);
    return;
  }
  if (args.includes('--help')) {
    console.log('用法：node qa.mjs <frame.mjs> --duration 12 --fps 30 [--samples 16] [--storyboard file.json] [--times 0,5.1,6] [--warmup-frames 3] [--out qa.json]\n审片索引：node qa.mjs --review-index storyboard.json --out review-index.json\n预热：每个时间点连续渲染 2 或 3 帧；默认 3，设为 0 禁用。模块可导出 async cleanup() 释放资源、frameOptionsForStoryboard(data) 应用分镜渲染配置。');
    return;
  }
  const modulePath = args.shift();
  if (!modulePath || modulePath.startsWith('--')) throw new Error('缺少渲染模块路径，使用 --help 查看用法');
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--duration', '--fps', '--samples', '--storyboard', '--times', '--warmup-frames', '--out'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error(`未知参数或缺少值：${key}`);
    }
    if (Object.hasOwn(opts, key)) throw new Error(`重复参数：${key}`);
    opts[key] = args[i + 1];
  }
  assertNoPathAliases({
    inputs: [modulePath, opts['--storyboard']].filter(Boolean),
    outputs: [opts['--out']].filter(Boolean),
  });
  const module = await import(pathToFileURL(resolve(modulePath)).href);
  let failed = false;
  let operationError;
  try {
    const storyboard = opts['--storyboard'] ? JSON.parse(await readFile(resolve(opts['--storyboard']), 'utf8')) : null;
    const duration = Number(opts['--duration'] ?? storyboard?.project?.duration ?? module.DURATION);
    const fps = Number(opts['--fps'] ?? storyboard?.project?.fps ?? module.FPS ?? 30);
    positive(duration, 'duration');
    positive(fps, 'fps');
    const times = opts['--times'] ? opts['--times'].split(',').map(value => {
      if (!value.trim()) throw new Error('时间列表含空值');
      return Number(value);
    }) : collectSampleTimes({ duration, fps, samples: Number(opts['--samples'] ?? 16), scenes: storyboard?.scenes ?? module.SCENES ?? [], music: storyboard?.music ?? module.MUSIC ?? {} });
    if (times.some(t => t >= duration)) throw new Error('检查时间必须位于 [0,duration)');
    const frameOptions = storyboard && module.frameOptionsForStoryboard ? await module.frameOptionsForStoryboard(storyboard) : {};
    // CLI 在整个操作结束后清理；不把 cleanup 再传给 runDeterminismQA。
    const report = await runDeterminismQA(module.renderFrame, { times, frameOptions, warmupFrames: Number(opts['--warmup-frames'] ?? 3), subjectMaskAt: module.subjectMaskAt, onWarning: warning => console.error(`资源提示：${warning}`) });
    report.module = resolve(modulePath);
    report.duration = duration;
    report.fps = fps;
    if (opts['--out']) {
      const output = resolve(opts['--out']);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    }
    console.log(`确定性检查 ${report.status}：${report.testedFrameCount} 个时间点，${report.renderCount} 次渲染（预热 ${report.warmupRenderCount} 次），${report.failures.length} 处正式不一致`);
    if (report.warmupMismatch.length) {
      console.error(`预热差异：${report.warmupMismatch.length} 个时间点；stabilized=true 仅表示后续四种顺序一致，请固定光栅路径并检查字体和资源初始化。`);
      console.error(JSON.stringify(report.warmupMismatch, null, 2));
    }
    if (report.failures.length) {
      console.error(JSON.stringify(report.failures, null, 2));
      process.exitCode = 1;
    }
  } catch (error) {
    failed = true;
    operationError = error;
    throw error;
  } finally {
    try { await module.cleanup?.(); }
    catch (cleanupError) {
      if (failed) preserveCleanupError(operationError, cleanupError);
      else throw new Error(`资源清理失败：${cleanupError?.message ?? String(cleanupError)}`, { cause: cleanupError });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`确定性检查失败：${error?.message ?? String(error)}`);
    if (error != null && Object.hasOwn(Object(error), 'cleanupError')) console.error(`资源清理失败：${error.cleanupError?.message ?? String(error.cleanupError)}`);
    process.exitCode = 1;
  });
}
