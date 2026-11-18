// 04 转身：逆光门框，背影慢慢回头。
import { seg, mix } from '../frame-core.mjs';
import { defineScene, fill } from './shared.mjs';

export function sceneTurn(fb, t, seed, palette) {
  fill(fb, [10, 12, 19]);
  // 门框四层，从外到里变亮；最后是门里的光（上亮下暗）
  fb.rect(96, 10, 192, 206, [40, 34, 28]);
  fb.rect(104, 18, 176, 198, [96, 78, 56]);
  fb.rect(112, 26, 160, 190, [168, 132, 86]);
  for (let i = 0; i < 10; i++) {
    const k = 1 - i / 10;
    fb.rect(112, 26 + i * 19, 160, 19, [mix(130, 226, k), mix(104, 184, k), mix(70, 126, k)]);
  }
  // 人影：深色剪影站在光里，先背对再侧脸
  const turn = seg(t, 1.6, 2.4);
  fb.rect(168, 104, 48, 92, [13, 14, 21]);
  fb.rect(175, 120, 34, 76, [17, 18, 25]);
  fb.circle(192, 92, 18, [13, 14, 21]);
  if (turn > 0.4) {
    fb.circle(197, 92, 14, [34, 28, 25]);
    fb.circle(199, 92, 10, [palette.skin[0] * 0.5, palette.skin[1] * 0.44, palette.skin[2] * 0.4]);
    if (turn > 0.8) fb.rect(203, 90, 2, 3, [32, 27, 23]);
  }
  // 地面与门槛
  fb.rect(-192, 196, 768, 40, [12, 13, 20]);
  fb.rect(112, 190, 160, 6, [62, 52, 40]);
  // 两侧暗角，只压画面左右边，不碰中间的门
  for (let i = 0; i < 8; i++) {
    fb.rect(-192 + i * 12, -108, 15, 432, [11 + i * 2, 13 + i * 2, 20 + i * 2]);
    fb.rect(276 + i * 14, -108, 16, 432, [11 + i * 2, 13 + i * 2, 20 + i * 2]);
  }
}

export const createTurnScene = options => defineScene({
  id: 'turn',
  draw: sceneTurn,
  duration: 5.3,
  subject: { x: 190, y: 108 },
  palette: { warm: [255, 206, 130], coat: [66, 82, 112] },
  // 原 12 镜推轨偏置（order 3：x+0, zoom+0.03）。
  cameraBias: { x: 0, y: 0, zoom: 0.03 },
}, options);