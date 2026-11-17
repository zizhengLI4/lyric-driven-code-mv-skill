// special —— Richie Kotzen / Get Up
// 90 秒 / 12 镜头像素画法。纯帧：给定 (index, local) 永远得到同一张图。
// 框架部分（FB / 时间线 / 转场）沿用 starter 的约定，只替换世界与演出。

export const WIDTH = 384;
export const HEIGHT = 216;
export const DURATION = 90;
export const DEFAULT_SEED = 'special-kotzen-90';

export const CAMERA_LIMITS = Object.freeze({ minX: 120, maxX: 264, minY: 70, maxY: 146, minZoom: 0.75, maxZoom: 1.25 });

// 12 镜：每镜按 6 秒设计，实际窗口由分镜决定。
export const SCENES = Object.freeze([
  { id: 'window', start: 0, end: 9.5, exit: { type: 'dissolve', dur: 0.8 } },
  { id: 'leave', start: 9.5, end: 16.6, exit: { type: 'dissolve', dur: 0.7 } },
  { id: 'empty', start: 16.6, end: 23.4, exit: { type: 'dissolve', dur: 0.7 } },
  { id: 'turn', start: 23.4, end: 28.7, exit: { type: 'dissolve', dur: 0.6 } },
  { id: 'neon', start: 28.7, end: 37.7, exit: { type: 'ripple', dur: 0.9, origin: [0.5, 0.4] } },
  { id: 'street', start: 37.7, end: 49.0, exit: { type: 'rain', dur: 0.9 } },
  { id: 'shatter', start: 49.0, end: 53.4, exit: { type: 'cut', dur: 0 } },
  { id: 'lesson', start: 53.4, end: 62.0, exit: { type: 'dissolve', dur: 0.8 } },
  { id: 'night', start: 62.0, end: 69.8, exit: { type: 'dissolve', dur: 1.0 } },
  { id: 'dawn', start: 69.8, end: 76.8, exit: { type: 'dissolve', dur: 0.9 } },
  { id: 'path', start: 76.8, end: 84.0, exit: { type: 'dissolve', dur: 0.8 } },
  { id: 'lookback', start: 84.0, end: 90, exit: { type: 'dissolve', dur: 1.2 } },
]);

export const CAPTIONS = Object.freeze([
  { start: 3.3, text: '你说 我不是你要的那个人', en: 'You said I am not what you were looking for' },
  { start: 10.0, text: '你走了 别人能给你更多', en: 'You are moving on, somebody else can give you more' },
  { start: 16.6, text: '于是放手 以为再也见不到', en: 'So I let you go, thinking we would never meet again' },
  { start: 23.4, text: '可你就在这里 我想问', en: 'But here you are, and baby I wanna know' },
  { start: 28.7, text: '你想过富有吗 你想过特别吗', en: 'Did you wanna be rich, did you wanna feel special' },
  { start: 37.7, text: '这段时间 你想过我', en: 'Did you wonder in all this time' },
  { start: 39.0, text: '没有你 是怎么活的', en: 'how I was living without you' },
  { start: 41.4, text: '你想过残忍吗', en: 'Did you wanna be cruel' },
  { start: 49.1, text: '你以为拥有的 都没了', en: 'All the things you thought you had have gone' },
  { start: 53.4, text: '就当给你上一课', en: 'Let that be a lesson to you' },
  { start: 69.8, text: '生活变得多快 说不准', en: 'It is funny how life can change' },
  { start: 76.8, text: '走开之后 你才知道', en: 'You never know until you walk away' },
  { start: 84.0, text: '我看见你 迷失又害怕', en: 'I see you now and you are lost and afraid' },
]);

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const ease = n => { n = clamp(n, 0, 1); return n * n * (3 - 2 * n); };
const mix = (a, b, n) => a + (b - a) * n;
const seg = (t, start, dur) => ease((t - start) / dur);
const back = (t, start, dur) => 1 - ease((t - start) / dur);

export function seeded(seed, index) {
  const text = String(seed) + ':' + index;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return ((hash >>> 0) % 100000) / 100000;
}

export const SCENE_PALETTE = Object.freeze({
  void: [10, 13, 22], night: [15, 20, 33], deep: [20, 27, 44], city: [27, 34, 52], cityLit: [46, 56, 80],
  wall: [38, 44, 58], wallDark: [28, 33, 45], floor: [24, 28, 38],
  warm: [255, 206, 130], bright: [255, 239, 190], amber: [238, 160, 86], ember: [186, 104, 66],
  skin: [222, 171, 133], ink: [16, 20, 30], coal: [28, 34, 46],
  coat: [66, 82, 112], coat2: [124, 78, 96], coat3: [92, 110, 132],
  rain: [126, 156, 178], glass: [86, 118, 140],
  neon: [255, 86, 132], neonCool: [116, 232, 246], gold: [255, 202, 108],
  paper: [226, 220, 198], chalk: [214, 218, 206], dust: [116, 126, 148],
  dawnLow: [252, 168, 92], dawnHigh: [255, 226, 168], soil: [96, 76, 62], soilLit: [128, 102, 80],
});
let P = SCENE_PALETTE;

