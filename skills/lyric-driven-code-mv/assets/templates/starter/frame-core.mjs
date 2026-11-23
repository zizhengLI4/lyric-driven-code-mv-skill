// 唯一渲染核心：虚拟分辨率常量、确定性噪声、纯帧缓冲 FB、时间线与转场。
// 无 DOM、无计时器、无文件读写、无累积动画状态；同一 (time, seed) 永远得到同一帧。
// starter 模板与 12 个场景资产都只从这一份实现取引擎能力，任何一侧都不再自带副本。

export const WIDTH = 384;
export const HEIGHT = 216;
export const DEFAULT_SEED = 'pixel-render-check-v1';

export const CAMERA_LIMITS = Object.freeze({ minX: 120, maxX: 264, minY: 70, maxY: 146, minZoom: 0.75, maxZoom: 1.25 });
export const TRANSITION_TYPES = Object.freeze(['dissolve', 'ripple', 'water', 'rain', 'cut']);

export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const ease = n => { n = clamp(n, 0, 1); return n * n * (3 - 2 * n); };
export const mix = (a, b, n) => a + (b - a) * n;
export const seg = (t, start, dur) => ease((t - start) / dur);
export const back = (t, start, dur) => 1 - ease((t - start) / dur);

// 每一个随机量只取决于 seed 与显式索引，乱序 seek 不会消耗共享 PRNG。
export function seeded(seed, index) {
  const text = String(seed) + ':' + index;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return ((hash >>> 0) % 100000) / 100000;
}

