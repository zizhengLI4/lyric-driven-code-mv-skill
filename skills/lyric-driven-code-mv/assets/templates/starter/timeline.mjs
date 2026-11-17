// 浏览器与Node共享的执行契约；叙事/授权检查仍由validate-storyboard完成。
const finite = n => typeof n === 'number' && Number.isFinite(n);
const text = s => typeof s === 'string' && s.trim().length > 0;
const object = o => o && typeof o === 'object' && !Array.isArray(o);
const fail = message => { throw new Error(`分镜执行校验：${message}`); };

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
    return { id: cue.id, start: cue.start, end: Math.min(cue.end, p.duration), zh, en: cue.en ?? '' };
  });
  const status = data.music.status;
  const notice = status === 'illustrative' ? (text(data.music.presentationNotice) ? data.music.presentationNotice : '演示时点 · 原创合成节奏') : status === 'draft' ? (p.draftMark === false ? '' : (text(p.draftMarkText) ? p.draftMarkText : '草稿 · 待核对落点')) : '';
  return { duration: p.duration, scenes, captions, music: structuredClone(data.music), notice, noticeEnd: status === 'illustrative' ? Math.min(2.2, p.duration) : p.duration };
}
