// 11 走远：一条收敛的土路，人越走越小。
import { seg, mix } from '../frame-core.mjs';
import { defineScene, fill, seeded, figure } from './shared.mjs';

export function scenePath(fb, t, seed, palette) {
  fill(fb, [30, 34, 44]);
  for (let i = 0; i < 18; i++) {
    const k = i / 17;
    fb.rect(-192, -108 + i * 18, 768, 19, [mix(28, 96, k), mix(30, 78, k), mix(40, 62, k)]);
  }
  // 远山
  fb.poly([[-192, 130], [30, 112], [140, 128], [260, 108], [400, 126], [576, 114], [576, 324], [-192, 324]], [44, 42, 46]);
  // 收敛的田垄与土路（土色，不是灰紫）
  fb.poly([[-192, 216], [192, 120], [192, 216], [-192, 216]], [78, 64, 50]);
  fb.poly([[576, 216], [192, 120], [192, 216], [576, 216]], [70, 58, 46]);
  fb.poly([[150, 216], [192, 122], [234, 216], [150, 216]], [118, 92, 68]);
  for (let i = 0; i < 12; i++) {
    const p = i / 11;
    const y = mix(122, 214, p);
    const w = mix(1, 44, p);
    fb.line(192 - w / 2, y, 192 + w / 2, y, [palette.soilLit[0] * 0.7, palette.soilLit[1] * 0.7, palette.soilLit[2] * 0.7]);
  }
  // 走远的人（越远越小，最后几乎只剩一个点）
  const walk = seg(t, 0.4, 5.2);
  const scale = mix(1.8, 0.35, walk);
  figure(fb, 192 + Math.sin(t * 1.6) * 3, mix(200, 132, walk), palette.coat, palette, { back: true, scale });
  // 风里的草
  for (let i = 0; i < 26; i++) {
    const x = 40 + seeded(seed, i * 3) * 300;
    const y = 150 + seeded(seed, i * 3 + 1) * 60;
    const sway = Math.sin(t * 2.2 + i) * 2;
    fb.line(x, y, x + sway, y - 4, [58, 66, 54]);
  }
}

export const createPathScene = options => defineScene({
  id: 'path',
  draw: scenePath,
  duration: 7.2,
  subject: { x: 192, y: 108 },
  palette: { soil: [96, 76, 62], soilLit: [128, 102, 80] },
  // 原 12 镜推轨偏置（order 10：x+2, zoom+0.02）。
  cameraBias: { x: 2, y: 0, zoom: 0.02 },
}, options);