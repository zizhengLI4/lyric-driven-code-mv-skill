// starter 共享纯帧模块：只保留「纸船」这一组演出与 12 秒时间线。
// 引擎（FB / 转场 / 时间线求值 / 数学工具）全部来自 ../frame-core.mjs，模板不再自带副本。
import { createTimeline } from './timeline.mjs';
import {
  WIDTH, HEIGHT, CAMERA_LIMITS, FB, seeded, ease, mix, clamp,
  resolveTimeline as coreResolveTimeline,
  blendFrames as coreBlendFrames,
  renderTimelineFrame as coreRenderTimelineFrame,
  frameOptionsForStoryboard as coreFrameOptionsForStoryboard,
} from '../../frame-core.mjs';

export { WIDTH, HEIGHT, CAMERA_LIMITS, FB, seeded };

export const DURATION = 12;
export const DEFAULT_SEED = 'paper-boat-original-v1';

export const SCENES = Object.freeze([
  Object.freeze({ id: 'send', start: 0, end: 6,
    objective: '把小灯送到对岸', action: '左岸人物将载灯纸船推入水流', feedback: '纸船经过弯流继续前进', outcome: '纸船到达河心',
    exit: Object.freeze({ type: 'ripple', dur: 0.9, origin: Object.freeze([0.55, 0.62]) }) }),
  Object.freeze({ id: 'receive', start: 6, end: 12,
    objective: '等纸船抵达并回应左岸', action: '右岸人物伸手未接到纸船，转为点亮岸灯', feedback: '弯流把纸船推回河心，右岸以灯回应', outcome: '纸船仍未抵达，两岸灯光隔水相望',
    repeatDelta: '同一句再次出现时，新增目标受阻与隔岸回应；船未抵达，人物仍建立联系',
    exit: Object.freeze({ type: 'cut', dur: 0, origin: Object.freeze([0.55, 0.62]) }) }),
]);

export const CAPTIONS = Object.freeze([
  { start: 0.45, end: 2.8, zh: '送一盏小灯到对岸', en: 'Send a small light across.' },
  { start: 3.0, end: 5.0, zh: '水流拐弯，我松开手', en: 'The current turns; I let it go.' },
  { start: 6.3, end: 8.5, zh: '送一盏小灯到对岸', en: 'Send a small light across.' },
  { start: 8.7, end: 11.7, zh: '未能抵达，也有回光', en: 'Still apart, our lights reply.' },
]);

const DEFAULT_TIMELINE = Object.freeze({ duration: DURATION, scenes: SCENES });

// 纸船世界的颜色表。它是模块内的只读常量，渲染时直接读，不做任何全局改写。
const palette = Object.freeze({ sky: [19, 30, 51], deep: [20, 42, 65], water: [29, 67, 86], bank: [42, 61, 63], grass: [68, 88, 77], skin: [222, 171, 133], coatA: [184, 96, 88], coatB: [92, 160, 166], ink: [31, 36, 48], paper: [229, 224, 200], light: [255, 206, 110], bright: [255, 239, 170] });

