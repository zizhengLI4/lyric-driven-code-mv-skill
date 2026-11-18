// 场景层共用件：调色板词表、像素画原语、以及把「画法 + 出厂参数」包成资产工厂。
// 这里不再持有任何模块级可变状态：调色板由工厂闭包持有，并显式传给每个画法函数。
import { FB, WIDTH, HEIGHT, clamp, ease, seeded, clampCamera, assertCamera } from '../frame-core.mjs';

export { seeded };

/** 12 个画法共用的颜色词表；palette 覆盖只能使用这里已有的键。 */
export const SCENE_PALETTE = Object.freeze({
  void: [10, 13, 22], night: [15, 20, 33], deep: [20, 27, 44], city: [27, 34, 52], cityLit: [46, 56, 80],
  wall: [38, 44, 58], wallDark: [28, 33, 45], floor: [24, 28, 38],
  warm: [255, 206, 130], bright: [255, 239, 190], amber: [238, 160, 86], ember: [186, 104, 66],
  skin: [222, 171, 133], ink: [16, 20, 30], coal: [28, 34, 46],
  coat: [66, 82, 112], coat2: [124, 78, 96], coat3: [92, 110, 132],
  rain: [126, 156, 178], glass: [86, 118, 140],
  neon: [255, 86, 132], neonCool: [116, 232, 246], gold: [255, 202, 108],
  paper: [226, 220, 198], chalk: [214, 218, 206], dust: [116, 126, 148],
  dawnLow: [252, 168, 92], dawnHigh: [255, 226, 168], soil: [96, 76, 62], soilLit: [128, 102, 80],
});

export const DEFAULT_SCENE_SEED = 'special-kotzen-90';

/** 铺满带留边的世界（[-192,576]×[-108,324]），初始 FB 不会留下透明边。 */
export function fill(fb, color) { fb.rect(-192, -108, 768, 432, color); }

/** 星点：固定种子，轻微呼吸。 */
export function stars(fb, seed, t, count = 70, tint = [150, 168, 196]) {
  for (let i = 0; i < count; i++) {
    const x = -170 + seeded(seed, i * 3) * 730;
    const y = -80 + seeded(seed, i * 3 + 1) * 150;
    const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.9 + i));
    fb.rect(x, y, 1, 1, [tint[0] * twinkle, tint[1] * twinkle, tint[2] * twinkle]);
  }
}

/** 城市剪影：宽高抖动，窗格随机点亮。 */
export function skyline(fb, seed, baseY, color, lit, from = -180, to = 560) {
  let x = from;
  let i = 0;
  while (x < to) {
    const w = 10 + Math.round(seeded(seed, i * 5) * 22);
    const h = 18 + Math.round(seeded(seed, i * 5 + 1) * 58);
    fb.rect(x, baseY - h, w, h + 60, color);
    if (lit > 0) {
      for (let wy = baseY - h + 3; wy < baseY - 2; wy += 5) {
        for (let wx = x + 2; wx < x + w - 2; wx += 4) {
          if (seeded(seed, i * 97 + wy * 3 + wx) > 0.52) fb.rect(wx, wy, 1, 1, [lit * 0.9, lit * 0.78, lit * 0.5]);
        }
      }
    }
    x += w + 2 + Math.round(seeded(seed, i * 5 + 2) * 3);
    i++;
  }
}

/** 站立的人影：极简 8×28，可转身、可抬手。颜色全部取自传入的 palette。 */
export function figure(fb, x, y, coat, palette, { head = palette.skin, arm = 0, dir = 1, back = false, scale = 1 } = {}) {
  const h = 28 * scale, w = 8 * scale;
  fb.rect(x - w / 2, y - h, w, w, head);
  if (!back) { fb.rect(x - w / 2 - 1, y - h - 1, w + 2, 3, palette.ink); }
  fb.rect(x - w / 2 - 1, y - h + w + 1, w + 2, h - w - 6, coat);
  fb.rect(x - w / 2 - 1, y - 7 * scale, 3 * scale, 7 * scale, palette.ink);
  fb.rect(x + w / 2 - 2 * scale, y - 7 * scale, 3 * scale, 7 * scale, palette.ink);
  if (arm > 0) fb.line(x + dir * w / 2, y - h + w + 4, x + dir * (w / 2 + 10 * arm), y - h + w + 2 - 4 * arm, head);
}

/** 雨丝：只画视口内的短斜线。 */
export function rain(fb, seed, t, palette, density = 90, alpha = 1) {
  for (let i = 0; i < density; i++) {
    const x = -40 + seeded(seed, i * 3) * 470;
    const cycle = 42;
    const y = ((seeded(seed, i * 3 + 1) * cycle + t * 96) % cycle) + 10;
    fb.line(x, y, x - 2, y + 7, [palette.rain[0] * alpha, palette.rain[1] * alpha, palette.rain[2] * alpha]);
  }
}