/** 世界坐标统一经过 X/Y；仅在写像素时取整。留边世界为 [-192,576]×[-108,324]。 */
export class FB {
  constructor(width = WIDTH, height = HEIGHT) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('帧尺寸必须为 1–4096 的整数');
    this.width = width; this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    this.setCam();
  }
  setCam(x = 192, y = 108, zoom = 1) {
    if (![x, y, zoom].every(Number.isFinite) || Math.abs(x) > 1000000 || Math.abs(y) > 1000000 || zoom < 0.01 || zoom > 64) throw new Error('摄像机坐标须有限，绝对值≤1000000，zoom 须在0.01–64之间');
    this.cam = { x, y, zoom }; return this;
  }
  X(x) { return Math.round((this.guard(x) - this.cam.x) * this.cam.zoom * this.width / WIDTH + this.width / 2); }
  Y(y) { return Math.round((this.guard(y) - this.cam.y) * this.cam.zoom * this.height / HEIGHT + this.height / 2); }
  guard(n) { if (!Number.isFinite(n) || Math.abs(n) > 1000000) throw new Error('图元坐标须有限，绝对值不超过1000000'); return n; }
  put(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = color[0]; this.data[i + 1] = color[1]; this.data[i + 2] = color[2]; this.data[i + 3] = color[3] ?? 255;
  }
  pixel(x, y, color) { this.put(this.X(x), this.Y(y), color); }
  rect(x, y, width, height, color) {
    const left = Math.max(0, this.X(x)), right = Math.min(this.width, this.X(x + width));
    const top = Math.max(0, this.Y(y)), bottom = Math.min(this.height, this.Y(y + height));
    for (let py = top; py < bottom; py++) for (let px = left; px < right; px++) this.put(px, py, color);
  }
  line(x0, y0, x1, y1, color) {
    let x = this.X(x0), y = this.Y(y0), tx = this.X(x1), ty = this.Y(y1);
    // Liang–Barsky 先裁剪，Bresenham 最多遍历视口长边，不遍历遥远世界坐标。
    const vx = tx - x, vy = ty - y, bounds = [[-vx, x], [vx, this.width - 1 - x], [-vy, y], [vy, this.height - 1 - y]];
    let enter = 0, leave = 1;
    for (const [p, q] of bounds) {
      if (p === 0) { if (q < 0) return; continue; }
      const ratio = q / p; if (p < 0) enter = Math.max(enter, ratio); else leave = Math.min(leave, ratio);
      if (enter > leave) return;
    }
    tx = clamp(Math.round(x + vx * leave), 0, this.width - 1); ty = clamp(Math.round(y + vy * leave), 0, this.height - 1);
    x = clamp(Math.round(x + vx * enter), 0, this.width - 1); y = clamp(Math.round(y + vy * enter), 0, this.height - 1);
    const dx = Math.abs(tx - x), dy = -Math.abs(ty - y), sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
    let err = dx + dy;
    for (;;) { this.put(x, y, color); if (x === tx && y === ty) break; const e = err * 2; if (e >= dy) { err += dy; x += sx; } if (e <= dx) { err += dx; y += sy; } }
  }
  circle(x, y, radius, color) {
    this.guard(radius); if (radius < 0) throw new Error('图元半径不能为负数');
    const cx = this.X(x), cy = this.Y(y);
    const rx = Math.max(1, Math.round(radius * this.cam.zoom * this.width / WIDTH));
    const ry = Math.max(1, Math.round(radius * this.cam.zoom * this.height / HEIGHT));
    const left = Math.max(0, cx - rx), right = Math.min(this.width - 1, cx + rx), top = Math.max(0, cy - ry), bottom = Math.min(this.height - 1, cy + ry);
    for (let py = top; py <= bottom; py++) for (let px = left; px <= right; px++) if ((px - cx) ** 2 / (rx * rx) + (py - cy) ** 2 / (ry * ry) <= 1) this.put(px, py, color);
  }
  /**
   * 画一个由外向内的像素光晕。它只负责铺底层，主体应在 glow 返回后绘制。
   * color 可为 RGB 或 RGBA；alpha 用于把亮度压低而不改变确定性。
   */
  glow(x, y, radius, color, { steps = 4, alpha = 1 } = {}) {
    this.guard(radius);
    if (!Array.isArray(color) || color.length < 3 || !color.slice(0, 3).every(Number.isFinite)) throw new Error('glow 颜色必须为 RGB/RGBA 数组');
    if (!Number.isInteger(steps) || steps < 1 || steps > 32) throw new Error('glow steps 必须为 1–32 的整数');
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error('glow alpha 必须为 0–1');
    for (let i = steps; i >= 1; i--) {
      const k = i / steps;
      const fade = alpha * (1 - k * 0.72);
      this.circle(x, y, radius * k, [color[0] * fade, color[1] * fade, color[2] * fade, color[3] ?? 255]);
    }
    return this;
  }
  /**
   * 统一装饰层顺序：先执行 glow/underlay，再执行 subject/body/main。
   * 支持 layer({ glow, subject })，也支持 layer(glowFn, subjectFn)。
   */
  layer(spec, subject) {
    const glow = typeof spec === 'function' ? spec : spec?.glow ?? spec?.underlay;
    const body = typeof spec === 'function' ? subject : spec?.subject ?? spec?.body ?? spec?.main;
    if (glow !== undefined && typeof glow !== 'function') throw new Error('layer.glow 必须为函数');
    if (body !== undefined && typeof body !== 'function') throw new Error('layer.subject 必须为函数');
    glow?.(this);
    body?.(this);
    return this;
  }
  poly(points, color) {
    const p = points.map(([x, y]) => [this.X(x), this.Y(y)]);
    const top = Math.max(0, Math.min(...p.map(v => v[1]))), bottom = Math.min(this.height - 1, Math.max(...p.map(v => v[1])));
    for (let y = top; y <= bottom; y++) {
      const nodes = [];
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i], [xj, yj] = p[j];
        if ((yi <= y && yj > y) || (yj <= y && yi > y)) nodes.push(Math.round(xi + (y - yi) / (yj - yi) * (xj - xi)));
      }
      nodes.sort((a, b) => a - b);
      for (let i = 0; i + 1 < nodes.length; i += 2) for (let x = Math.max(0, nodes[i]); x <= Math.min(this.width - 1, nodes[i + 1]); x++) this.put(x, y, color);
    }
  }
  frame() { return { width: this.width, height: this.height, data: this.data }; }
}

const round2 = n => Math.round(n * 100) / 100;

/** 已夹取的摄像机提示只报一次，避免逐帧刷屏。 */
const clampWarnings = new Set();
export function resetCameraWarnings() { clampWarnings.clear(); }

/**
 * 收景愿望值可能落在模板范围外：静默夹取并提示一次，不打断渲染。
 * 返回 { camera, clamped }，clamped 便于调用方或测试断言发生了夹取。
 */
export function clampCamera(camera, label = 'camera') {
  const limits = CAMERA_LIMITS;
  const next = {
    x: clamp(camera.x, limits.minX, limits.maxX),
    y: clamp(camera.y, limits.minY, limits.maxY),
    zoom: clamp(camera.zoom, limits.minZoom, limits.maxZoom),
  };
  const clamped = next.x !== camera.x || next.y !== camera.y || next.zoom !== camera.zoom;
  if (clamped && !clampWarnings.has(label)) {
    clampWarnings.add(label);
    console.warn(`[frame-core] ${label} 的取景中心超出摄像机可用范围，已夹取：请求 x=${round2(camera.x)}, y=${round2(camera.y)}, zoom=${round2(camera.zoom)} → 实际 x=${round2(next.x)}, y=${round2(next.y)}, zoom=${round2(next.zoom)}；可用范围 x=${limits.minX}–${limits.maxX}, y=${limits.minY}–${limits.maxY}, zoom=${limits.minZoom}–${limits.maxZoom}`);
  }
  return { camera: next, clamped };
}