function world(fb, t, seed, response = 0) {
  // 先实际画满有留边的世界，初始 FB 透明；测试可发现留边不足。
  fb.rect(-192, -108, 768, 432, palette.sky);
  fb.circle(306, 35, 14, [223, 217, 177]); fb.circle(311, 31, 12, palette.sky);
  for (let i = 0; i < 96; i++) {
    const x = -170 + seeded(seed, i * 3) * 720, y = -82 + seeded(seed, i * 3 + 1) * 170;
    fb.rect(x, y, 1 + (i % 13 === 0), 1, [111 + Math.round(40 * Math.sin(t * 1.4 + i)), 136, 155]);
  }
  fb.poly([[-192, 112], [40, 96], [150, 116], [255, 109], [370, 82], [576, 92], [576, 324], [-192, 324]], palette.water);
  for (let i = 0; i < 75; i++) {
    const x = -165 + seeded(seed, 900 + i * 2) * 730, y = 120 + seeded(seed, 901 + i * 2) * 190;
    fb.rect(x + Math.sin(t * 1.3 + i) * 3, y, 4 + seeded(seed, 1400 + i) * 13, 1, i % 4 ? [43, 87, 102] : [72, 112, 119]);
  }
  fb.poly([[-192, 126], [67, 118], [114, 139], [133, 190], [151, 324], [-192, 324]], palette.bank);
  fb.poly([[285, 165], [302, 127], [342, 101], [576, 99], [576, 324], [274, 324]], palette.bank);
  fb.line(-130, 126, 67, 118, palette.grass); fb.line(67, 118, 114, 139, palette.grass);
  fb.line(302, 127, 342, 101, palette.grass); fb.line(342, 101, 550, 100, palette.grass);
  for (const [x, y, flip] of [[55, 112, 1], [332, 103, -1], [-50, 114, 1], [470, 98, -1]]) {
    fb.rect(x, y - 32, 3, 34, [47, 56, 65]);
    fb.line(x + 1, y - 22, x + flip * 11, y - 34, [47, 56, 65]);
    fb.poly([[x - 15, y - 23], [x + 2, y - 51], [x + 20, y - 26]], [48, 67, 69]);
  }
  lamp(fb, 74, 110, 1);
  lamp(fb, 311, 132, response);
  if (response > 0) {
    for (let i = 0; i < 18; i++) {
      const x = mix(83, 310, i / 17), y = 168 + Math.sin(i * 0.63) * 8;
      if (i / 18 < response) fb.rect(x, y, 3 + i % 3, 1, [144, 139, 92]);
    }
  }
}

function lamp(fb, x, y, lit) {
  fb.rect(x, y - 6, 2, 23, palette.ink);
  if (lit > 0.05) fb.circle(x + 1, y - 5, 8, [85, 80, 65]);
  fb.rect(x - 3, y - 9, 8, 9, lit > 0.5 ? palette.light : [89, 92, 92]);
  fb.rect(x - 4, y - 11, 10, 2, palette.ink);
  if (lit > 0.5) fb.rect(x - 2, y - 7, 2, 4, palette.bright);
}

function person(fb, x, y, coat, reach, direction = 1) {
  fb.rect(x - 4, y - 28, 8, 8, palette.skin); fb.rect(x - 5, y - 31, 10, 4, palette.ink);
  fb.rect(x - 5, y - 20, 10, 14, coat);
  fb.rect(x - 5, y - 6, 3, 6, palette.ink); fb.rect(x + 2, y - 6, 3, 6, palette.ink);
  fb.line(x + direction * 4, y - 15, x + direction * (7 + reach * 11), y - 11 + reach * 6, palette.skin);
  fb.line(x + direction * 4, y - 14, x + direction * (7 + reach * 11), y - 10 + reach * 6, palette.skin);
}

function boat(fb, x, y, t) {
  y += Math.sin(t * 3) * 1.4;
  fb.circle(x, y - 5, 7, [94, 97, 75]);
  fb.poly([[x - 12, y], [x + 12, y], [x + 7, y + 5], [x - 6, y + 5]], palette.paper);
  fb.poly([[x - 7, y - 1], [x + 1, y - 11], [x + 1, y - 1]], [242, 237, 211]);
  fb.line(x + 1, y - 10, x + 1, y + 3, [137, 149, 142]);
  fb.rect(x + 3, y - 8, 3, 7, palette.light); fb.pixel(x + 4, y - 9, palette.bright);
  fb.rect(x - 6, y + 9, 14, 1, [136, 137, 92]);
}