function fill(fb, color) { fb.rect(-192, -108, 768, 432, color); }

/** 星点：固定种子，轻微呼吸。 */
function stars(fb, seed, t, count = 70, tint = [150, 168, 196]) {
  for (let i = 0; i < count; i++) {
    const x = -170 + seeded(seed, i * 3) * 730;
    const y = -80 + seeded(seed, i * 3 + 1) * 150;
    const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.9 + i));
    fb.rect(x, y, 1, 1, [tint[0] * twinkle, tint[1] * twinkle, tint[2] * twinkle]);
  }
}

/** 城市剪影：宽高抖动，窗格随机点亮。 */
function skyline(fb, seed, baseY, color, lit, from = -180, to = 560) {
  let x = from;
  let i = 0;
  while (x < to) {
    const w = 10 + Math.round(seeded(seed, i * 5) * 22);
    const h = 18 + Math.round(seeded(seed, i * 5 + 1) * 58);
    fb.rect(x, baseY - h, w, h + 60, color);
    if (lit > 0) {
      for (let wy = baseY - h + 3; wy < baseY - 2; wy += 5) {
        for (let wx = x + 2; wx < x + w - 2; wx += 4) {
          if (seeded(seed, i * 97 + wy * 3 + wx) > 0.52) fb.rect(wx, wy, 1, 1, [lit * 0.9, lit * 0.78, lit * 0.5]);
        }
      }
    }
    x += w + 2 + Math.round(seeded(seed, i * 5 + 2) * 3);
    i++;
  }
}

/** 站立的人影：极简 8×28，可转身、可抬手。 */
function figure(fb, x, y, coat, { head = P.skin, arm = 0, dir = 1, back = false, scale = 1 } = {}) {
  const h = 28 * scale, w = 8 * scale;
  fb.rect(x - w / 2, y - h, w, w, head);
  if (!back) { fb.rect(x - w / 2 - 1, y - h - 1, w + 2, 3, P.ink); }
  fb.rect(x - w / 2 - 1, y - h + w + 1, w + 2, h - w - 6, coat);
  fb.rect(x - w / 2 - 1, y - 7 * scale, 3 * scale, 7 * scale, P.ink);
  fb.rect(x + w / 2 - 2 * scale, y - 7 * scale, 3 * scale, 7 * scale, P.ink);
  if (arm > 0) fb.line(x + dir * w / 2, y - h + w + 4, x + dir * (w / 2 + 10 * arm), y - h + w + 2 - 4 * arm, head);
}

/** 雨丝：只画视口内的短斜线。 */
function rain(fb, seed, t, density = 90, alpha = 1) {
  for (let i = 0; i < density; i++) {
    const x = -40 + seeded(seed, i * 3) * 470;
    const cycle = 42;
    const y = ((seeded(seed, i * 3 + 1) * cycle + t * 96) % cycle) + 10;
    fb.line(x, y, x - 2, y + 7, [P.rain[0] * alpha, P.rain[1] * alpha, P.rain[2] * alpha]);
  }
}

// —— 12 个镜头 ——

/** 01 隔窗：屋里的人看着窗外的人，灯一盏盏灭。 */
function sceneWindow(fb, t, seed) {
  fill(fb, P.deep);
  stars(fb, seed, t, 46, [120, 140, 172]);
  skyline(fb, seed + 11, 160, P.city, 58 + 22 * Math.sin(t), -180, 560);
  // 窗框：三扇竖窗，只占左侧三分之二，右侧留给走廊
  fb.rect(0, 30, 150, 132, [34, 40, 54]);
  for (let i = 0; i < 3; i++) {
    const wx = 8 + i * 46;
    fb.rect(wx, 36, 40, 118, [17, 22, 36]);
    fb.rect(wx + 2, 40, 36, 110, [22, 30, 48]);
    skyline(fb, seed + 20 + i, 150, P.city, 44 + 30 * Math.abs(Math.sin(t + i)), wx + 2, wx + 38);
  }
  // 窗内暖灯，逐盏熄灭
  const lit = [1 - seg(t, 0.4, 1.6), 1 - seg(t, 1.8, 1.6), 1 - seg(t, 3.2, 1.8)];
  for (let i = 0; i < 3; i++) if (lit[i] > 0.02) fb.rect(10 + i * 46, 38, 34, 112, [58 * lit[i], 46 * lit[i], 34 * lit[i]]);
  // 窗内的人（背对我们，靠中）
  figure(fb, 76, 196, P.coal, { back: true, scale: 2.3 });
  // 窗外走廊上的人，抬手又放下
  const reach = Math.sin(t * 1.1) * 0.5 + 0.5;
  fb.rect(200, 60, 3, 150, [26, 30, 42]);
  figure(fb, 268, 200, P.coat2, { arm: reach * 0.8, dir: -1, scale: 2.4 });
  fb.rect(206, 196, 120, 8, [20, 24, 34]);
  // 玻璃反光
  for (let i = 0; i < 5; i++) fb.rect(12 + i * 4, 46 + i * 22, 3, 24, [96, 112, 136]);
}

