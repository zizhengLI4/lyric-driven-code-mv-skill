// 技术检查画面：验证逐帧确定性、像素网格、摄像机、转场和字幕导出。
// 画面刻意使用色块、网格与几何标记，不作为 MV 美术或叙事范例。
import { createTimeline } from './timeline.mjs';
import {
  WIDTH, HEIGHT, CAMERA_LIMITS, FB, seeded, ease, mix, clamp,
  resolveTimeline as coreResolveTimeline,
  blendFrames as coreBlendFrames,
  renderTimelineFrame as coreRenderTimelineFrame,
  frameOptionsForStoryboard as coreFrameOptionsForStoryboard,
} from './frame-core.mjs';

export { WIDTH, HEIGHT, CAMERA_LIMITS, FB, seeded };

export const DURATION = 12;
export const DEFAULT_SEED = 'pixel-render-check-v1';

export const SCENES = Object.freeze([
  Object.freeze({ id: 'send', start: 0, end: 6, objective: '检查色块与网格绘制', action: '色标按时间移动', feedback: '位置可连续观察', outcome: '完成色块和网格检查', exit: Object.freeze({ type: 'ripple', dur: 0.9, origin: Object.freeze([0.55, 0.62]) }) }),
  Object.freeze({ id: 'receive', start: 6, end: 12, objective: '检查标记与边缘覆盖', action: '标记按时间移动', feedback: '边缘和运动可连续观察', outcome: '完成标记与转场检查', exit: Object.freeze({ type: 'cut', dur: 0, origin: Object.freeze([0.55, 0.62]) }) }),
]);

export const CAPTIONS = Object.freeze([
  { start: 0.45, end: 2.8, zh: '技术检查画面：色块与网格', en: 'Render check: color bars and grid.' },
  { start: 3.0, end: 5.0, zh: '检查像素尺度与边缘覆盖', en: 'Check pixel scale and edge coverage.' },
  { start: 6.3, end: 8.5, zh: '技术检查画面：移动标记', en: 'Render check: moving marker.' },
  { start: 8.7, end: 11.7, zh: '检查运动、转场与导出', en: 'Check motion, transition, and export.' },
]);

const DEFAULT_TIMELINE = Object.freeze({ duration: DURATION, scenes: SCENES });
const colors = Object.freeze([
  [226, 90, 72], [241, 173, 67], [230, 215, 102], [105, 176, 121],
  [82, 157, 194], [113, 122, 196], [172, 112, 174], [220, 219, 203],
]);

export function renderScene(index, local, options = {}) {
  const { width = WIDTH, height = HEIGHT, seed = DEFAULT_SEED, camera } = options;
  if (index !== 0 && index !== 1) throw new Error('未知镜头');
  if (!Number.isFinite(local)) throw new Error('镜头 local 必须为有限秒数');

  const time = clamp(local, 0, 6);
  const progress = ease(time / 6);
  const frame = new FB(width, height);
  const view = camera ?? { x: 192, y: 108, zoom: 1 };
  if (![view.x, view.y, view.zoom].every(Number.isFinite)
    || view.x < CAMERA_LIMITS.minX || view.x > CAMERA_LIMITS.maxX
    || view.y < CAMERA_LIMITS.minY || view.y > CAMERA_LIMITS.maxY
    || view.zoom < CAMERA_LIMITS.minZoom || view.zoom > CAMERA_LIMITS.maxZoom) {
    throw new Error('摄像机超出模板范围：x=120–264，y=70–146，zoom=0.75–1.25');
  }
  frame.setCam(view.x, view.y, view.zoom);

  frame.rect(-192, -108, 768, 432, index === 0 ? [28, 35, 48] : [38, 34, 48]);
  for (let x = -192; x <= 576; x += 16) frame.line(x, -108, x, 324, [43, 51, 62]);
  for (let y = -108; y <= 324; y += 16) frame.line(-192, y, 576, y, [43, 51, 62]);

  frame.rect(28, 28, 328, 160, [19, 24, 34]);
  frame.rect(31, 31, 322, 154, [31, 38, 51]);
  for (let bar = 0; bar < colors.length; bar++) {
    const x = 43 + bar * 37;
    frame.rect(x, 49, 25, 82, colors[bar]);
    frame.rect(x, 133, 25, 13, [20, 24, 32]);
    const shade = Math.round(seeded(seed, bar + 1) * 48);
    frame.rect(x + 2, 135, 5, 3, [185 + shade, 185 + shade, 185 + shade]);
    frame.rect(x + 9, 135, 5, 3, [112 + shade, 112 + shade, 112 + shade]);
    frame.rect(x + 16, 135, 5, 3, [48 + shade, 48 + shade, 48 + shade]);
  }

  const markerStart = index === 0 ? 49 : 309;
  const markerX = mix(markerStart, index === 0 ? 309 : 49, progress);
  const markerY = 171 + Math.round(Math.sin(time * Math.PI * 2 / 3) * 5);
  frame.rect(markerX - 5, markerY - 5, 11, 11, [12, 15, 22]);
  frame.rect(markerX - 3, markerY - 3, 7, 7, index === 0 ? [255, 224, 128] : [145, 212, 240]);
  frame.line(48, 171, 336, 171, [134, 142, 156]);
  for (let tick = 0; tick <= 8; tick++) {
    frame.line(48 + tick * 36, 166, 48 + tick * 36, 176, [184, 190, 198]);
  }

  frame.rect(-3, -3, 18, 18, [232, 233, 228]);
  frame.rect(1, 1, 10, 10, [41, 46, 57]);
  frame.rect(364, 201, 18, 18, [232, 233, 228]);
  frame.rect(368, 205, 10, 10, [41, 46, 57]);
  return frame.frame();
}

export function resolveTimeline(time, timeline = DEFAULT_TIMELINE) {
  return coreResolveTimeline(time, timeline);
}

export function blendFrames(previous, next, progress, exit = SCENES[0].exit) {
  return coreBlendFrames(previous, next, progress, exit);
}

export function renderTimelineFrame(time, drawScene = renderScene, options = {}) {
  return coreRenderTimelineFrame(time, drawScene, options.timeline ? options : { ...options, timeline: DEFAULT_TIMELINE });
}

export const SCENE_RENDERERS = Object.freeze({
  send: (local, options) => renderScene(0, local, options),
  receive: (local, options) => renderScene(1, local, options),
});

export function frameOptionsForStoryboard(data) {
  return coreFrameOptionsForStoryboard(data, storyboard => createTimeline(storyboard, Object.keys(SCENE_RENDERERS)));
}

export function renderFrame(time, options = {}) {
  if (!options.timeline) return renderTimelineFrame(time, renderScene, { ...options, timeline: DEFAULT_TIMELINE });
  const drawScene = (index, local, sceneOptions) => {
    const scene = sceneOptions.timeline.scenes[index];
    const renderer = SCENE_RENDERERS[scene.id];
    if (!renderer) throw new Error(`镜头${scene.id}没有注册画法`);
    return renderer(local * 6 / (scene.end - scene.start), sceneOptions);
  };
  return renderTimelineFrame(time, drawScene, options);
}
