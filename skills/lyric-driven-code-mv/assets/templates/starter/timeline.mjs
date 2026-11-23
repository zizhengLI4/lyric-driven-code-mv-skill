// 浏览器与Node共享的执行契约；叙事/授权检查仍由validate-storyboard完成。
const finite = n => typeof n === 'number' && Number.isFinite(n);
const text = s => typeof s === 'string' && s.trim().length > 0;
const object = o => o && typeof o === 'object' && !Array.isArray(o);
const fail = message => { throw new Error(`分镜执行校验：${message}`); };

const COLOR = /^#[0-9a-f]{6}$/i;
const DEFAULT_CAPTION_STYLE = Object.freeze({
  mode: 'bottom',
  placement: 'bottom',
  lines: 2,
  primary: { color: '#F4F5ED', outline: '#131B29', shadow: '#131B29' },
  secondary: { color: '#E5DEC4', outline: '#131B29' },
  panel: { color: '#131B29', alpha: 0.86, border: '#131B29', accent: '#FFD58A' },
  font: '',
  secondaryFont: '',
  chapter: { show: false, position: 'top', duration: 2.4 }
});

function normalizedColor(value, path, fallback) {
  const result = value ?? fallback;
  if (typeof result !== 'string' || !COLOR.test(result)) fail(`${path}须为#RRGGBB颜色`);
  return result.toUpperCase();
}

function normalizeCaptionStyle(raw) {
  if (raw === undefined) return structuredClone(DEFAULT_CAPTION_STYLE);
  if (!object(raw)) fail('captionStyle须为对象');
  const mode = raw.mode ?? 'bottom';
  const placement = raw.placement ?? (mode === 'scene-panel' ? 'integrated' : 'bottom');
  if (!['bottom', 'scene-panel'].includes(mode)) fail('captionStyle.mode须为bottom或scene-panel');
  if (!['bottom', 'integrated'].includes(placement)) fail('captionStyle.placement须为bottom或integrated');

  const lines = raw.lines ?? 2;
  if (!Number.isInteger(lines) || lines < 1 || lines > 2) fail('captionStyle.lines须为1或2');
  for (const key of ['primary', 'secondary', 'panel']) {
    if (raw[key] !== undefined && !object(raw[key])) fail(`captionStyle.${key}须为对象`);
  }
  const primary = object(raw.primary) ? raw.primary : {};
  const secondary = object(raw.secondary) ? raw.secondary : {};
  const panel = object(raw.panel) ? raw.panel : {};
  const alpha = panel.alpha ?? DEFAULT_CAPTION_STYLE.panel.alpha;
  if (!finite(alpha) || alpha < 0 || alpha > 1) fail('captionStyle.panel.alpha须为0–1');

  const chapter = raw.chapter ?? {};
  if (!object(chapter)) fail('captionStyle.chapter须为对象');
  const showChapter = chapter.show ?? false;
  const chapterPosition = chapter.position ?? 'top';
  const chapterDuration = chapter.duration ?? DEFAULT_CAPTION_STYLE.chapter.duration;
  if (typeof showChapter !== 'boolean') fail('captionStyle.chapter.show须为布尔值');
  if (!['top', 'bottom'].includes(chapterPosition)) fail('captionStyle.chapter.position须为top或bottom');
  if (!finite(chapterDuration) || chapterDuration <= 0 || chapterDuration > 10) fail('captionStyle.chapter.duration须为0–10秒');
  for (const key of ['font', 'secondaryFont']) {
    if (raw[key] !== undefined && (typeof raw[key] !== 'string' || /[\r\n,]/.test(raw[key]))) {
      fail(`captionStyle.${key}不能含逗号或换行`);
    }
  }

  return {
    mode,
    placement,
    lines,
    primary: {
      color: normalizedColor(primary.color, 'captionStyle.primary.color', DEFAULT_CAPTION_STYLE.primary.color),
      outline: normalizedColor(primary.outline, 'captionStyle.primary.outline', DEFAULT_CAPTION_STYLE.primary.outline),
      shadow: normalizedColor(primary.shadow, 'captionStyle.primary.shadow', DEFAULT_CAPTION_STYLE.primary.shadow),
    },
    secondary: {
      color: normalizedColor(secondary.color, 'captionStyle.secondary.color', DEFAULT_CAPTION_STYLE.secondary.color),
      outline: normalizedColor(secondary.outline, 'captionStyle.secondary.outline', DEFAULT_CAPTION_STYLE.secondary.outline),
    },
    panel: {
      color: normalizedColor(panel.color, 'captionStyle.panel.color', DEFAULT_CAPTION_STYLE.panel.color),
      alpha,
      border: normalizedColor(panel.border, 'captionStyle.panel.border', DEFAULT_CAPTION_STYLE.panel.border),
      accent: normalizedColor(panel.accent, 'captionStyle.panel.accent', DEFAULT_CAPTION_STYLE.panel.accent),
    },
    font: raw.font ?? '',
    secondaryFont: raw.secondaryFont ?? '',
    chapter: { show: showChapter, position: chapterPosition, duration: chapterDuration },
  };
}