/** 02 离开：一个人拖着箱子走出画面，路灯把影子拉长。 */
function sceneLeave(fb, t, seed) {
  fill(fb, P.night);
  fb.rect(-192, 150, 768, 80, [22, 26, 36]);
  fb.rect(-192, 150, 768, 4, [34, 40, 52]);
  skyline(fb, seed + 31, 150, P.city, 34, -180, 560);
  // 路灯
  for (const [lx, lit] of [[60, 1], [190, 0.7], [330, 0.45]]) {
    fb.rect(lx, 84, 3, 68, P.ink);
    fb.rect(lx - 6, 80, 15, 6, [70, 74, 84]);
    fb.circle(lx + 1, 83, 10 * lit, [40 * lit, 40 * lit, 38 * lit]);
    fb.rect(lx - 5, 84, 13, 3, [P.warm[0] * lit, P.warm[1] * lit, P.warm[2] * lit]);
  }
  // 走远的人 + 行李
  const walk = seg(t, 0.2, 5.2);
  const px = mix(96, 306, walk);
  const bob = Math.sin(t * 7.4) * 1.6;
  figure(fb, px, 176 + bob, P.coat2, { dir: 1, scale: 1.6 });
  fb.rect(px + 14, 162, 12, 15, [44, 40, 48]);
  fb.rect(px + 17, 158, 6, 4, [58, 52, 60]);
  fb.line(px + 12, 164, px + 6, 158, [44, 40, 48]);
  // 影子
  fb.rect(px - 8, 176, 26, 3, [12, 14, 20]);
}

/** 03 空房：一把空椅子，墙上的日历一页页掉。 */
function sceneEmpty(fb, t, seed) {
  fill(fb, P.wallDark);
  fb.rect(-192, 108, 768, 120, P.floor);
  fb.rect(-192, 108, 768, 3, [46, 52, 66]);
  // 墙上的日历
  fb.rect(238, 26, 54, 62, P.paper);
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
    fb.rect(x, y, 1, 1, [P.dust[0], P.dust[1], P.dust[2]]);
  }
}

