// 09 夜：极简夜空，一颗星慢慢移动，城市压得很低。
import { seg, mix } from '../frame-core.mjs';
import { defineScene, fill, stars, skyline } from './shared.mjs';

export function sceneNight(fb, t, seed, palette) {
  fill(fb, [12, 15, 26]);
  stars(fb, seed + 13, t, 110, [130, 148, 184]);
  // 月
  fb.circle(292, 50, 15, [206, 214, 226]);
  fb.circle(299, 46, 13, [12, 15, 26]);
  // 低矮城市（提亮一档，否则整格看不出轮廓）
  fb.rect(-192, 168, 768, 60, [18, 22, 36]);
  skyline(fb, seed + 89, 168, [26, 31, 47], 44, -180, 560);
  // 移动的星
  const travel = seg(t, 0.5, 5.0);
  const sx = mix(60, 320, travel);
  const sy = 90 - Math.sin(travel * Math.PI) * 18;
  fb.rect(sx, sy, 2, 2, palette.bright);
  fb.circle(sx + 1, sy + 1, 3, [90, 84, 60]);
  // 地平线薄雾
  fb.rect(-192, 160, 768, 10, [22, 26, 40]);
}

export const createNightScene = options => defineScene({
  id: 'night',
  draw: sceneNight,
  duration: 7.8,
  subject: { x: 192, y: 108 },
  palette: { night: [15, 20, 33], gold: [255, 202, 108] },
  // 原 12 镜推轨偏置（order 8：x+4, zoom+0）。
  cameraBias: { x: 4, y: 0, zoom: 0 },
}, options);