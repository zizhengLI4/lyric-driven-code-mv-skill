// 共享纯帧模块：无 DOM、无计时器、无文件读写、无累积动画状态。
import { createTimeline } from './timeline.mjs';
export const WIDTH = 384;
export const HEIGHT = 216;
export const DURATION = 12;
export const DEFAULT_SEED = 'paper-boat-original-v1';
export const CAMERA_LIMITS = Object.freeze({ minX: 120, maxX: 264, minY: 70, maxY: 146, minZoom: 0.75, maxZoom: 1.25 });

export const SCENES = Object.freeze([
  Object.freeze({ id: 'send', start: 0, end: 6,
    objective: '把小灯送到对岸', action: '左岸人物将载灯纸船推入水流', feedback: '纸船经过弯流继续前进', outcome: '纸船到达河心',
    exit: Object.freeze({ type: 'ripple', dur: 0.9, origin: Object.freeze([0.55, 0.62]) }) }),
  Object.freeze({ id: 'receive', start: 6, end: 12,
    objective: '等纸船抵达并回应左岸', action: '右岸人物伸手未接到纸船，转为点亮岸灯', feedback: '弯流把纸船推回河心，右岸以灯回应', outcome: '纸船仍未抵达，两岸灯光隔水相望',
    repeatDelta: '同一句再次出现时，新增目标受阻与隔岸回应；船未抵达，人物仍建立联系',
    exit: Object.freeze({ type: 'cut', dur: 0, origin: Object.freeze([0.55, 0.62]) }) }),
]);

export const CAPTIONS = Object.freeze([
  { start: 0.45, end: 2.8, zh: '送一盏小灯到对岸', en: 'Send a small light across.' },
  { start: 3.0, end: 5.0, zh: '水流拐弯，我松开手', en: 'The current turns; I let it go.' },
  { start: 6.3, end: 8.5, zh: '送一盏小灯到对岸', en: 'Send a small light across.' },
  { start: 8.7, end: 11.7, zh: '未能抵达，也有回光', en: 'Still apart, our lights reply.' },
]);

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const ease = n => { n = clamp(n, 0, 1); return n * n * (3 - 2 * n); };
const mix = (a, b, n) => a + (b - a) * n;