/** 04 转身：逆光门框，背影慢慢回头。 */
function sceneTurn(fb, t, seed) {
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
    fb.circle(199, 92, 10, [P.skin[0] * 0.5, P.skin[1] * 0.44, P.skin[2] * 0.4]);
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

/** 05 霓虹：SPECIAL 六个字母依次亮起。 */
function sceneNeon(fb, t, seed) {
  fill(fb, [18, 14, 26]);
  fb.rect(-192, 168, 768, 60, [24, 18, 32]);
  // 背后湿润的墙
  for (let i = 0; i < 60; i++) fb.rect(-60 + seeded(seed, i) * 500, 20 + seeded(seed, i + 300) * 150, 2, 2, [30, 24, 44]);
  // 招牌底板
  fb.rect(96, 44, 192, 44, [12, 10, 18]);
  fb.rect(96, 44, 192, 2, [60, 30, 52]);
  // 七个字母块，按拍依次亮。光晕必须先铺底色，否则会盖掉字母本身。
  const letters = 7;
  for (let i = 0; i < letters; i++) {
    const on = seg(t, 0.3 + i * 0.34, 0.18);
    if (on <= 0.5) continue;
    const flick = 0.85 + 0.15 * Math.sin(t * 9 + i * 1.7);
    fb.circle(114 + i * 26, 66, 30, [P.neon[0] * 0.09 * flick, P.neon[1] * 0.09 * flick, P.neon[2] * 0.09 * flick]);
  }
  for (let i = 0; i < letters; i++) {
    const on = seg(t, 0.3 + i * 0.34, 0.18);
    const flick = on > 0.5 ? 0.85 + 0.15 * Math.sin(t * 9 + i * 1.7) : 0;
    const x = 104 + i * 26;
    if (on > 0.5) {
      fb.rect(x, 52, 20, 28, [P.neon[0] * 0.16 * flick, P.neon[1] * 0.16 * flick, P.neon[2] * 0.16 * flick]);
      fb.rect(x + 3, 55, 14, 4, [P.neon[0] * flick, P.neon[1] * flick, P.neon[2] * flick]);
      fb.rect(x + 3, 73, 14, 4, [P.neon[0] * flick, P.neon[1] * flick, P.neon[2] * flick]);
      fb.rect(x + 3, 55, 4, 22, [P.neon[0] * flick, P.neon[1] * flick, P.neon[2] * flick]);
      fb.rect(x + 13, 55, 4, 22, [P.neon[0] * flick, P.neon[1] * flick, P.neon[2] * flick]);
      fb.rect(x + 3, 65, 14, 3, [P.neon[0] * flick, P.neon[1] * flick, P.neon[2] * flick]);
    } else {
      fb.rect(x, 52, 20, 28, [30, 20, 32]);
    }
  }
  // 仰头的人（放大到看得清姿态；头部用深色，别让默认肤色露出来）
  const look = seg(t, 1.2, 2.0);
  figure(fb, 192, 208, P.coal, { back: true, scale: 2.9, head: [24, 26, 36] });
  fb.rect(184, 148 - look * 3, 18, 6, [24, 26, 36]);
  // 地面反光
  fb.rect(96, 176, 192, 2, [P.neon[0] * 0.35, P.neon[1] * 0.35, P.neon[2] * 0.35]);
}

/** 06 雨夜长街：一个人走在中线，灯牌倒在水里。 */
function sceneStreet(fb, t, seed) {
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
  fb.rect(40, 132, 10, 66, [P.neon[0] * 0.5, P.neon[1] * 0.5, P.neon[2] * 0.5]);
  fb.rect(318, 132, 8, 62, [P.neonCool[0] * 0.42, P.neonCool[1] * 0.42, P.neonCool[2] * 0.42]);
  // 人：从右走到左，越走越小（用两段位移模拟纵深）
  const walk = seg(t, 0.3, 5.4);
  const px = mix(300, 150, walk);
  const scale = mix(1.9, 1.35, walk);
  figure(fb, px, 176, P.coat, { dir: -1, scale });
  fb.rect(px - 10, 176, 20 * scale / 1.6, 3, [10, 12, 18]);
  rain(fb, seed + 71, t, 120, 0.8);
  // 地面水花
  for (let i = 0; i < 10; i++) {
    const x = 20 + seeded(seed, i * 7) * 340;
    const phase = (t * 1.6 + i * 0.37) % 1;
    fb.circle(x, 178 + seeded(seed, i) * 24, 1 + phase * 3, [60 * (1 - phase), 78 * (1 - phase), 96 * (1 - phase)]);
  }
}

/** 07 碎片：相框裂开，方块碎片往下掉。 */
function sceneShatter(fb, t, seed) {
  fill(fb, [14, 15, 24]);
  // 相框
  fb.rect(132, 48, 120, 96, [58, 50, 44]);
  fb.rect(138, 54, 108, 84, [86, 74, 62]);
  // 相框里两个人的剪影（曾经的合影）
  fb.rect(160, 96, 22, 42, [46, 40, 36]);
  fb.circle(171, 90, 8, [46, 40, 36]);
  fb.rect(206, 98, 20, 40, [52, 44, 40]);
  fb.circle(216, 92, 7, [52, 44, 40]);
  // 裂纹
  const crack = seg(t, 0.2, 1.4);
  if (crack > 0) {
    fb.line(192, 54, 192, 54 + 84 * crack, [26, 24, 22]);
    if (crack > 0.4) { fb.line(192, 88, 150, 110, [26, 24, 22]); fb.line(192, 96, 236, 118, [26, 24, 22]); }
  }
  // 碎片下落
  for (let i = 0; i < 22; i++) {
    const p = seg(t, 1.0 + (i % 7) * 0.18, 2.0);
    if (p <= 0 || p >= 1) continue;
    const x0 = 138 + seeded(seed, i * 5) * 108;
    const y0 = 54 + seeded(seed, i * 5 + 1) * 84;
    const drift = (seeded(seed, i * 5 + 2) - 0.5) * 60 * p;
    const spin = Math.sin(p * 9 + i) * 4;
    const size = 4 + Math.round(seeded(seed, i * 5 + 3) * 7);
    fb.rect(x0 + drift, y0 + p * p * 130 + spin, size, size, i % 3 ? [92, 82, 70] : [126, 112, 94]);
  }
  // 落地的碎渣
  for (let i = 0; i < 14; i++) {
    const x = 130 + seeded(seed, i * 3) * 124;
    fb.rect(x, 196 + seeded(seed, i) * 6, 2, 2, [80, 72, 62]);
  }
}

/** 08 教训：黑板上被一笔笔划出的线。 */
function sceneLesson(fb, t, seed) {
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
    fb.line(x0, y, mix(x0, x1, p), y, P.chalk);
    fb.line(x0, y + 1, mix(x0, x1, p), y + 1, [180, 186, 176]);
  };
  write(0.3, 1.1, 60, 322, 66);
  write(1.5, 0.9, 60, 230, 92);
  write(2.5, 1.3, 60, 300, 118);
  const dot = seg(t, 3.9, 0.5);
  if (dot > 0) fb.circle(302, 148, 3 * dot, P.chalk);
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

/** 09 夜：极简夜空，一颗星慢慢移动，城市压得很低。 */
function sceneNight(fb, t, seed) {
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
  fb.rect(sx, sy, 2, 2, P.bright);
  fb.circle(sx + 1, sy + 1, 3, [90, 84, 60]);
  // 地平线薄雾
  fb.rect(-192, 160, 768, 10, [22, 26, 40]);
}

/** 10 晨：地平线从暗到橙，太阳升起来。 */
function sceneDawn(fb, t, seed) {
  const rise = seg(t, 0.15, 3.4);
  // 天色渐变：多条横带
  for (let i = 0; i < 18; i++) {
    const k = i / 17;
    const top = [18 + rise * 40, 20 + rise * 26, 34 + rise * 12];
    const bottom = [P.dawnLow[0] * (0.25 + rise * 0.75), P.dawnLow[1] * (0.2 + rise * 0.7), P.dawnLow[2] * (0.25 + rise * 0.5)];
    const c = [mix(top[0], bottom[0], k), mix(top[1], bottom[1], k), mix(top[2], bottom[2], k)];
    fb.rect(-192, -108 + i * 18, 768, 19, c);
  }
  // 太阳：先铺外层光晕，再画本体；光晕用暖色而不是压暗，否则会像黑环
  const sunY = mix(158, 88, rise);
  fb.circle(192, sunY, 38, [148, 102, 66]);
  fb.circle(192, sunY, 29, [208, 150, 94]);
  fb.circle(192, sunY, 19, P.dawnHigh);
  // 山脊
  fb.poly([[-192, 150], [40, 132], [150, 146], [250, 124], [380, 142], [576, 130], [576, 324], [-192, 324]], [58, 52, 48]);
  fb.poly([[-192, 172], [80, 158], [200, 170], [320, 154], [576, 168], [576, 324], [-192, 324]], [40, 36, 34]);
  // 三个窑洞小口
  for (const x of [86, 128, 170]) {
    fb.rect(x, 168, 14, 18, [30, 26, 24]);
    fb.circle(x + 7, 168, 7, [30, 26, 24]);
  }
  // 路
  fb.poly([[150, 216], [234, 216], [200, 168], [186, 168]], [P.soilLit[0] * 0.8, P.soilLit[1] * 0.8, P.soilLit[2] * 0.8]);
}

/** 11 走远：一条收敛的土路，人越走越小。 */
function scenePath(fb, t, seed) {
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
    fb.line(192 - w / 2, y, 192 + w / 2, y, [P.soilLit[0] * 0.7, P.soilLit[1] * 0.7, P.soilLit[2] * 0.7]);
  }
  // 走远的人（越远越小，最后几乎只剩一个点）
  const walk = seg(t, 0.4, 5.2);
  const scale = mix(1.8, 0.35, walk);
  figure(fb, 192 + Math.sin(t * 1.6) * 3, mix(200, 132, walk), P.coat, { back: true, scale });
  // 风里的草
  for (let i = 0; i < 26; i++) {
    const x = 40 + seeded(seed, i * 3) * 300;
    const y = 150 + seeded(seed, i * 3 + 1) * 60;
    const sway = Math.sin(t * 2.2 + i) * 2;
    fb.line(x, y, x + sway, y - 4, [58, 66, 54]);
  }
}

