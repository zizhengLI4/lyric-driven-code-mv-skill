// special —— Richie Kotzen / Get Up
// 12 镜成片的时间线表与注册表。画法已经拆到同目录的 12 个场景模块，
// 引擎（FB / 转场 / 时间线求值）只有 ../frame-core.mjs 一份；这里不再保存任何画法实现。
import { FB, WIDTH, HEIGHT, CAMERA_LIMITS, clamp, seeded, resolveTimeline, blendFrames, renderTimelineFrame, frameOptionsForStoryboard } from '../frame-core.mjs';
import { SCENE_PALETTE } from './shared.mjs';
import { SCENE_IDS, SCENE_ASSETS, SCENE_RENDERERS as SIX_SECOND_RENDERERS, createSceneById } from './index.mjs';

export { FB, WIDTH, HEIGHT, CAMERA_LIMITS, seeded, SCENE_PALETTE, SCENE_IDS };
export { resolveTimeline, blendFrames, renderTimelineFrame, frameOptionsForStoryboard };

export const DURATION = 90;
export const DEFAULT_SEED = 'special-kotzen-90';

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

/** 12 镜成片的 drawScene：index 只是叙事顺序，画法由 SCENE_IDS[index] 对应的模块提供。 */
export function renderScene(index, local, options = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= SCENE_IDS.length) throw new Error(`未知镜头：${index}`);
  if (!Number.isFinite(local)) throw new Error('镜头 local 必须为有限秒数');
  return SCENE_ASSETS[SCENE_IDS[index]].renderSix(local, options);
}

/** 按 id 注册的镜头渲染器；starter 的 frameOptionsForStoryboard 会读 Object.keys(它)。 */
export const SCENE_RENDERERS = SIX_SECOND_RENDERERS;

/** 复用给单个场景资产的入口：与 createSceneById(id, options).render(local, ...) 等价。 */
export function renderSceneAsset(id, local, options = {}) {
  if (!Object.hasOwn(SCENE_ASSETS, id)) throw new Error(`未知场景资产：${id}`);
  const { duration, subject, palette, ...frameOptions } = options;
  return createSceneById(id, { duration, subject, palette }).render(local, frameOptions);
}

/** 12 镜成片的默认入口：不传 timeline 时用本片的 90 秒时间线。 */
export function renderFrame(t, options = {}) {
  if (!options.timeline) return renderTimelineFrame(t, renderScene, { ...options, timeline: { duration: DURATION, scenes: SCENES } });
  const draw = (index, local, opts) => {
    const scene = opts.timeline.scenes[index], renderer = SCENE_RENDERERS[scene.id];
    if (!renderer) throw new Error(`镜头${scene.id}没有注册画法`);
    return renderer(local * 6 / (scene.end - scene.start), opts);
  };
  return renderTimelineFrame(t, draw, options);
}

// clamp 只在 renderFrame 之外的兼容路径使用；保留导出便于既有调用方。
export { clamp };
