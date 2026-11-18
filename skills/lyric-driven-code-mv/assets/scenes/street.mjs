// 06 雨夜长街：一个人走在中线，灯牌倒在水里。
import { seg, mix } from '../frame-core.mjs';
import { defineScene, fill, seeded, skyline, figure, rain } from './shared.mjs';

export function sceneStreet(fb, t, seed, palette) {
  fill(fb, [16, 20, 32]);
  fb.rect(-192, 130, 768, 90, [20, 24, 36]);
  skyline(fb, seed + 57, 130, [22, 27, 42], 40, -180, 560);
  // 路面反光带
  for (let i = 0; i < 26; i++) {
    const x = -30 + seeded(seed, i * 3) * 460;
    const y = 150 + seeded(seed, i * 3 + 1) * 60;
    fb.rect(x, y, 8 + seeded(seed, i) * 18, 1, [40, 52, 70]);
  }
  // 两侧灯牌倒影
  fb.rect(40, 132, 10, 66, [palette.neon[0] * 0.5, palette.neon[1] * 0.5, palette.neon[2] * 0.5]);
  fb.rect(318, 132, 8, 62, [palette.neonCool[0] * 0.42, palette.neonCool[1] * 0.42, palette.neonCool[2] * 0.42]);
  // 人：从右走到左，越走越小（用两段位移模拟纵深）
  const walk = seg(t, 0.3, 5.4);
  const px = mix(300, 150, walk);
  const scale = mix(1.9, 1.35, walk);
  figure(fb, px, 176, palette.coat, palette, { dir: -1, scale });
  fb.rect(px - 10, 176, 20 * scale / 1.6, 3, [10, 12, 18]);
  rain(fb, seed + 71, t, palette, 120, 0.8);
  // 地面水花
  for (let i = 0; i < 10; i++) {
    const x = 20 + seeded(seed, i * 7) * 340;
    const phase = (t * 1.6 + i * 0.37) % 1;
    fb.circle(x, 178 + seeded(seed, i) * 24, 1 + phase * 3, [60 * (1 - phase), 78 * (1 - phase), 96 * (1 - phase)]);
  }
}

export const createStreetScene = options => defineScene({
  id: 'street',
  draw: sceneStreet,
  duration: 11.3,
  subject: { x: 192, y: 108 },
  palette: { neon: [255, 86, 132], rain: [126, 156, 178] },
  // 原 12 镜推轨偏置（order 5：x+4, zoom+0.01）。
  cameraBias: { x: 4, y: 0, zoom: 0.01 },
}, options);