/** 推轨基线：每个场景只声明自己的偏置，不再按 SCENE_IDS 下标查表。 */
export function trackingCamera(seconds, bias = { x: 0, y: 0, zoom: 0 }) {
  const drift = ease(clamp(seconds, 0, 6) / 6);
  return { x: 188 + drift * 8 + (bias.x ?? 0), y: 106 + drift * 4 + (bias.y ?? 0), zoom: 1 + drift * 0.05 + (bias.zoom ?? 0) };
}

/**
 * 渲染一帧场景。subject 为「取景中心」愿望值：由它反推摄像机后夹取到 CAMERA_LIMITS，
 * 越界只提示一次，不抛错；显式传入 camera 时仍按硬契约校验。
 */
export function sceneFrame(draw, { palette, cameraBias, duration = 6, subject = null, label = 'scene' }, local, options = {}) {
  if (typeof draw !== 'function') throw new Error('场景缺少画法函数 draw(fb, t, seed, palette)');
  if (!Number.isFinite(local)) throw new Error('镜头 local 必须为有限秒数');
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('场景 duration 必须为正有限数');
  const { width = WIDTH, height = HEIGHT, seed = DEFAULT_SCENE_SEED, camera } = options;
  const seconds = clamp(local, 0, duration) * 6 / duration;
  const t = clamp(seconds, 0, 6);
  const base = trackingCamera(seconds, cameraBias);
  let cam = camera;
  if (cam === undefined) {
    const divisor = 1;
    cam = subject
      ? clampCamera({ ...base, x: base.x - (subject.x - 192) / divisor, y: base.y - (subject.y - 108) / divisor }, label).camera
      : base;
  }
  assertCamera(cam);
  const fb = new FB(width, height).setCam(cam.x, cam.y, cam.zoom);
  draw(fb, t, seed, palette);
  return fb.frame();
}

/**
 * 把一个画法包成可复用资产。
 * 工厂参数：duration / subject / palette；渲染参数：width / height / seed / camera。
 */
export function defineScene({ id, draw, duration, subject = { x: 192, y: 108 }, palette = {}, cameraBias = { x: 0, y: 0, zoom: 0 } }, options = {}) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('场景 id 必须为非空文本');
  const sceneDuration = options.duration ?? duration;
  if (!Number.isFinite(sceneDuration) || sceneDuration <= 0 || sceneDuration > 3600) throw new Error('duration 必须为 0–3600 秒之间的正有限数');
  const sceneSubject = { ...subject, ...(options.subject ?? {}) };
  for (const key of ['x', 'y']) if (!Number.isFinite(sceneSubject[key])) throw new Error(`subject.${key} 必须为有限数`);
  const overrides = options.palette ?? {};
  const scenePalette = { ...palette, ...overrides };
  // 拒绝拼错的颜色名，同时把可用键直接写在报错里。
  for (const [key, color] of Object.entries(scenePalette)) {
    if (!Object.hasOwn(SCENE_PALETTE, key)) throw new Error(`未知调色板键 ${key}；可用：${Object.keys(SCENE_PALETTE).join(', ')}`);
    if (!Array.isArray(color) || color.length < 3 || !color.slice(0, 3).every(Number.isFinite)) throw new Error(`palette.${key} 必须为 RGB/RGBA 数组`);
  }
  const resolvedPalette = Object.freeze({ ...SCENE_PALETTE, ...scenePalette });
  const settings = { palette: resolvedPalette, cameraBias, duration: sceneDuration, label: `scenes/${id}` };
  return Object.freeze({
    id,
    duration: sceneDuration,
    subject: Object.freeze(sceneSubject),
    palette: Object.freeze(scenePalette),
    /** 资产取景：按 subject 反推并夹取摄像机。 */
    render(local, renderOptions = {}) {
      if (!Number.isFinite(local) || local < 0) throw new Error('local 必须为非负有限秒数');
      return sceneFrame(draw, { ...settings, subject: sceneSubject }, local, renderOptions);
    },
    /** 引擎取景：按 6 秒设计空间渲染，不叠加 subject 偏置（12 镜成片与 SCENE_RENDERERS 的约定）。 */
    renderSix(local, renderOptions = {}) {
      if (!Number.isFinite(local)) throw new Error('local 必须为有限秒数');
      return sceneFrame(draw, { ...settings, duration: 6, subject: null }, local, renderOptions);
    },
  });
}