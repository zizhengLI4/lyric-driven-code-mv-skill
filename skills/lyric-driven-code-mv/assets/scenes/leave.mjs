// 02 离开：一个人拖着箱子走出画面，路灯把影子拉长。
import { seg, mix } from '../frame-core.mjs';
import { defineScene, fill, skyline, figure } from './shared.mjs';

export function sceneLeave(fb, t, seed, palette) {
  fill(fb, palette.night);
  fb.rect(-192, 150, 768, 80, [22, 26, 36]);
  fb.rect(-192, 150, 768, 4, [34, 40, 52]);
  skyline(fb, seed + 31, 150, palette.city, 34, -180, 560);
  // 路灯
  for (const [lx, lit] of [[60, 1], [190, 0.7], [330, 0.45]]) {
    fb.rect(lx, 84, 3, 68, palette.ink);
    fb.rect(lx - 6, 80, 15, 6, [70, 74, 84]);
    fb.circle(lx + 1, 83, 10 * lit, [40 * lit, 40 * lit, 38 * lit]);
    fb.rect(lx - 5, 84, 13, 3, [palette.warm[0] * lit, palette.warm[1] * lit, palette.warm[2] * lit]);
  }
  // 走远的人 + 行李
  const walk = seg(t, 0.2, 5.2);
  const px = mix(96, 306, walk);
  const bob = Math.sin(t * 7.4) * 1.6;
  figure(fb, px, 176 + bob, palette.coat2, palette, { dir: 1, scale: 1.6 });
  fb.rect(px + 14, 162, 12, 15, [44, 40, 48]);
  fb.rect(px + 17, 158, 6, 4, [58, 52, 60]);
  fb.line(px + 12, 164, px + 6, 158, [44, 40, 48]);
  // 影子
  fb.rect(px - 8, 176, 26, 3, [12, 14, 20]);
}

export const createLeaveScene = options => defineScene({
  id: 'leave',
  draw: sceneLeave,
  duration: 7.1,
  subject: { x: 190, y: 112 },
  palette: { night: [15, 20, 33], warm: [255, 206, 130] },
  // 原 12 镜推轨偏置（order 1：x+2, zoom+0.01）。
  cameraBias: { x: 2, y: 0, zoom: 0.01 },
}, options);