/** 12 回望：逆光里一个人回头，光是唯一亮的东西。 */
function sceneLookback(fb, t, seed) {
  fill(fb, [10, 11, 18]);
  // 逆光：六层同心渐变，从外到内变亮（不是三环靶心）
  const flare = 0.86 + 0.14 * Math.sin(t * 1.3);
  const rings = [[86, 0.06], [72, 0.10], [58, 0.16], [45, 0.24], [33, 0.34], [23, 0.48]];
  for (const [r, k] of rings) fb.circle(192, 96, r, [255 * k * flare, 212 * k * flare, 146 * k * flare]);
  // 人影：斜肩 + 脖子 + 头，靠轮廓而不是方块
  fb.poly([[148, 216], [162, 150], [176, 138], [208, 138], [222, 150], [236, 216]], [11, 12, 19]);
  fb.rect(184, 130, 16, 12, [11, 12, 19]);
  fb.circle(192, 116, 17, [11, 12, 19]);
  const turn = seg(t, 1.0, 2.6);
  if (turn > 0.25) {
    fb.circle(196, 116, 13, [15, 16, 23]);
    fb.circle(199, 116, 9, [P.skin[0] * 0.34, P.skin[1] * 0.30, P.skin[2] * 0.27]);
    if (turn > 0.7) fb.rect(203, 114, 2, 3, [30, 26, 24]);
  }
  // 光斑（尘埃）
  for (let i = 0; i < 16; i++) {
    const a = seeded(seed, i * 3) * Math.PI * 2;
    const r = 30 + seeded(seed, i * 3 + 1) * 52;
    const drift = Math.sin(t * 0.8 + i) * 3;
    fb.rect(192 + Math.cos(a) * r + drift, 96 + Math.sin(a) * r, 1, 1, [190, 150, 100]);
  }
  // 压暗四角
  for (let i = 0; i < 10; i++) fb.rect(-192, -108 + i * 6, 768, 3, [8 + i, 9 + i, 14 + i]);
  for (let i = 0; i < 10; i++) fb.rect(-192, 216 - i * 6 - 3, 768, 3, [8 + i, 9 + i, 14 + i]);
}

