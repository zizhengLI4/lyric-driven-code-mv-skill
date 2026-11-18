// 12 回望：逆光里一个人回头，光是唯一亮的东西。
import { seg } from '../frame-core.mjs';
import { defineScene, fill, seeded } from './shared.mjs';

export function sceneLookback(fb, t, seed, palette) {
  fill(fb, [10, 11, 18]);
  // 逆光：六层同心渐变，从外到内变亮（不是三环靶心）
  const flare = 0.86 + 0.14 * Math.sin(t * 1.3);
  const rings = [[86, 0.06], [72, 0.10], [58, 0.16], [45, 0.24], [33, 0.34], [23, 0.48]];
  for (const [r, k] of rings) fb.circle(192, 96, r, [255 * k * flare, 212 * k * flare, 146 * k * flare]);
  // 人影：斜肩 + 脖子 + 头，靠轮廓而不是方块
  fb.poly([[148, 216], [162, 150], [176, 138], [208, 138], [222, 150], [236, 216]], [11, 12, 19]);
  fb.rect(184, 130, 16, 12, [11, 12, 19]);
  fb.circle(192, 116, 17, [11, 12, 19]);
  const turn = seg(t, 1.0, 2.6);
  if (turn > 0.25) {
    fb.circle(196, 116, 13, [15, 16, 23]);
    fb.circle(199, 116, 9, [palette.skin[0] * 0.34, palette.skin[1] * 0.30, palette.skin[2] * 0.27]);
    if (turn > 0.7) fb.rect(203, 114, 2, 3, [30, 26, 24]);
  }
  // 光斑（尘埃）
  for (let i = 0; i < 16; i++) {
    const a = seeded(seed, i * 3) * Math.PI * 2;
    const r = 30 + seeded(seed, i * 3 + 1) * 52;
    const drift = Math.sin(t * 0.8 + i) * 3;
    fb.rect(192 + Math.cos(a) * r + drift, 96 + Math.sin(a) * r, 1, 1, [190, 150, 100]);
  }
  // 压暗四角
  for (let i = 0; i < 10; i++) fb.rect(-192, -108 + i * 6, 768, 3, [8 + i, 9 + i, 14 + i]);
  for (let i = 0; i < 10; i++) fb.rect(-192, 216 - i * 6 - 3, 768, 3, [8 + i, 9 + i, 14 + i]);
}

export const createLookbackScene = options => defineScene({
  id: 'lookback',
  draw: sceneLookback,
  duration: 6,
  subject: { x: 192, y: 108 },
  palette: { warm: [255, 206, 130], bright: [255, 239, 190] },
  // 原 12 镜推轨偏置（order 11：x+4, zoom+0.03）。
  cameraBias: { x: 4, y: 0, zoom: 0.03 },
}, options);