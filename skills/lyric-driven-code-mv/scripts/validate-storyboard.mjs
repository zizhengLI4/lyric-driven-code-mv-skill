import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EPSILON = 1e-6;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const unresolved = value => !isText(value) || /^(?:(?:unknown|pending|tbd|unverified)\b|未知|待确认|待核对|待授权)/iu.test(value.trim());
const genericPendingCheck = /^(?:unknown|pending|tbd|unverified|未知|待确认|待核对|待检查|待核听|未确认|未核对|未检查|未核听|没核对|没有核对)[.!?。！？]*$/iu;

function isIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return false;
  if (match[7] !== 'Z') {
    const [offsetHour, offsetMinute] = match[7].slice(1).split(':').map(Number);
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

export function validateStoryboard(data) {
  return analyzeStoryboard(data).errors;
}

export function analyzeStoryboard(data, options = {}) {
  const errors = [];
  const warnings = [];
  const fail = (path, message) => errors.push(`${path}: ${message}`);
  const warn = (path, message) => warnings.push(`${path}: ${message}`);
  const settings = isObject(options) ? options : {};
  const beatToleranceMs = isFiniteNumber(settings.beatToleranceMs) && settings.beatToleranceMs >= 0 ? settings.beatToleranceMs : 80;
  let delivery = settings.delivery === true;
  const deliveryIssue = (path, message) => (delivery ? fail : warn)(path, message);
  const object = (value, path) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      fail(path, '必须为对象');
      return null;
    }
    return value;
  };
  const array = (value, path) => {
    if (!Array.isArray(value)) {
      fail(path, '必须为数组');
      return [];
    }
    return value;
  };
  const text = (value, path) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      fail(path, '必须为非空字符串');
      return false;
    }
    return true;
  };
  const finite = (value, path) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(path, '必须为有限数');
      return false;
    }
    return true;
  };
  const id = (value, path, seen) => {
    if (!text(value, path)) return;
    if (seen?.has(value)) fail(path, `重复标识 ${value}`);
    seen?.add(value);
  };
  const uniqueStrings = (value, path) => {
    const seen = new Set();
    array(value, path).forEach((entry, i) => id(entry, `${path}[${i}]`, seen));
    return seen;
  };

  if (!object(data, 'storyboard')) return { errors, warnings };
  if (data.schemaVersion !== 1) fail('schemaVersion', '必须为 1');
  if (data.timebase !== 'clip') fail('timebase', '必须为 clip；所有时间点使用成片秒');

  const project = object(data.project, 'project') ?? {};
  for (const key of ['fps', 'duration']) {
    if (finite(project[key], `project.${key}`) && project[key] <= 0) fail(`project.${key}`, '必须大于 0');
  }
  if (finite(project.sourceOffset, 'project.sourceOffset') && project.sourceOffset < 0) {
    fail('project.sourceOffset', '必须大于或等于 0；仅记录原曲偏移');
  }
  const dimensions = ['width', 'height', 'virtualWidth', 'virtualHeight'];
  for (const key of dimensions) {
    if (!Number.isInteger(project[key]) || project[key] <= 0) fail(`project.${key}`, '必须为正整数');
  }
  if (dimensions.every(key => Number.isInteger(project[key]) && project[key] > 0)) {
    const scaleX = project.width / project.virtualWidth;
    const scaleY = project.height / project.virtualHeight;
    if (!Number.isInteger(scaleX) || !Number.isInteger(scaleY) || scaleX !== scaleY) {
      fail('project', '输出尺寸的两轴必须为虚拟尺寸的相同正整数倍');
    }
  }
  text(project.seed, 'project.seed');
  const audio = object(project.audio, 'project.audio');
  if (audio) {
    text(audio.path, 'project.audio.path');
    if (audio.sha256 !== undefined && (typeof audio.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(audio.sha256))) fail('project.audio.sha256', '若提供，必须为64位十六进制SHA-256');
    if (!['source', 'clip'].includes(audio.timebase)) fail('project.audio.timebase', '必须为 source 或 clip');
    if (isText(audio.use) && ['publish', 'public', 'commercial'].includes(audio.use.trim().toLowerCase())) delivery = true;
    const audioFields = ['license', 'credit', 'url', 'licenseUrl', 'use'];
    for (const key of [...audioFields, 'provenance']) {
      if (audio[key] !== undefined && typeof audio[key] !== 'string') fail(`project.audio.${key}`, '若提供，必须为字符串');
    }
    const required = audio.provenance === 'original' ? ['license', 'credit', 'use'] : audioFields;
    const missing = required.filter(key => unresolved(audio[key]));
    if (missing.length) {
      if (delivery) {
        for (const key of missing) fail(`project.audio.${key}`, '发布检查需要非空且已明确的记录；unknown/pending 等仍为未解决');
      } else {
        warn('project.audio', `许可记录尚未完成：${missing.join('、')}；发布前核对授权与署名义务`);
      }
    }
  }

  // Optional narrative structure. These fields are descriptive and remain
  // compatible with older storyboards; renderers may choose how to present them.
  if (data.device !== undefined) {
    const device = object(data.device, 'device');
    if (device) {
      text(device.id, 'device.id');
      text(device.name, 'device.name');
      text(device.purpose, 'device.purpose');
      const deviceTypes = ['chat', 'game-system', 'timeline', 'counter', 'chapter-card', 'viewfinder', 'material-stage', 'custom'];
      if (!deviceTypes.includes(device.type)) fail('device.type', `必须为 ${deviceTypes.join('、')} 之一`);
    }
  }

  // sourceOffset is metadata: interval checks always use the unshifted clip clock.
  const duration = project.duration;
  const validDuration = typeof duration === 'number' && Number.isFinite(duration) && duration > 0;
  const validInterval = entry => isObject(entry) && isFiniteNumber(entry.start) && isFiniteNumber(entry.end)
    && entry.start >= 0 && entry.start < entry.end && validDuration && entry.start < duration && entry.end <= duration + EPSILON;
  const intersects = (a, b) => validInterval(a) && validInterval(b) && a.start < b.end && b.start < a.end;
  const interval = (entry, path) => {
    const startValid = finite(entry.start, `${path}.start`);
    const endValid = finite(entry.end, `${path}.end`);
    if (startValid && entry.start < 0) fail(`${path}.start`, '必须大于或等于 0');
    if (startValid && validDuration && entry.start >= duration) fail(`${path}.start`, '必须小于成片 duration');
    if (endValid && validDuration && entry.end > duration + EPSILON) fail(`${path}.end`, '不得超过成片 duration（舍入容差1e-6秒）');
    if (startValid && endValid && entry.start >= entry.end) fail(path, '必须满足 start < end');
  };

  if (data.chapters !== undefined) {
    const chapterIds = new Set();
    let previousChapter = null;
    array(data.chapters, 'chapters').forEach((value, i) => {
      const path = `chapters[${i}]`;
      const chapter = object(value, path);
      if (!chapter) return;
      id(chapter.id, `${path}.id`, chapterIds);
      interval(chapter, path);
      text(chapter.title, `${path}.title`);
      text(chapter.meaning, `${path}.meaning`);
      if (Number.isFinite(chapter.start)) {
        if (i === 0 && Math.abs(chapter.start) > EPSILON) fail(path, '第一个章节必须从 0 开始');
        if (previousChapter && Math.abs(chapter.start - previousChapter.end) > EPSILON) {
          fail(path, '章节之间不得有空洞或重叠（容差 1e-6 秒）');
        }
      }
      previousChapter = chapter;
    });
    const chapters = Array.isArray(data.chapters) ? data.chapters : [];
    const last = chapters[chapters.length - 1];
    if (chapters.length > 0 && isObject(last) && Number.isFinite(last.end) && validDuration && Math.abs(last.end - duration) > EPSILON) {
      fail('chapters', '最后一个章节必须结束于 duration');
    }
  }

  const lyricIds = new Set();
  const lyricsById = new Map();
  array(data.lyrics, 'lyrics').forEach((value, i) => {
    const path = `lyrics[${i}]`;
    const lyric = object(value, path);
    if (!lyric) return;
    id(lyric.id, `${path}.id`, lyricIds);
    interval(lyric, path);
    text(lyric.text, `${path}.text`);
    if (lyric.allowSceneSplit !== undefined && typeof lyric.allowSceneSplit !== 'boolean') fail(`${path}.allowSceneSplit`, '若提供，必须为布尔值');
    if (lyric.splitReason !== undefined && typeof lyric.splitReason !== 'string') fail(`${path}.splitReason`, '若提供，必须为字符串');
    if (typeof lyric.id === 'string') lyricsById.set(lyric.id, lyric);
  });

  const music = object(data.music, 'music') ?? {};
  if (!['illustrative', 'draft', 'verified'].includes(music.status)) {
    fail('music.status', '必须为 illustrative、draft 或 verified');
  }
  const evidence = music.evidence === undefined ? {} : object(music.evidence, 'music.evidence') ?? {};
  for (const key of ['method', 'limitations', 'reviewer', 'reviewedAt']) {
    if (evidence[key] !== undefined && typeof evidence[key] !== 'string') fail(`music.evidence.${key}`, '若提供，必须为字符串');
  }
  if (music.presentationNotice !== undefined && typeof music.presentationNotice !== 'boolean') fail('music.presentationNotice', '若提供，必须为布尔值');
  if (music.status === 'verified' && (!isText(evidence.reviewer) || !isIsoTimestamp(evidence.reviewedAt))) {
    deliveryIssue('music.evidence', 'verified 需要 reviewer 与有效的 ISO reviewedAt（包含时区）；当前核听记录不完整');
  }
  if (music.status === 'illustrative' && music.presentationNotice !== true) {
    deliveryIssue('music.presentationNotice', 'illustrative 是演示节奏；需明确展示演示提示并记录 presentationNotice:true');
  }
  if (music.status === 'draft') {
    const missing = ['method', 'limitations'].filter(key => !isText(evidence[key]));
    if (delivery) {
      for (const key of missing) fail(`music.evidence.${key}`, 'draft 交付需要如实记录分析方法与限制；无需假称已人工核听');
    } else if (missing.length) {
      warn('music.evidence', `draft 分析记录尚缺 ${missing.join('、')}；交付时需说明方法和限制`);
    }
    if (delivery && (music.pendingChecks === undefined || (Array.isArray(music.pendingChecks) && music.pendingChecks.length === 0))) {
      fail('music.pendingChecks', 'draft 交付需要非空待核对清单；每项写成片 start/end 与具体未确认内容 check');
    }
  }
  // Optional for existing storyboards; when supplied, checks remain inspectable in every mode.
  if (music.pendingChecks !== undefined) {
    for (const [i, value] of array(music.pendingChecks, 'music.pendingChecks').entries()) {
      const path = `music.pendingChecks[${i}]`;
      const check = object(value, path);
      if (!check) continue;
      interval(check, path);
      if (text(check.check, `${path}.check`) && genericPendingCheck.test(check.check.trim())) {
        fail(`${path}.check`, '写明具体未确认内容；仅“待核对”或 pending 等占位文本不能形成可检查清单');
      }
    }
  }
  let previousBeat = -Infinity;
  const beats = array(music.beats, 'music.beats');
  let validBeatGrid = true;
  for (const [i, beat] of beats.entries()) {
    const path = `music.beats[${i}]`;
    if (!finite(beat, path)) { validBeatGrid = false; continue; }
    if (beat < 0 || (validDuration && beat >= duration)) { fail(path, '必须位于 [0, duration)'); validBeatGrid = false; }
    if (beat <= previousBeat) { fail(path, '节拍必须严格递增'); validBeatGrid = false; }
    previousBeat = beat;
  }
  array(music.sections, 'music.sections').forEach((value, i) => {
    const path = `music.sections[${i}]`;
    const section = object(value, path);
    if (!section) return;
    id(section.id, `${path}.id`);
    interval(section, path);
  });

  const actorIds = new Set();
  const costumesByActor = new Map();
  array(data.actors, 'actors').forEach((value, i) => {
    const path = `actors[${i}]`;
    const actor = object(value, path);
    if (!actor) return;
    id(actor.id, `${path}.id`, actorIds);
    const costumes = uniqueStrings(actor.costumes, `${path}.costumes`);
    if (typeof actor.id === 'string') costumesByActor.set(actor.id, costumes);
  });
  const props = uniqueStrings(data.props, 'props');

  const sceneIds = new Set();
  const scenes = array(data.scenes, 'scenes');
  if (scenes.length === 0) fail('scenes', '必须覆盖完整成片，不能为空');
  let previousScene = null;
  scenes.forEach((value, i) => {
    const path = `scenes[${i}]`;
    const scene = object(value, path);
    if (!scene) return;
    id(scene.id, `${path}.id`, sceneIds);
    interval(scene, path);
    const hasSceneInterval = validInterval(scene);
    for (const key of ['meaning', 'location', 'objective', 'action', 'feedback', 'outcome']) {
      text(scene[key], `${path}.${key}`);
    }
    if (scene.materialVariant !== undefined) {
      const variant = object(scene.materialVariant, `${path}.materialVariant`);
      if (variant) {
        text(variant.id, `${path}.materialVariant.id`);
        text(variant.label, `${path}.materialVariant.label`);
        text(variant.change, `${path}.materialVariant.change`);
      }
    }
    if (scene.hud !== undefined) {
      const hudIds = new Set();
      const hudTypes = ['counter', 'bar', 'heart', 'status', 'clock', 'badge', 'log', 'checklist', 'axis', 'level', 'score', 'banner'];
      array(scene.hud, `${path}.hud`).forEach((value, j) => {
        const hudPath = `${path}.hud[${j}]`;
        const hud = object(value, hudPath);
        if (!hud) return;
        id(hud.id, `${hudPath}.id`, hudIds);
        text(hud.label, `${hudPath}.label`);
        text(hud.meaning ?? hud.semantic, `${hudPath}.meaning`);
        if (!hudTypes.includes(hud.type)) fail(`${hudPath}.type`, `必须为 ${hudTypes.join('、')} 之一`);
        if (hud.type === 'bar') {
          finite(hud.value, `${hudPath}.value`);
          finite(hud.min, `${hudPath}.min`);
          finite(hud.max, `${hudPath}.max`);
          if (isFiniteNumber(hud.min) && isFiniteNumber(hud.max) && hud.min >= hud.max) fail(hudPath, 'bar 的 min 必须小于 max');
        }
      });
    }
    if (scene.exit === undefined || scene.exitTransition !== undefined) text(scene.exitTransition, `${path}.exitTransition`);
    if (scene.exit !== undefined) {
      const exitPath = `${path}.exit`;
      const exit = object(scene.exit, exitPath);
      if (exit) {
        const types = ['cut', 'dissolve', 'ripple', 'water'];
        if (!types.includes(exit.type)) fail(`${exitPath}.type`, '必须为 cut、dissolve、ripple 或 water');
        if (finite(exit.dur, `${exitPath}.dur`)) {
          if (exit.type === 'cut' && exit.dur !== 0) fail(`${exitPath}.dur`, 'cut 的 dur 必须为 0');
          else if (types.includes(exit.type) && exit.type !== 'cut'
            && (exit.dur <= 0 || (hasSceneInterval && exit.dur >= scene.end - scene.start))) {
            fail(`${exitPath}.dur`, '非 cut 必须满足 0 < dur < 场景长度；转场窗口为 [end-dur, end)');
          }
        }
        if (exit.origin !== undefined && (!Array.isArray(exit.origin) || exit.origin.length !== 2
          || exit.origin.some(coordinate => !isFiniteNumber(coordinate) || coordinate < 0 || coordinate > 1))) {
          fail(`${exitPath}.origin`, '必须为 [0, 1] 范围内的二维坐标');
        }
        if (exit.target !== undefined) text(exit.target, `${exitPath}.target`);
        if (types.includes(exit.type) && exit.type !== 'cut') {
          if (i === scenes.length - 1) {
            if (exit.target !== 'background') fail(`${exitPath}.target`, '末镜非 cut 必须明确 target:"background"');
          } else if (exit.target !== undefined && exit.target !== 'next' && (!isObject(scenes[i + 1]) || exit.target !== scenes[i + 1].id)) {
            fail(`${exitPath}.target`, '普通转场只能指向下一镜（next 或下一镜 id）；目标从 local 0 预卷');
          }
        }
      }
    }
    if (Number.isFinite(scene.start)) {
      if (i === 0 && Math.abs(scene.start) > EPSILON) fail(path, '第一个场景必须从 0 开始');
      if (previousScene && Number.isFinite(previousScene.start) && scene.start < previousScene.start) {
        fail(path, '场景必须按时间排列');
      }
      if (previousScene && Number.isFinite(previousScene.end) && Math.abs(scene.start - previousScene.end) > EPSILON) {
        fail(path, '场景之间不得有空洞或重叠（容差 1e-6 秒）');
      }
    }
    if (i === scenes.length - 1 && Number.isFinite(scene.end) && validDuration && Math.abs(scene.end - duration) > EPSILON) {
      fail(path, '最后一个场景必须结束于 duration');
    }
    previousScene = scene;

    const supportedSceneLyrics = new Set();
    array(scene.lyricIds, `${path}.lyricIds`).forEach((ref, j) => {
      const refPath = `${path}.lyricIds[${j}]`;
      if (!text(ref, refPath)) return;
      const lyric = lyricsById.get(ref);
      if (!lyric) fail(refPath, `不存在歌词 ${ref}`);
      else if (hasSceneInterval && Number.isFinite(lyric.start) && Number.isFinite(lyric.end)
        && !(lyric.start < scene.end && scene.start < lyric.end)) {
        fail(refPath, '歌词区间必须与场景区间相交');
      }
      if (lyric && intersects(lyric, scene)) supportedSceneLyrics.add(ref);
    });
    array(scene.actors, `${path}.actors`).forEach((value, j) => {
      const actorPath = `${path}.actors[${j}]`;
      const actor = object(value, actorPath);
      if (!actor) return;
      const hasId = text(actor.id, `${actorPath}.id`);
      const hasCostume = text(actor.costume, `${actorPath}.costume`);
      if (hasId && !costumesByActor.has(actor.id)) fail(`${actorPath}.id`, `不存在角色 ${actor.id}`);
      else if (hasId && hasCostume && !costumesByActor.get(actor.id).has(actor.costume)) {
        fail(`${actorPath}.costume`, `装束 ${actor.costume} 不属于角色 ${actor.id}`);
      }
    });
    array(scene.props, `${path}.props`).forEach((ref, j) => {
      const refPath = `${path}.props[${j}]`;
      if (text(ref, refPath) && !props.has(ref)) fail(refPath, `不存在道具 ${ref}`);
    });
    let previousEvent = -Infinity;
    array(scene.events, `${path}.events`).forEach((value, j) => {
      const eventPath = `${path}.events[${j}]`;
      const event = object(value, eventPath);
      if (!event) return;
      text(event.action, `${eventPath}.action`);
      const supportedEventLyrics = new Set();
      if (event.lyricIds !== undefined) {
        const seen = new Set();
        array(event.lyricIds, `${eventPath}.lyricIds`).forEach((ref, k) => {
          const refPath = `${eventPath}.lyricIds[${k}]`;
          if (!text(ref, refPath)) return;
          if (seen.has(ref)) fail(refPath, `重复标识 ${ref}`);
          seen.add(ref);
          const lyric = lyricsById.get(ref);
          if (!lyric) fail(refPath, `不存在歌词 ${ref}`);
          else if (hasSceneInterval && validInterval(lyric) && !intersects(lyric, scene)) fail(refPath, '事件歌词必须与所在场景区间相交');
          else if (intersects(lyric, scene)) {
            if (supportedSceneLyrics.has(ref) || (isFiniteNumber(event.at) && event.at >= lyric.start && event.at < lyric.end)) supportedEventLyrics.add(ref);
            else if (isFiniteNumber(event.at)) fail(refPath, '歌词需由场景 lyricIds 支持，或在事件 at 时有效');
          }
        });
      }
      const hasHud = event.hud !== undefined;
      let validHud = false;
      if (hasHud) {
        if (typeof event.hud === 'string') validHud = text(event.hud, `${eventPath}.hud`);
        else if (isObject(event.hud)) validHud = true;
        else fail(`${eventPath}.hud`, '必须为非空字符串或对象');
      }
      for (const key of ['meaning', 'support']) {
        if (event[key] !== undefined && typeof event[key] !== 'string') fail(`${eventPath}.${key}`, '若提供，必须为字符串');
      }
      if (validHud && supportedEventLyrics.size === 0 && supportedSceneLyrics.size === 0 && !isText(event.meaning) && !isText(event.support)) {
        warn(`${eventPath}.hud`, 'HUD 缺少有效歌词依据或 event.meaning/support 叙事说明；间奏 HUD 可记录其目的');
      }
      if (!finite(event.at, `${eventPath}.at`)) return;
      if (validDuration && (event.at < 0 || event.at >= duration)) fail(`${eventPath}.at`, '事件必须位于成片 [0,duration)');
      if (hasSceneInterval && !(event.at >= scene.start && event.at < scene.end)) {
        fail(`${eventPath}.at`, '事件必须位于场景 [start, end)');
      }
      if (event.at < previousEvent) fail(`${eventPath}.at`, '事件必须按 at 非递减排列');
      previousEvent = event.at;
      if (event.sync === 'beat' && hasSceneInterval && event.at >= scene.start && event.at < scene.end && validBeatGrid) {
        if (beats.length === 0) warn(`${eventPath}.at`, 'sync:"beat" 但 music.beats 为空，尚无可核对的节拍网格');
        else {
          const nearest = beats.reduce((closest, beat) => Math.abs(event.at - beat) < Math.abs(event.at - closest) ? beat : closest);
          const offsetMs = (event.at - nearest) * 1000;
          if (Math.abs(offsetMs) > beatToleranceMs + EPSILON) {
            warn(`${eventPath}.at`, `sync:"beat" 偏离最近节拍 ${nearest} 秒：offsetMs=${Number(offsetMs.toFixed(3))}；容差 ${beatToleranceMs} ms`);
          }
        }
      }
    });
  });
  const boundaries = [];
  for (let i = 1; i < scenes.length; i++) {
    if (validInterval(scenes[i - 1]) && validInterval(scenes[i]) && Math.abs(scenes[i - 1].end - scenes[i].start) <= EPSILON) boundaries.push(scenes[i - 1].end);
  }
  if (Array.isArray(data.lyrics)) data.lyrics.forEach((lyric, i) => {
    if (!validInterval(lyric) || !isText(lyric.id) || !isText(lyric.text)) return;
    const crossed = boundaries.filter(boundary => lyric.start < boundary - EPSILON && lyric.end > boundary + EPSILON);
    if (crossed.length && !(lyric.allowSceneSplit === true && isText(lyric.splitReason))) {
      warn(`lyrics[${i}]`, `一条歌词跨主镜头边界 ${crossed.join('、')} 秒；若有意拆分，记录 allowSceneSplit:true 与非空 splitReason`);
    }
  });
  return { errors, warnings };
}

