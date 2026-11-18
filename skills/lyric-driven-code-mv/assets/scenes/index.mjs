// 12 个场景资产的薄索引：只汇总「有哪些场景」，画法各自留在自己的模块里。
// 注册进 starter 或别处时从这里取；不要再回到「下标数组 + DRAW 查表」的耦合方式。
import { createWindowScene } from './window.mjs';
import { createLeaveScene } from './leave.mjs';
import { createEmptyScene } from './empty.mjs';
import { createTurnScene } from './turn.mjs';
import { createNeonScene } from './neon.mjs';
import { createStreetScene } from './street.mjs';
import { createShatterScene } from './shatter.mjs';
import { createLessonScene } from './lesson.mjs';
import { createNightScene } from './night.mjs';
import { createDawnScene } from './dawn.mjs';
import { createPathScene } from './path.mjs';
import { createLookbackScene } from './lookback.mjs';

/** 每个 id 对应一个真文件；顺序即 12 镜的叙事顺序。 */
export const SCENE_FACTORIES = Object.freeze({
  window: createWindowScene,
  leave: createLeaveScene,
  empty: createEmptyScene,
  turn: createTurnScene,
  neon: createNeonScene,
  street: createStreetScene,
  shatter: createShatterScene,
  lesson: createLessonScene,
  night: createNightScene,
  dawn: createDawnScene,
  path: createPathScene,
  lookback: createLookbackScene,
});

export const SCENE_IDS = Object.freeze(Object.keys(SCENE_FACTORIES));

export function createSceneById(id, options = {}) {
  const factory = SCENE_FACTORIES[id];
  if (!factory) throw new Error(`未知场景资产：${id}`);
  return factory(options);
}

/** 默认参数的 12 个资产实例（引擎取景下与既有的 12 镜成片一致）。 */
export const SCENE_ASSETS = Object.freeze(Object.fromEntries(SCENE_IDS.map(id => [id, SCENE_FACTORIES[id]()])));

/**
 * 成片用的镜头渲染器：local 以 6 秒为设计时长（renderTimelineFrame 的约定），
 * 与旧 renderScene(index, local) 逐像素等价，改资产 duration 也不影响这条路径。
 */
export function sixSecondRenderer(asset) {
  if (!asset || typeof asset.renderSix !== 'function') throw new Error('需要场景资产实例');
  return (local, options) => asset.renderSix(local, options);
}

export const SCENE_RENDERERS = Object.freeze(Object.fromEntries(SCENE_IDS.map(id => [id, sixSecondRenderer(SCENE_ASSETS[id])])));