// 每一个随机量只取决于 seed 与显式索引，乱序 seek 不会消耗共享 PRNG。
export function seeded(seed, index) {
  const text = `${seed}:${index}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const palette = Object.freeze({ sky: [19, 30, 51], deep: [20, 42, 65], water: [29, 67, 86], bank: [42, 61, 63], grass: [68, 88, 77], skin: [222, 171, 133], coatA: [184, 96, 88], coatB: [92, 160, 166], ink: [31, 36, 48], paper: [229, 224, 200], light: [255, 206, 110], bright: [255, 239, 170] });
const coordinate = n => { if (!Number.isFinite(n) || Math.abs(n) > 1000000) throw new Error('图元坐标或半径须有限，绝对值不超过1000000'); return n; };

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
  X(x) { return Math.round((coordinate(x) - this.cam.x) * this.cam.zoom * this.width / WIDTH + this.width / 2); }
  Y(y) { return Math.round((coordinate(y) - this.cam.y) * this.cam.zoom * this.height / HEIGHT + this.height / 2); }
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
    coordinate(radius); if (radius < 0) throw new Error('图元半径不能为负数');
    const cx = this.X(x), cy = this.Y(y), rx = Math.max(1, Math.round(radius * this.cam.zoom * this.width / WIDTH)), ry = Math.max(1, Math.round(radius * this.cam.zoom * this.height / HEIGHT));
    const left = Math.max(0, cx - rx), right = Math.min(this.width - 1, cx + rx), top = Math.max(0, cy - ry), bottom = Math.min(this.height - 1, cy + ry);
    for (let py = top; py <= bottom; py++) for (let px = left; px <= right; px++) if ((px - cx) ** 2 / (rx * rx) + (py - cy) ** 2 / (ry * ry) <= 1) this.put(px, py, color);
  }
  /**
   * 画一个由外向内的像素光晕。它只负责铺底层，主体应在 glow 返回后绘制。
   * color 可为 RGB 或 RGBA；alpha 用于把亮度压低而不改变确定性。
   */
  glow(x, y, radius, color, { steps = 4, alpha = 1 } = {}) {
    coordinate(radius);
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

function world(fb, t, seed, response = 0) {
  // 先实际画满有留边的世界，初始 FB 透明；测试可发现留边不足。
  fb.rect(-192, -108, 768, 432, palette.sky);
  fb.circle(306, 35, 14, [223, 217, 177]); fb.circle(311, 31, 12, palette.sky);
  for (let i = 0; i < 96; i++) {
    const x = -170 + seeded(seed, i * 3) * 720, y = -82 + seeded(seed, i * 3 + 1) * 170;
    fb.rect(x, y, 1 + (i % 13 === 0), 1, [111 + Math.round(40 * Math.sin(t * 1.4 + i)), 136, 155]);
  }
  fb.poly([[-192, 112], [40, 96], [150, 116], [255, 109], [370, 82], [576, 92], [576, 324], [-192, 324]], palette.water);
  for (let i = 0; i < 75; i++) {
    const x = -165 + seeded(seed, 900 + i * 2) * 730, y = 120 + seeded(seed, 901 + i * 2) * 190;
    fb.rect(x + Math.sin(t * 1.3 + i) * 3, y, 4 + seeded(seed, 1400 + i) * 13, 1, i % 4 ? [43, 87, 102] : [72, 112, 119]);
  }
  fb.poly([[-192, 126], [67, 118], [114, 139], [133, 190], [151, 324], [-192, 324]], palette.bank);
  fb.poly([[285, 165], [302, 127], [342, 101], [576, 99], [576, 324], [274, 324]], palette.bank);
  fb.line(-130, 126, 67, 118, palette.grass); fb.line(67, 118, 114, 139, palette.grass);
  fb.line(302, 127, 342, 101, palette.grass); fb.line(342, 101, 550, 100, palette.grass);
  for (const [x, y, flip] of [[55, 112, 1], [332, 103, -1], [-50, 114, 1], [470, 98, -1]]) {
    fb.rect(x, y - 32, 3, 34, [47, 56, 65]);
    fb.line(x + 1, y - 22, x + flip * 11, y - 34, [47, 56, 65]);
    fb.poly([[x - 15, y - 23], [x + 2, y - 51], [x + 20, y - 26]], [48, 67, 69]);
  }
  lamp(fb, 74, 110, 1);
  lamp(fb, 311, 132, response);
  if (response > 0) {
    for (let i = 0; i < 18; i++) {
      const x = mix(83, 310, i / 17), y = 168 + Math.sin(i * 0.63) * 8;
      if (i / 18 < response) fb.rect(x, y, 3 + i % 3, 1, [144, 139, 92]);
    }
  }
}

function lamp(fb, x, y, lit) {
  fb.rect(x, y - 6, 2, 23, palette.ink);
  if (lit > 0.05) fb.circle(x + 1, y - 5, 8, [85, 80, 65]);
  fb.rect(x - 3, y - 9, 8, 9, lit > 0.5 ? palette.light : [89, 92, 92]);
  fb.rect(x - 4, y - 11, 10, 2, palette.ink);
  if (lit > 0.5) fb.rect(x - 2, y - 7, 2, 4, palette.bright);
}

function person(fb, x, y, coat, reach, direction = 1) {
  fb.rect(x - 4, y - 28, 8, 8, palette.skin); fb.rect(x - 5, y - 31, 10, 4, palette.ink);
  fb.rect(x - 5, y - 20, 10, 14, coat);
  fb.rect(x - 5, y - 6, 3, 6, palette.ink); fb.rect(x + 2, y - 6, 3, 6, palette.ink);
  fb.line(x + direction * 4, y - 15, x + direction * (7 + reach * 11), y - 11 + reach * 6, palette.skin);
  fb.line(x + direction * 4, y - 14, x + direction * (7 + reach * 11), y - 10 + reach * 6, palette.skin);
}

function boat(fb, x, y, t) {
  y += Math.sin(t * 3) * 1.4;
  fb.circle(x, y - 5, 7, [94, 97, 75]);
  fb.poly([[x - 12, y], [x + 12, y], [x + 7, y + 5], [x - 6, y + 5]], palette.paper);
  fb.poly([[x - 7, y - 1], [x + 1, y - 11], [x + 1, y - 1]], [242, 237, 211]);
  fb.line(x + 1, y - 10, x + 1, y + 3, [137, 149, 142]);
  fb.rect(x + 3, y - 8, 3, 7, palette.light); fb.pixel(x + 4, y - 9, palette.bright);
  fb.rect(x - 6, y + 9, 14, 1, [136, 137, 92]);
}

export function renderScene(index, local, options = {}) {
  const { width = WIDTH, height = HEIGHT, seed = DEFAULT_SEED, camera } = options;
  if (index !== 0 && index !== 1) throw new Error('未知镜头');
  if (!Number.isFinite(local)) throw new Error('镜头 local 必须为有限秒数');
  const t = clamp(local, 0, 6), fb = new FB(width, height);
  const cam = camera ?? (index === 0 ? { x: 181 + ease(t / 6) * 10, y: 108, zoom: 1 } : { x: 203 + ease(t / 6) * 4, y: 112, zoom: 1.04 });
  if (![cam.x, cam.y, cam.zoom].every(Number.isFinite) || cam.x < CAMERA_LIMITS.minX || cam.x > CAMERA_LIMITS.maxX || cam.y < CAMERA_LIMITS.minY || cam.y > CAMERA_LIMITS.maxY || cam.zoom < CAMERA_LIMITS.minZoom || cam.zoom > CAMERA_LIMITS.maxZoom) throw new Error('摄像机超出模板范围：x=120–264，y=70–146，zoom=0.75–1.25');
  fb.setCam(cam.x, cam.y, cam.zoom);
  const response = index === 1 ? ease((t - 3.4) / 1.2) : 0;
  world(fb, t + index * 6, seed, response);
  if (index === 0) {
    const travel = ease((t - 1.3) / 4.7), reach = 1 - ease((t - 1.3) / 1.2);
    person(fb, 92, 137, palette.coatA, reach);
    person(fb, 308, 171, palette.coatB, 0, -1);
    boat(fb, mix(109, 226, travel), 147 + Math.sin(travel * Math.PI) * 13, t);
  } else {
    person(fb, 92, 137, palette.coatA, ease((t - 4.5) / 0.8));
    const receive = ease(t / 3.3), reach = ease((t - 2.3) / 0.8) * (1 - ease((t - 3.5) / 0.6));
    person(fb, 308, 171, palette.coatB, reach, -1);
    // 纸船始终停在右岸之外；到达之前被弯流推回，不用“接住”镜头偷换结果。
    const setback = ease((t - 3.1) / 1.8);
    boat(fb, mix(226, 259, receive) - setback * 15, mix(147, 160, receive), t + 6);
    if (t >= 3.8) { fb.rect(304, 152, 3, 5, palette.light); fb.pixel(305, 151, palette.bright); }
    if (response > 0.4) {
      // 受阻后的回应：自有岸灯亮起，纸船留河心而两岸产生联系。
      const radius = 6 + (t - 3.4) * 8;
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; fb.rect(312 + Math.cos(a) * radius, 128 + Math.sin(a) * radius, 2, 2, palette.light); }
    }
  }
  return fb.frame();
}

export function resolveTimeline(time, timeline = { duration: DURATION, scenes: SCENES }) {
  if (!Number.isFinite(time)) throw new Error('时间 t 必须为有限秒数');
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

export function blendFrames(previous, next, progress, exit = SCENES[0].exit) {
  if (previous.width !== next.width || previous.height !== next.height || previous.data.length !== next.data.length) throw new Error('转场帧尺寸不一致');
  if (!Number.isFinite(progress)) throw new Error('转场进度必须有限');
  if (!['dissolve', 'ripple', 'water', 'cut'].includes(exit.type)) throw new Error('未知转场类型');
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
    const i = (y * width + x) * 4;
    for (let c = 0; c < 4; c++) data[i + c] = Math.round(mix(previous.data[i + c], next.data[i + c], a));
  }
  return { width, height, data };
}

/** drawScene 接口供已有工程适配；返回同尺寸 RGBA，不改变现有框架。 */
export function renderTimelineFrame(time, drawScene = renderScene, options = {}) {
  const state = resolveTimeline(time, options.timeline), current = drawScene(state.index, state.local, options);
  if (state.nextIndex === null) return current;
  const next = drawScene(state.nextIndex, 0, options);
  return blendFrames(current, next, state.progress, state.exit);
}

// 分镜负责时窗，画法只注册在这里。新增scene.id时实现自己的纯帧函数。
export const SCENE_RENDERERS = Object.freeze({ send: (local, options) => renderScene(0, local, options), receive: (local, options) => renderScene(1, local, options) });
export function frameOptionsForStoryboard(data) { return { seed: data.project.seed, timeline: createTimeline(data, Object.keys(SCENE_RENDERERS)) }; }
export function renderFrame(t, options = {}) {
  if (!options.timeline) return renderTimelineFrame(t, renderScene, options);
  const draw = (index, local, opts) => {
    const scene = opts.timeline.scenes[index], renderer = SCENE_RENDERERS[scene.id];
    if (!renderer) throw new Error(`镜头${scene.id}没有注册画法`);
    // 两个内置演出以6秒为设计时长；实际镜头窗口由JSON决定。
    return renderer(local * 6 / (scene.end - scene.start), opts);
  };
  return renderTimelineFrame(t, draw, options);
}