const DRAW = [sceneWindow, sceneLeave, sceneEmpty, sceneTurn, sceneNeon, sceneStreet, sceneShatter, sceneLesson, sceneNight, sceneDawn, scenePath, sceneLookback];

export class FB {
  constructor(width = WIDTH, height = HEIGHT) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('帧尺寸必须为 1–4096 的整数');
    this.width = width; this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    this.setCam();
  }
  setCam(x = 192, y = 108, zoom = 1) {
    if (![x, y, zoom].every(Number.isFinite) || Math.abs(x) > 1000000 || Math.abs(y) > 1000000 || zoom < 0.01 || zoom > 64) throw new Error('摄像机坐标须有限，绝对值≤1000000，zoom 须在0.01–64之间');
    this.cam = { x, y, zoom }; return this;
  }
  X(x) { return Math.round((this.guard(x) - this.cam.x) * this.cam.zoom * this.width / WIDTH + this.width / 2); }
  Y(y) { return Math.round((this.guard(y) - this.cam.y) * this.cam.zoom * this.height / HEIGHT + this.height / 2); }
  guard(n) { if (!Number.isFinite(n) || Math.abs(n) > 1000000) throw new Error('图元坐标须有限，绝对值不超过1000000'); return n; }
  put(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = color[0]; this.data[i + 1] = color[1]; this.data[i + 2] = color[2]; this.data[i + 3] = color[3] ?? 255;
  }
  pixel(x, y, color) { this.put(this.X(x), this.Y(y), color); }
  rect(x, y, width, height, color) {
    const left = Math.max(0, this.X(x)), right = Math.min(this.width, this.X(x + width));
    const top = Math.max(0, this.Y(y)), bottom = Math.min(this.height, this.Y(y + height));
    for (let py = top; py < bottom; py++) for (let px = left; px < right; px++) this.put(px, py, color);
  }
  line(x0, y0, x1, y1, color) {
    let x = this.X(x0), y = this.Y(y0), tx = this.X(x1), ty = this.Y(y1);
    const vx = tx - x, vy = ty - y, bounds = [[-vx, x], [vx, this.width - 1 - x], [-vy, y], [vy, this.height - 1 - y]];
    let enter = 0, leave = 1;
    for (const [p, q] of bounds) {
      if (p === 0) { if (q < 0) return; continue; }
      const ratio = q / p; if (p < 0) enter = Math.max(enter, ratio); else leave = Math.min(leave, ratio);
      if (enter > leave) return;
    }
    tx = clamp(Math.round(x + vx * leave), 0, this.width - 1); ty = clamp(Math.round(y + vy * leave), 0, this.height - 1);
    x = clamp(Math.round(x + vx * enter), 0, this.width - 1); y = clamp(Math.round(y + vy * enter), 0, this.height - 1);
    const dx = Math.abs(tx - x), dy = -Math.abs(ty - y), sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
    let err = dx + dy;
    for (;;) { this.put(x, y, color); if (x === tx && y === ty) break; const e = err * 2; if (e >= dy) { err += dy; x += sx; } if (e <= dx) { err += dx; y += sy; } }
  }
  circle(x, y, radius, color) {
    this.guard(radius); if (radius < 0) throw new Error('图元半径不能为负数');
    const cx = this.X(x), cy = this.Y(y);
    const rx = Math.max(1, Math.round(radius * this.cam.zoom * this.width / WIDTH));
    const ry = Math.max(1, Math.round(radius * this.cam.zoom * this.height / HEIGHT));
    const left = Math.max(0, cx - rx), right = Math.min(this.width - 1, cx + rx), top = Math.max(0, cy - ry), bottom = Math.min(this.height - 1, cy + ry);
    for (let py = top; py <= bottom; py++) for (let px = left; px <= right; px++) if ((px - cx) ** 2 / (rx * rx) + (py - cy) ** 2 / (ry * ry) <= 1) this.put(px, py, color);
  }
  poly(points, color) {
    const p = points.map(([x, y]) => [this.X(x), this.Y(y)]);
    const top = Math.max(0, Math.min(...p.map(v => v[1]))), bottom = Math.min(this.height - 1, Math.max(...p.map(v => v[1])));
    for (let y = top; y <= bottom; y++) {
      const nodes = [];
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i], [xj, yj] = p[j];
        if ((yi <= y && yj > y) || (yj <= y && yi > y)) nodes.push(Math.round(xi + (y - yi) / (yj - yi) * (xj - xi)));
      }
      nodes.sort((a, b) => a - b);
      for (let i = 0; i + 1 < nodes.length; i += 2) for (let x = Math.max(0, nodes[i]); x <= Math.min(this.width - 1, nodes[i + 1]); x++) this.put(x, y, color);
    }
  }
  frame() { return { width: this.width, height: this.height, data: this.data }; }
}