function main(args) {
  const usage = '用法：node validate-storyboard.mjs [--strict] [--delivery] <storyboard.json>\n      node validate-storyboard.mjs --help\n--strict：结构检查中的警告也令退出码为 1，不证明可发布或已核听；--delivery：检查许可记录、音乐证据与 draft 待核对清单';
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  const flags = new Set(args.filter(arg => arg.startsWith('--')));
  const paths = args.filter(arg => !arg.startsWith('--'));
  if (paths.length !== 1 || [...flags].some(flag => !['--strict', '--delivery'].includes(flag))) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  let source;
  try {
    source = readFileSync(paths[0], 'utf8').replace(/^\uFEFF/u, '');
  } catch (error) {
    console.error(`无法读取 JSON 文件：${error.message}`);
    process.exitCode = 1;
    return;
  }
  let data;
  try {
    data = JSON.parse(source);
  } catch (error) {
    console.error(`JSON 格式错误：${error.message}`);
    process.exitCode = 1;
    return;
  }
  const { errors, warnings } = analyzeStoryboard(data, { delivery: flags.has('--delivery') });
  if (warnings.length) console.warn(warnings.map(message => `警告：${message}`).join('\n'));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else if (flags.has('--strict') && warnings.length) {
    console.error(`严格检查未通过：仍有 ${warnings.length} 条警告。`);
    process.exitCode = 1;
  } else {
    console.log('分镜校验通过。');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