export function renderScene(index, local, options = {}) {
  const { width = WIDTH, height = HEIGHT, seed = DEFAULT_SEED, camera } = options;
  if (index !== 0 && index !== 1) throw new Error('未知镜头');
  if (!Number.isFinite(local)) throw new Error('镜头 local 必须为有限秒数');
  const t = clamp(local, 0, 6), fb = new FB(width, height);
  const cam = camera ?? (index === 0 ? { x: 181 + ease(t / 6) * 10, y: 108, zoom: 1 } : { x: 203 + ease(t / 6) * 4, y: 112, zoom: 1.04 });
  if (![cam.x, cam.y, cam.zoom].every(Number.isFinite) || cam.x < CAMERA_LIMITS.minX || cam.x > CAMERA_LIMITS.maxX || cam.y < CAMERA_LIMITS.minY || cam.y > CAMERA_LIMITS.maxY || cam.zoom < CAMERA_LIMITS.minZoom || cam.zoom > CAMERA_LIMITS.maxZoom) throw new Error('摄像机超出模板范围：x=120–264，y=70–146，zoom=0.75–1.25');
  fb.setCam(cam.x, cam.y, cam.zoom);
  const response = index === 1 ? ease((t - 3.4) / 1.2) : 0;
  world(fb, t + index * 6, seed, response);
  if (index === 0) {
    const travel = ease((t - 1.3) / 4.7), reach = 1 - ease((t - 1.3) / 1.2);
    person(fb, 92, 137, palette.coatA, reach);
    person(fb, 308, 171, palette.coatB, 0, -1);
    boat(fb, mix(109, 226, travel), 147 + Math.sin(travel * Math.PI) * 13, t);
  } else {
    person(fb, 92, 137, palette.coatA, ease((t - 4.5) / 0.8));
    const receive = ease(t / 3.3), reach = ease((t - 2.3) / 0.8) * (1 - ease((t - 3.5) / 0.6));
    person(fb, 308, 171, palette.coatB, reach, -1);
    // 纸船始终停在右岸之外；到达之前被弯流推回，不用“接住”镜头偷换结果。
    const setback = ease((t - 3.1) / 1.8);
    boat(fb, mix(226, 259, receive) - setback * 15, mix(147, 160, receive), t + 6);
    if (t >= 3.8) { fb.rect(304, 152, 3, 5, palette.light); fb.pixel(305, 151, palette.bright); }
    if (response > 0.4) {
      // 受阻后的回应：自有岸灯亮起，纸船留河心而两岸产生联系。
      const radius = 6 + (t - 3.4) * 8;
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; fb.rect(312 + Math.cos(a) * radius, 128 + Math.sin(a) * radius, 2, 2, palette.light); }
    }
  }
  return fb.frame();
}

export function resolveTimeline(time, timeline = DEFAULT_TIMELINE) { return coreResolveTimeline(time, timeline); }

export function blendFrames(previous, next, progress, exit = SCENES[0].exit) { return coreBlendFrames(previous, next, progress, exit); }

/** drawScene 接口供已有工程适配；返回同尺寸 RGBA，不改变现有框架。 */
export function renderTimelineFrame(time, drawScene = renderScene, options = {}) {
  return coreRenderTimelineFrame(time, drawScene, options.timeline ? options : { ...options, timeline: DEFAULT_TIMELINE });
}

// 分镜负责时窗，画法只注册在这里。新增scene.id时实现自己的纯帧函数。
export const SCENE_RENDERERS = Object.freeze({ send: (local, options) => renderScene(0, local, options), receive: (local, options) => renderScene(1, local, options) });
export function frameOptionsForStoryboard(data) { return coreFrameOptionsForStoryboard(data, storyboard => createTimeline(storyboard, Object.keys(SCENE_RENDERERS))); }
export function renderFrame(t, options = {}) {
  if (!options.timeline) return renderTimelineFrame(t, renderScene, { ...options, timeline: DEFAULT_TIMELINE });
  const draw = (index, local, opts) => {
    const scene = opts.timeline.scenes[index], renderer = SCENE_RENDERERS[scene.id];
    if (!renderer) throw new Error(`镜头${scene.id}没有注册画法`);
    // 两个内置演出以6秒为设计时长；实际镜头窗口由JSON决定。
    return renderer(local * 6 / (scene.end - scene.start), opts);
  };
  return renderTimelineFrame(t, draw, options);
}