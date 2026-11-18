// 01 隔窗：屋里的人看着窗外的人，灯一盏盏灭。
import { seg } from '../frame-core.mjs';
import { defineScene, fill, stars, skyline, figure } from './shared.mjs';

export function sceneWindow(fb, t, seed, palette) {
  fill(fb, palette.deep);
  stars(fb, seed, t, 46, [120, 140, 172]);
  skyline(fb, seed + 11, 160, palette.city, 58 + 22 * Math.sin(t), -180, 560);
  // 窗框：三扇竖窗，只占左侧三分之二，右侧留给走廊
  fb.rect(0, 30, 150, 132, [34, 40, 54]);
  for (let i = 0; i < 3; i++) {
    const wx = 8 + i * 46;
    fb.rect(wx, 36, 40, 118, [17, 22, 36]);
    fb.rect(wx + 2, 40, 36, 110, [22, 30, 48]);
    skyline(fb, seed + 20 + i, 150, palette.city, 44 + 30 * Math.abs(Math.sin(t + i)), wx + 2, wx + 38);
  }
  // 窗内暖灯，逐盏熄灭
  const lit = [1 - seg(t, 0.4, 1.6), 1 - seg(t, 1.8, 1.6), 1 - seg(t, 3.2, 1.8)];
  for (let i = 0; i < 3; i++) if (lit[i] > 0.02) fb.rect(10 + i * 46, 38, 34, 112, [58 * lit[i], 46 * lit[i], 34 * lit[i]]);
  // 窗内的人（背对我们，靠中）
  figure(fb, 76, 196, palette.coal, palette, { back: true, scale: 2.3 });
  // 窗外走廊上的人，抬手又放下
  const reach = Math.sin(t * 1.1) * 0.5 + 0.5;
  fb.rect(200, 60, 3, 150, [26, 30, 42]);
  figure(fb, 268, 200, palette.coat2, palette, { arm: reach * 0.8, dir: -1, scale: 2.4 });
  fb.rect(206, 196, 120, 8, [20, 24, 34]);
  // 玻璃反光
  for (let i = 0; i < 5; i++) fb.rect(12 + i * 4, 46 + i * 22, 3, 24, [96, 112, 136]);
}

export const createWindowScene = options => defineScene({
  id: 'window',
  draw: sceneWindow,
  duration: 9.5,
  subject: { x: 188, y: 106 },
  palette: { deep: [20, 27, 44], warm: [255, 206, 130] },
  // 原 12 镜推轨偏置（order 0：x+0, zoom+0），保持既有画面不变。
  cameraBias: { x: 0, y: 0, zoom: 0 },
}, options);