/** 显式传入的 camera 是硬契约：越界立即报错，不做静默修正。 */
export function assertCamera(camera) {
  const limits = CAMERA_LIMITS;
  if (!camera || ![camera.x, camera.y, camera.zoom].every(Number.isFinite) || camera.x < limits.minX || camera.x > limits.maxX || camera.y < limits.minY || camera.y > limits.maxY || camera.zoom < limits.minZoom || camera.zoom > limits.maxZoom) throw new Error('摄像机超出模板范围：x=120–264，y=70–146，zoom=0.75–1.25');
  return camera;
}

export function resolveTimeline(time, timeline) {
  if (!Number.isFinite(time)) throw new Error('时间 t 必须为有限秒数');
  if (!timeline || !Array.isArray(timeline.scenes) || !timeline.scenes.length) throw new Error('时间线缺少场景列表');
  const { duration, scenes } = timeline;
  const t = clamp(time, 0, duration);
  let index = scenes.findIndex(scene => t < scene.end);
  if (index < 0) index = scenes.length - 1;
  const scene = scenes[index];
  const result = { index, local: t - scene.start, nextIndex: null, nextLocal: null, progress: null, exit: scene.exit };
  const start = scene.end - scene.exit.dur;
  if (index + 1 < scenes.length && scene.exit.type !== 'cut' && scene.exit.dur > 0 && t >= start && t < scene.end) {
    result.nextIndex = index + 1; result.nextLocal = 0;
    result.progress = clamp((t - start) / scene.exit.dur, 0, 1);
  }
  return result;
}

export function blendFrames(previous, next, progress, exit = { type: 'dissolve' }) {
  if (previous.width !== next.width || previous.height !== next.height || previous.data.length !== next.data.length) throw new Error('转场帧尺寸不一致');
  if (!Number.isFinite(progress)) throw new Error('转场进度必须有限');
  if (!TRANSITION_TYPES.includes(exit?.type)) throw new Error('未知转场类型');
  const p = clamp(progress, 0, 1);
  if (p === 0 || (exit.type === 'cut' && p < 1)) return previous;
  if (p === 1) return next;
  const { width, height } = previous, data = new Uint8ClampedArray(previous.data.length), origin = exit.origin ?? [0.5, 0.5];
  const far = Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => Math.hypot(x - origin[0], y - origin[1])));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const nx = x / Math.max(1, width - 1), ny = y / Math.max(1, height - 1);
    let a = ease(p);
    // 波幅在两端归零，额外覆盖余量让最远边缘在 end 前完成混合。
    if (exit.type === 'ripple') { const r = Math.hypot(nx - origin[0], ny - origin[1]) / far; a = ease((p * 1.16 - r - 0.08 + Math.sin(r * 28 - p * 12) * Math.sin(Math.PI * p) * 0.02) / 0.08); }
    if (exit.type === 'water') a = ease((p * 1.16 - ny - 0.08 + Math.sin(nx * 22 + p * 8) * Math.sin(Math.PI * p) * 0.035) / 0.08);
    if (exit.type === 'rain') a = ease((p * 1.2 - ny * 0.6 - 0.05 + Math.sin(nx * 34 + p * 10) * Math.sin(Math.PI * p) * 0.05) / 0.1);
    const i = (y * width + x) * 4;
    for (let c = 0; c < 4; c++) data[i + c] = Math.round(mix(previous.data[i + c], next.data[i + c], a));
  }
  return { width, height, data };
}

/** drawScene(index, local, options) 由调用方提供，返回同尺寸 RGBA 帧。 */
export function renderTimelineFrame(time, drawScene, options = {}) {
  if (typeof drawScene !== 'function') throw new Error('renderTimelineFrame 需要 drawScene(index, local, options)');
  const state = resolveTimeline(time, options.timeline);
  const current = drawScene(state.index, state.local, options);
  if (state.nextIndex === null) return current;
  const next = drawScene(state.nextIndex, 0, options);
  return blendFrames(current, next, state.progress, state.exit);
}

/**
 * 分镜 → 渲染选项。默认只映射 id/时窗/exit（不依赖任何场景注册表）；
 * 传入 buildTimeline 时交给它做完整校验与字幕推导（starter 用它接 timeline.mjs）。
 */
export function frameOptionsForStoryboard(data, buildTimeline) {
  const timeline = typeof buildTimeline === 'function'
    ? buildTimeline(data)
    : {
      duration: data.project.duration,
      scenes: data.scenes.map(scene => ({ start: scene.start, end: scene.end, id: scene.id, exit: scene.exit ?? { type: 'dissolve', dur: 0.8 } })),
    };
  return { seed: data.project.seed, timeline };
}