export function createTimeline(data, sceneIds = ['send', 'receive']) {
  if (!object(data) || data.schemaVersion !== 1 || data.timebase !== 'clip') fail('schemaVersion须为1，timebase须为clip');
  const p = data.project;
  if (!object(p) || !finite(p.duration) || p.duration <= 0) fail('project.duration须为正数');
  if (!Number.isInteger(p.fps) || p.fps < 1 || p.fps > 120) fail('project.fps须为1–120整数');
  for (const key of ['width', 'height']) if (!Number.isInteger(p[key]) || p[key] < 16 || p[key] > 7680 || p[key] % 2) fail(`project.${key}须为16–7680偶数`);
  if (p.virtualWidth !== 384 || p.virtualHeight !== 216) fail('本模板画法使用384×216虚拟网格');
  if (p.width / 384 !== p.height / 216 || !Number.isInteger(p.width / 384)) fail('输出尺寸须为虚拟网格的同一整数倍');
  if (!text(p.seed) || !finite(p.sourceOffset) || p.sourceOffset < 0) fail('seed须为非空文本，sourceOffset须为非负数');
  if (p.draftMark !== undefined && typeof p.draftMark !== 'boolean') fail('project.draftMark须为布尔值');
  if (p.draftMarkText !== undefined && !text(p.draftMarkText)) fail('project.draftMarkText须为非空文本');
  if (!object(p.audio) || !['clip', 'source'].includes(p.audio.timebase) || !text(p.audio.path)) fail('audio.path与audio.timebase缺失');
  if (!object(data.music) || !['illustrative', 'draft', 'verified'].includes(data.music.status)) fail('music.status须为illustrative/draft/verified');
  if (!Array.isArray(data.scenes) || !data.scenes.length) fail('scenes须为非空数组');
  const seen = new Set(); let end = 0;
  const scenes = data.scenes.map((scene, i) => {
    if (!object(scene) || !text(scene.id) || seen.has(scene.id)) fail(`scenes[${i}]镜头id缺失或重复`);
    seen.add(scene.id);
    if (!sceneIds.includes(scene.id)) fail(`镜头${scene.id}没有注册画法；请在SCENE_RENDERERS中实现`);
    if (!finite(scene.start) || !finite(scene.end) || Math.abs(scene.start - end) > 1e-6 || scene.end <= scene.start || scene.end > p.duration + 1e-6) fail(`scenes[${i}]必须连续覆盖成片时间`);
    const exit = scene.exit ?? { type: 'cut', dur: 0 };
    if (!object(exit) || !['cut', 'dissolve', 'ripple', 'water'].includes(exit.type) || !finite(exit.dur) || exit.dur < 0 || exit.dur > scene.end - scene.start || (exit.type === 'cut' && exit.dur !== 0) || (exit.type !== 'cut' && exit.dur === 0)) fail(`scenes[${i}].exit无效`);
    if (i === data.scenes.length - 1 && exit.type !== 'cut') fail('末镜必须cut且dur=0');
    if (exit.origin !== undefined && (!Array.isArray(exit.origin) || exit.origin.length !== 2 || !exit.origin.every(n => finite(n) && n >= 0 && n <= 1))) fail(`scenes[${i}].exit.origin须为两个0–1坐标`);
    end = scene.end;
    return { ...scene, exit: { ...exit, ...(exit.origin ? { origin: [...exit.origin] } : {}) } };
  });
  if (Math.abs(end - p.duration) > 1e-6) fail('镜头结尾须等于project.duration');
  if (!Array.isArray(data.lyrics)) fail('lyrics须为数组');
  const cueIds = new Set();
  const captions = data.lyrics.map((cue, i) => {
    if (!object(cue) || !text(cue.id) || cueIds.has(cue.id) || !finite(cue.start) || !finite(cue.end) || cue.start < 0 || cue.start >= p.duration || cue.end <= cue.start || cue.end > p.duration + 1e-6) fail(`lyrics[${i}]id或时间无效`);
    cueIds.add(cue.id);
    const zh = cue.zh ?? cue.text;
    if (!text(zh) || (cue.en !== undefined && typeof cue.en !== 'string')) fail(`lyrics[${i}]须提供text/zh及可选en文本`);
    let words;
    if (cue.words !== undefined) {
      if (!Array.isArray(cue.words) || cue.words.length === 0) fail(`lyrics[${i}].words须为非空数组`);
      else {
        let previousEnd = cue.start;
        let joinedText = '';
        words = cue.words.map((word, wordIndex) => {
          const path = `lyrics[${i}].words[${wordIndex}]`;
          if (!object(word) || !text(word.text) || !finite(word.start) || !finite(word.end)
            || word.start < cue.start || word.end > cue.end || word.end <= word.start || word.start < previousEnd) {
            fail(`${path}须提供歌词区间内按序、不重叠的text/start/end`);
          }
          if (typeof word?.text === 'string') joinedText += word.text;
          if (finite(word?.end) && word.end > previousEnd) previousEnd = word.end;
          return { text: word?.text, start: word?.start, end: word?.end };
        });
        if (joinedText !== zh) fail(`lyrics[${i}].words须按序拼接为可见歌词`);
      }
    }
    return {
      id: cue.id,
      start: cue.start,
      end: Math.min(cue.end, p.duration),
      zh,
      en: cue.en ?? '',
      ...(words ? { words } : {}),
    };
  });
  const status = data.music.status;
  // draft 默认**不**在成片上盖水印。只有显式写 project.draftMark:true 才烧入提示。
  // 理由：成片是给人看的，反复在画面顶部烧一行「草稿」属于干扰；
  // 而"这支片子核对到哪一步"已经由 .mp4.assets.json 的 draftMark/musicStatus
  // 与 music.pendingChecks 如实记录，不需要再往画面上写一遍。
  // illustrative 的演示提示仍然默认显示——那段音乐是模板合成的，性质不同。
  const mark = p.draftMark === true;
  const notice = status === 'illustrative'
    ? (text(data.music.presentationNotice) ? data.music.presentationNotice : '演示时点 · 原创合成节奏')
    : status === 'draft' && mark
      ? (text(p.draftMarkText) ? p.draftMarkText : '草稿 · 待核对落点')
      : '';
  let chapters = [];
  if (data.chapters !== undefined) {
    if (!Array.isArray(data.chapters)) fail('chapters须为数组');
    chapters = data.chapters.map((chapter, i) => {
      if (!object(chapter) || !text(chapter.id) || !text(chapter.title) || !finite(chapter.start) || !finite(chapter.end)
        || chapter.start < 0 || chapter.start >= p.duration || chapter.end <= chapter.start || chapter.end > p.duration + 1e-6) {
        fail(`chapters[${i}]结构或时间无效`);
      }
      return { id: chapter.id, start: chapter.start, end: Math.min(chapter.end, p.duration), title: chapter.title, meaning: chapter.meaning ?? '' };
    });
  }
  return {
    duration: p.duration,
    scenes,
    captions,
    chapters,
    captionStyle: normalizeCaptionStyle(data.captionStyle),
    music: structuredClone(data.music),
    notice,
    noticeEnd: status === 'illustrative' ? Math.min(2.2, p.duration) : p.duration,
  };
}

export function captionSegmentsAtTime(cue, time) {
  if (!finite(time)) fail('歌词字幕求值时间须为有限数');
  if (!Array.isArray(cue?.words)) return null;
  return cue.words.map(word => ({
    text: word.text,
    state: time >= word.end ? 'played' : time >= word.start ? 'active' : 'upcoming',
  }));
}

export { DEFAULT_CAPTION_STYLE, normalizeCaptionStyle };
