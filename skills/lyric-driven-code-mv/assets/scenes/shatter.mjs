// 07 碎片：相框裂开，方块碎片往下掉。
import { seg } from '../frame-core.mjs';
import { defineScene, fill, seeded } from './shared.mjs';

export function sceneShatter(fb, t, seed, palette) {
  fill(fb, [14, 15, 24]);
  // 相框
  fb.rect(132, 48, 120, 96, [58, 50, 44]);
  fb.rect(138, 54, 108, 84, [86, 74, 62]);
  // 相框里两个人的剪影（曾经的合影）
  fb.rect(160, 96, 22, 42, [46, 40, 36]);
  fb.circle(171, 90, 8, [46, 40, 36]);
  fb.rect(206, 98, 20, 40, [52, 44, 40]);
  fb.circle(216, 92, 7, [52, 44, 40]);
  // 裂纹
  const crack = seg(t, 0.2, 1.4);
  if (crack > 0) {
    fb.line(192, 54, 192, 54 + 84 * crack, [26, 24, 22]);
    if (crack > 0.4) { fb.line(192, 88, 150, 110, [26, 24, 22]); fb.line(192, 96, 236, 118, [26, 24, 22]); }
  }
  // 碎片下落
  for (let i = 0; i < 22; i++) {
    const p = seg(t, 1.0 + (i % 7) * 0.18, 2.0);
    if (p <= 0 || p >= 1) continue;
    const x0 = 138 + seeded(seed, i * 5) * 108;
    const y0 = 54 + seeded(seed, i * 5 + 1) * 84;
    const drift = (seeded(seed, i * 5 + 2) - 0.5) * 60 * p;
    const spin = Math.sin(p * 9 + i) * 4;
    const size = 4 + Math.round(seeded(seed, i * 5 + 3) * 7);
    fb.rect(x0 + drift, y0 + p * p * 130 + spin, size, size, i % 3 ? [92, 82, 70] : [126, 112, 94]);
  }
  // 落地的碎渣
  for (let i = 0; i < 14; i++) {
    const x = 130 + seeded(seed, i * 3) * 124;
    fb.rect(x, 196 + seeded(seed, i) * 6, 2, 2, [80, 72, 62]);
  }
}

export const createShatterScene = options => defineScene({
  id: 'shatter',
  draw: sceneShatter,
  duration: 4.4,
  subject: { x: 192, y: 108 },
  palette: { ember: [186, 104, 66], paper: [226, 220, 198] },
  // 原 12 镜推轨偏置（order 6：x+0, zoom+0.02）。
  cameraBias: { x: 0, y: 0, zoom: 0.02 },
}, options);