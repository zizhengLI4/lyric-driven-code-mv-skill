// 10 晨：地平线从暗到橙，太阳升起来。
import { seg, mix } from '../frame-core.mjs';
import { defineScene, fill } from './shared.mjs';

export function sceneDawn(fb, t, seed, palette) {
  const rise = seg(t, 0.15, 3.4);
  // 天色渐变：多条横带
  for (let i = 0; i < 18; i++) {
    const k = i / 17;
    const top = [18 + rise * 40, 20 + rise * 26, 34 + rise * 12];
    const bottom = [palette.dawnLow[0] * (0.25 + rise * 0.75), palette.dawnLow[1] * (0.2 + rise * 0.7), palette.dawnLow[2] * (0.25 + rise * 0.5)];
    const c = [mix(top[0], bottom[0], k), mix(top[1], bottom[1], k), mix(top[2], bottom[2], k)];
    fb.rect(-192, -108 + i * 18, 768, 19, c);
  }
  // 太阳：先铺外层光晕，再画本体；光晕用暖色而不是压暗，否则会像黑环
  const sunY = mix(158, 88, rise);
  fb.circle(192, sunY, 38, [148, 102, 66]);
  fb.circle(192, sunY, 29, [208, 150, 94]);
  fb.circle(192, sunY, 19, palette.dawnHigh);
  // 山脊
  fb.poly([[-192, 150], [40, 132], [150, 146], [250, 124], [380, 142], [576, 130], [576, 324], [-192, 324]], [58, 52, 48]);
  fb.poly([[-192, 172], [80, 158], [200, 170], [320, 154], [576, 168], [576, 324], [-192, 324]], [40, 36, 34]);
  // 三个窑洞小口
  for (const x of [86, 128, 170]) {
    fb.rect(x, 168, 14, 18, [30, 26, 24]);
    fb.circle(x + 7, 168, 7, [30, 26, 24]);
  }
  // 路
  fb.poly([[150, 216], [234, 216], [200, 168], [186, 168]], [palette.soilLit[0] * 0.8, palette.soilLit[1] * 0.8, palette.soilLit[2] * 0.8]);
}

export const createDawnScene = options => defineScene({
  id: 'dawn',
  draw: sceneDawn,
  duration: 7,
  subject: { x: 192, y: 108 },
  palette: { dawnLow: [252, 168, 92], dawnHigh: [255, 226, 168] },
  // 原 12 镜推轨偏置（order 9：x+0, zoom+0.01）。
  cameraBias: { x: 0, y: 0, zoom: 0.01 },
}, options);