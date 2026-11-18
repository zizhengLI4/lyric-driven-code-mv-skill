// 03 空房：一把空椅子，墙上的日历一页页掉。
import { seg, mix } from '../frame-core.mjs';
import { defineScene, fill, seeded } from './shared.mjs';

export function sceneEmpty(fb, t, seed, palette) {
  fill(fb, palette.wallDark);
  fb.rect(-192, 108, 768, 120, palette.floor);
  fb.rect(-192, 108, 768, 3, [46, 52, 66]);
  // 墙上的日历
  fb.rect(238, 26, 54, 62, palette.paper);
  fb.rect(238, 26, 54, 10, [188, 96, 84]);
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) fb.rect(242 + i * 10, 42 + j * 11, 7, 7, i === 2 && j === 1 ? [188, 96, 84] : [206, 202, 184]);
  // 掉落的日历页
  for (let i = 0; i < 4; i++) {
    const p = seg(t, 0.5 + i * 0.7, 2.2);
    if (p <= 0 || p >= 1) continue;
    const y = mix(88, 178, p);
    fb.rect(252 + i * 6 + Math.sin(p * 6 + i) * 5, y, 9, 11, [200, 196, 178]);
  }
  // 空椅子
  fb.rect(74, 128, 44, 5, [58, 46, 40]);
  fb.rect(74, 100, 5, 30, [58, 46, 40]);
  fb.rect(113, 100, 5, 30, [58, 46, 40]);
  fb.rect(74, 100, 44, 4, [70, 56, 46]);
  fb.rect(78, 133, 3, 30, [44, 36, 32]);
  fb.rect(111, 133, 3, 30, [44, 36, 32]);
  // 尘
  for (let i = 0; i < 16; i++) {
    const x = 20 + seeded(seed, i * 3) * 300;
    const y = 40 + ((seeded(seed, i * 3 + 1) * 120 + t * 4) % 120);
    fb.rect(x, y, 1, 1, [palette.dust[0], palette.dust[1], palette.dust[2]]);
  }
}

export const createEmptyScene = options => defineScene({
  id: 'empty',
  draw: sceneEmpty,
  duration: 6.8,
  subject: { x: 192, y: 112 },
  palette: { wallDark: [28, 33, 45], floor: [24, 28, 38] },
  // 原 12 镜推轨偏置（order 2：x+4, zoom+0.02）。
  cameraBias: { x: 4, y: 0, zoom: 0.02 },
}, options);