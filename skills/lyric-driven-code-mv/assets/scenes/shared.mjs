import { SCENE_PALETTE, renderSceneAsset } from './core.mjs';

const DURATIONS = Object.freeze({ window: 9.5, leave: 7.1, empty: 6.8, turn: 5.3, neon: 9, street: 11.3, shatter: 4.4, lesson: 8.6, night: 7.8, dawn: 7, path: 7.2, lookback: 6 });
const SUBJECTS = Object.freeze({
  window: { x: 188, y: 106 }, leave: { x: 190, y: 112 }, empty: { x: 192, y: 112 }, turn: { x: 190, y: 108 },
  neon: { x: 192, y: 108 }, street: { x: 192, y: 108 }, shatter: { x: 192, y: 108 }, lesson: { x: 192, y: 108 },
  night: { x: 192, y: 108 }, dawn: { x: 192, y: 108 }, path: { x: 192, y: 108 }, lookback: { x: 192, y: 108 },
});
const PALETTES = Object.freeze({
  window: { deep: [20, 27, 44], warm: [255, 206, 130] }, leave: { night: [15, 20, 33], warm: [255, 206, 130] },
  empty: { wallDark: [28, 33, 45], floor: [24, 28, 38] }, turn: { warm: [255, 206, 130], coat: [66, 82, 112] },
  neon: { neon: [255, 86, 132], neonCool: [116, 232, 246] }, street: { neon: [255, 86, 132], rain: [126, 156, 178] },
  shatter: { ember: [186, 104, 66], paper: [226, 220, 198] }, lesson: { chalk: [214, 218, 206], wall: [38, 44, 58] },
  night: { night: [15, 20, 33], gold: [255, 202, 108] }, dawn: { dawnLow: [252, 168, 92], dawnHigh: [255, 226, 168] },
  path: { soil: [96, 76, 62], soilLit: [128, 102, 80] }, lookback: { warm: [255, 206, 130], bright: [255, 239, 190] },
});

export function createSceneAsset(id, options = {}) {
  if (!Object.hasOwn(DURATIONS, id)) throw new Error(`未知场景资产：${id}`);
  const duration = options.duration ?? DURATIONS[id];
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('duration 必须为 0–3600 秒之间的正有限数');
  const subject = { ...SUBJECTS[id], ...(options.subject ?? {}) };
  const palette = { ...PALETTES[id], ...(options.palette ?? {}) };
  // Reject accidental typos while keeping the palette parameter discoverable.
  for (const [key, color] of Object.entries(palette)) {
    if (!Object.hasOwn(SCENE_PALETTE, key)) throw new Error(`未知调色板键 ${key}；可用：${Object.keys(SCENE_PALETTE).join(', ')}`);
    if (!Array.isArray(color) || color.length < 3 || !color.slice(0, 3).every(Number.isFinite)) throw new Error(`palette.${key} 必须为 RGB/RGBA 数组`);
  }
  return Object.freeze({
    id,
    duration,
    subject: Object.freeze(subject),
    palette: Object.freeze(palette),
    render(local, renderOptions = {}) {
      if (!Number.isFinite(local) || local < 0) throw new Error('local 必须为非负有限秒数');
      return renderSceneAsset(id, local, { ...renderOptions, duration, subject, palette });
    },
  });
}