export function renderScene(index, local, options = {}) {
  const { width = WIDTH, height = HEIGHT, seed = DEFAULT_SEED, camera } = options;
  if (!Number.isInteger(index) || index < 0 || index >= DRAW.length) throw new Error(`未知镜头：${index}`);
  if (!Number.isFinite(local)) throw new Error('镜头 local 必须为有限秒数');
  const t = clamp(local, 0, 6), fb = new FB(width, height);
  // 每镜一点缓慢推轨，避免整段死板；限制在 CAMERA_LIMITS 内。
  const drift = ease(t / 6);
  const cam = camera ?? { x: 188 + drift * 8 + (index % 3) * 2, y: 106 + drift * 4, zoom: 1 + drift * 0.05 + (index % 4) * 0.01 };
  if (![cam.x, cam.y, cam.zoom].every(Number.isFinite) || cam.x < CAMERA_LIMITS.minX || cam.x > CAMERA_LIMITS.maxX || cam.y < CAMERA_LIMITS.minY || cam.y > CAMERA_LIMITS.maxY || cam.zoom < CAMERA_LIMITS.minZoom || cam.zoom > CAMERA_LIMITS.maxZoom) throw new Error('摄像机超出模板范围：x=120–264，y=70–146，zoom=0.75–1.25');
  fb.setCam(cam.x, cam.y, cam.zoom);
  DRAW[index](fb, t, seed);
  return fb.frame();
}

export function resolveTimeline(time, timeline = { duration: DURATION, scenes: SCENES }) {
  if (!Number.isFinite(time)) throw new Error('时间 t 必须为有限秒数');
  const { duration, scenes } = timeline;
  const t = clamp(time, 0, duration);
  let index = scenes.findIndex(scene => t < scene.end);
  if (index < 0) index = scenes.length - 1;
  const scene = scenes[index];
  const result = { index, local: t - scene.start, nextIndex: null, nextLocal: null, progress: null, exit: scene.exit };
  const start = scene.end - scene.exit.dur;
  if (index + 1 < scenes.length && scene.exit.type !== 'cut' && scene.exit.dur > 0 && t >= start && t < scene.end) {
    result.nextIndex = index + 1; result.nextLocal = 0;
    result.progress = clamp((t - start) / scene.exit.dur, 0, 1);
  }
  return result;
}

