// 05 霓虹：SPECIAL 七个字母块依次亮起。光晕与字母用 FB.layer 固定先后顺序。
import { seg } from '../frame-core.mjs';
import { defineScene, fill, seeded, figure } from './shared.mjs';

export function sceneNeon(fb, t, seed, palette) {
  fill(fb, [18, 14, 26]);
  fb.rect(-192, 168, 768, 60, [24, 18, 32]);
  // 背后湿润的墙
  for (let i = 0; i < 60; i++) fb.rect(-60 + seeded(seed, i) * 500, 20 + seeded(seed, i + 300) * 150, 2, 2, [30, 24, 44]);
  // 招牌底板
  fb.rect(96, 44, 192, 44, [12, 10, 18]);
  fb.rect(96, 44, 192, 2, [60, 30, 52]);

  const letters = 7;
  const lit = i => seg(t, 0.3 + i * 0.34, 0.18);
  const flicker = i => 0.85 + 0.15 * Math.sin(t * 9 + i * 1.7);
  const rgb = (k) => [palette.neon[0] * k, palette.neon[1] * k, palette.neon[2] * k];

  // layer 语义：glow 先把所有光晕铺在底层，subject 再画字母本体，字母不会被光晕盖掉。
  fb.layer({
    glow: target => {
      for (let i = 0; i < letters; i++) {
        if (lit(i) <= 0.5) continue;
        target.circle(114 + i * 26, 66, 30, rgb(0.09 * flicker(i)));
      }
    },
    subject: target => {
      for (let i = 0; i < letters; i++) {
        const on = lit(i);
        const flick = on > 0.5 ? flicker(i) : 0;
        const x = 104 + i * 26;
        if (on > 0.5) {
          target.rect(x, 52, 20, 28, rgb(0.16 * flick));
          target.rect(x + 3, 55, 14, 4, rgb(flick));
          target.rect(x + 3, 73, 14, 4, rgb(flick));
          target.rect(x + 3, 55, 4, 22, rgb(flick));
          target.rect(x + 13, 55, 4, 22, rgb(flick));
          target.rect(x + 3, 65, 14, 3, rgb(flick));
        } else {
          target.rect(x, 52, 20, 28, [30, 20, 32]);
        }
      }
    },
  });

  // 仰头的人（放大到看得清姿态；头部用深色，别让默认肤色露出来）
  const look = seg(t, 1.2, 2.0);
  figure(fb, 192, 208, palette.coal, palette, { back: true, scale: 2.9, head: [24, 26, 36] });
  fb.rect(184, 148 - look * 3, 18, 6, [24, 26, 36]);
  // 地面反光
  fb.rect(96, 176, 192, 2, rgb(0.35));
}

export const createNeonScene = options => defineScene({
  id: 'neon',
  draw: sceneNeon,
  duration: 9,
  subject: { x: 192, y: 108 },
  palette: { neon: [255, 86, 132], neonCool: [116, 232, 246] },
  // 原 12 镜推轨偏置（order 4：x+2, zoom+0）。
  cameraBias: { x: 2, y: 0, zoom: 0 },
}, options);