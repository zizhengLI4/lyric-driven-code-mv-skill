// 08 教训：黑板上被一笔笔划出的线。
import { seg, mix } from '../frame-core.mjs';
import { defineScene, fill, seeded } from './shared.mjs';

export function sceneLesson(fb, t, seed, palette) {
  fill(fb, [26, 32, 30]);
  fb.rect(-192, -108, 768, 432, [30, 38, 36]);
  fb.rect(40, 30, 304, 150, [24, 32, 30]);
  fb.rect(40, 30, 304, 3, [64, 74, 68]);
  fb.rect(40, 177, 304, 3, [64, 74, 68]);
  fb.rect(44, 184, 296, 6, [50, 58, 54]);
  // 粉笔字：三道横线 + 一个句点，按拍写出来
  const write = (start, dur, x0, x1, y) => {
    const p = seg(t, start, dur);
    if (p <= 0) return;
    fb.line(x0, y, mix(x0, x1, p), y, palette.chalk);
    fb.line(x0, y + 1, mix(x0, x1, p), y + 1, [180, 186, 176]);
  };
  write(0.3, 1.1, 60, 322, 66);
  write(1.5, 0.9, 60, 230, 92);
  write(2.5, 1.3, 60, 300, 118);
  const dot = seg(t, 3.9, 0.5);
  if (dot > 0) fb.circle(302, 148, 3 * dot, palette.chalk);
  // 粉笔灰
  for (let i = 0; i < 22; i++) {
    const x = 50 + seeded(seed, i * 3) * 290;
    const y = 40 + ((seeded(seed, i * 3 + 1) * 140 + t * 6) % 140);
    fb.rect(x, y, 1, 1, [170, 176, 166]);
  }
  // 板擦
  fb.rect(320, 170, 18, 7, [62, 56, 50]);
  fb.rect(320, 170, 18, 2, [92, 84, 74]);
}

export const createLessonScene = options => defineScene({
  id: 'lesson',
  draw: sceneLesson,
  duration: 8.6,
  subject: { x: 192, y: 108 },
  palette: { chalk: [214, 218, 206], wall: [38, 44, 58] },
  // 原 12 镜推轨偏置（order 7：x+2, zoom+0.03）。
  cameraBias: { x: 2, y: 0, zoom: 0.03 },
}, options);