export function blendFrames(previous, next, progress, exit = SCENES[0].exit) {
  if (previous.width !== next.width || previous.height !== next.height || previous.data.length !== next.data.length) throw new Error('转场帧尺寸不一致');
  if (!Number.isFinite(progress)) throw new Error('转场进度必须有限');
  if (!['dissolve', 'ripple', 'water', 'rain', 'cut'].includes(exit.type)) throw new Error('未知转场类型');
  const p = clamp(progress, 0, 1);
  if (p === 0 || (exit.type === 'cut' && p < 1)) return previous;
  if (p === 1) return next;
  const { width, height } = previous, data = new Uint8ClampedArray(previous.data.length), origin = exit.origin ?? [0.5, 0.5];
  const far = Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => Math.hypot(x - origin[0], y - origin[1])));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const nx = x / Math.max(1, width - 1), ny = y / Math.max(1, height - 1);
    let a = ease(p);
    if (exit.type === 'ripple') { const r = Math.hypot(nx - origin[0], ny - origin[1]) / far; a = ease((p * 1.16 - r - 0.08 + Math.sin(r * 28 - p * 12) * Math.sin(Math.PI * p) * 0.02) / 0.08); }
    if (exit.type === 'water') a = ease((p * 1.16 - ny - 0.08 + Math.sin(nx * 22 + p * 8) * Math.sin(Math.PI * p) * 0.035) / 0.08);
    if (exit.type === 'rain') a = ease((p * 1.2 - ny * 0.6 - 0.05 + Math.sin(nx * 34 + p * 10) * Math.sin(Math.PI * p) * 0.05) / 0.1);
    const i = (y * width + x) * 4;
    for (let c = 0; c < 4; c++) data[i + c] = Math.round(mix(previous.data[i + c], next.data[i + c], a));
  }
  return { width, height, data };
}

export function renderTimelineFrame(time, drawScene = renderScene, options = {}) {
  const state = resolveTimeline(time, options.timeline), current = drawScene(state.index, state.local, options);
  if (state.nextIndex === null) return current;
  const next = drawScene(state.nextIndex, 0, options);
  return blendFrames(current, next, state.progress, state.exit);
}

const SCENE_IDS = ['window', 'leave', 'empty', 'turn', 'neon', 'street', 'shatter', 'lesson', 'night', 'dawn', 'path', 'lookback'];

export const SCENE_RENDERERS = Object.freeze(Object.fromEntries(
  SCENE_IDS.map((id, index) => [id, (local, options) => renderScene(index, local, options)]),
));

/** Shared renderer used by the reusable per-scene asset modules. */
export function renderSceneAsset(id, local, options = {}) {
  const index = SCENE_IDS.indexOf(id);
  if (index < 0) throw new Error(`未知场景资产：${id}`);
  const duration = options.duration ?? 6;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('场景 duration 必须为正有限数');
  const { subject = { x: 192, y: 108 }, palette = {}, ...frameOptions } = options;
  if (!Number.isFinite(subject?.x) || !Number.isFinite(subject?.y)) throw new Error('subject.x/y 必须为有限数');
  if (!palette || typeof palette !== 'object' || Array.isArray(palette)) throw new Error('palette 必须为颜色表对象');
  for (const [key, value] of Object.entries(palette)) {
    if (!Array.isArray(value) || value.length < 3 || !value.slice(0, 3).every(Number.isFinite)) throw new Error(`palette.${key} 必须为 RGB/RGBA 数组`);
  }
  const previousPalette = P;
  P = { ...SCENE_PALETTE, ...palette };
  try {
    const seconds = clamp(local, 0, duration) * 6 / duration;
    const zoom = frameOptions.camera?.zoom ?? 1;
    const baseCamera = frameOptions.camera ?? { x: 188 + ease(seconds / 6) * 8 + (index % 3) * 2, y: 106 + ease(seconds / 6) * 4, zoom: 1 + ease(seconds / 6) * 0.05 + (index % 4) * 0.01 };
    const camera = frameOptions.camera ?? { ...baseCamera, x: baseCamera.x - (subject.x - 192) / zoom, y: baseCamera.y - (subject.y - 108) / zoom };
    return renderScene(index, seconds, { ...frameOptions, camera });
  } finally { P = previousPalette; }
}

export function frameOptionsForStoryboard(data) { return { seed: data.project.seed, timeline: { duration: data.project.duration, scenes: data.scenes.map(scene => ({ start: scene.start, end: scene.end, id: scene.id, exit: scene.exit ?? { type: 'dissolve', dur: 0.8 } })) } }; }

export function renderFrame(t, options = {}) {
  if (!options.timeline) return renderTimelineFrame(t, renderScene, { ...options, timeline: { duration: DURATION, scenes: SCENES } });
  const draw = (index, local, opts) => {
    const scene = opts.timeline.scenes[index], renderer = SCENE_RENDERERS[scene.id];
    if (!renderer) throw new Error(`镜头${scene.id}没有注册画法`);
    return renderer(local * 6 / (scene.end - scene.start), opts);
  };
  return renderTimelineFrame(t, draw, options);
}
