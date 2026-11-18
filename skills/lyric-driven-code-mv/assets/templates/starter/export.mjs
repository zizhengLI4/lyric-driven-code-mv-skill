#!/usr/bin/env node
import { mkdir, mkdtemp, open, readFile, writeFile, rename, readdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { renderFrame, WIDTH, HEIGHT, DURATION, DEFAULT_SEED, CAPTIONS, SCENE_RENDERERS } from './frame.mjs';
import { createTimeline, DEFAULT_CAPTION_STYLE } from './timeline.mjs';
import { encodePNG, inspectPNG } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const HELP = `用法：node export.mjs [参数]
无需 npm 包；需要已有 Node.js、ffmpeg（libx264/libass）和 ffprobe。
默认：12 秒 / 30 fps / 384×216 像素网格 → 1920×1080，原创合成节奏与高分辨率双语字幕。

  --out PATH          MP4 输出路径（默认当前目录 paper-boat-demo.mp4）
  --storyboard PATH   分镜JSON作为时间/字幕/转场/项目参数真源
  --audio PATH        重定位JSON记录的同一音轨，不能替换为另一首歌
  --frame-time N      导出指定成片秒的世界层单帧，无需FFmpeg
  --frame-out PATH    配合--frame-time的PNG路径（384×216，不含ASS字幕）
  --overwrite         明确允许覆盖已有 PNG、MP4 或 .assets.json；默认拒绝覆盖
  --width N           最终输出宽度，正偶数（默认1920）
  --height N          最终输出高度，正偶数（默认1080）
  --fps N             1–120 的整数（默认30）
  --seed TEXT         固定种子（默认 paper-boat-original-v1）
  --frames-dir PATH   保存PNG、配置、节奏WAV及ASS；有此参数仍会编码MP4
  --frames-only       只生成上面的文件，须配 --frames-dir
  --resume            验证配置/每帧尺寸/PNG完整性后复用，须配 --frames-dir
  --ffmpeg PATH       ffmpeg 可执行文件（默认FFMPEG_PATH或ffmpeg）
  --ffprobe PATH      ffprobe 可执行文件（默认FFPROBE_PATH或ffprobe）
  --font TEXT         已安装字体名称（Windows默认 Microsoft YaHei）
  --preview           启动共享纯帧模块的本地Canvas预览，Ctrl+C停止
  --port N            预览端口（默认8765）
  --sfx               合成分镜里的 project.sfx[]/scene.sfx[] 并混入音轨，须配 --storyboard
  --sfx-script PATH   指定音效模块（默认 skill/scripts/sfx.mjs），便于复制 starter 后替换实现
  --sfx-gain N        音效相对音轨的权重，0–2（默认0.85）
  --help              显示帮助

例：node export.mjs --out demo.mp4
    node export.mjs --out check.mp4 --width 640 --height 360 --fps 10
    node export.mjs --frames-dir frames --frames-only
    node export.mjs --frames-dir frames --resume --out demo.mp4
    node export.mjs --storyboard sb.json --sfx --out mv.mp4
未指定分镜时使用原创演示。draft/verified分镜须提供音频；自定义scene.id须注册画法。已有框架工程请按README适配。
`;

export function parseArgs(argv) {
  const c = { out: resolve('paper-boat-demo.mp4'), width: 1920, height: 1080, fps: 30, seed: DEFAULT_SEED, duration: DURATION, storyboard: null, audio: null, provided: [], framesDir: null, resume: false, framesOnly: false, ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg', ffprobe: process.env.FFPROBE_PATH || 'ffprobe', font: process.platform === 'win32' ? 'Microsoft YaHei' : 'sans-serif', preview: false, port: 8765, sfx: false, sfxScript: null, sfxGain: 0.85, overwrite: false, help: false };
  const flags = { '--help': 'help', '--resume': 'resume', '--frames-only': 'framesOnly', '--preview': 'preview', '--sfx': 'sfx', '--overwrite': 'overwrite' };
  const options = { '--out': 'out', '--storyboard': 'storyboard', '--audio': 'audio', '--frame-time': 'frameTime', '--frame-out': 'frameOut', '--width': 'width', '--height': 'height', '--fps': 'fps', '--seed': 'seed', '--frames-dir': 'framesDir', '--ffmpeg': 'ffmpeg', '--ffprobe': 'ffprobe', '--font': 'font', '--port': 'port', '--sfx-script': 'sfxScript', '--sfx-gain': 'sfxGain' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flags[arg]) { c[flags[arg]] = true; continue; }
    const key = options[arg]; if (!key) throw new Error(`未知参数：${arg}`);
    const value = argv[++i]; if (value === undefined || value.startsWith('--') || !value.trim()) throw new Error(`${arg} 缺少值`);
    c[key] = ['width', 'height', 'fps', 'port', 'frameTime', 'sfxGain'].includes(key) ? Number(value) : value;
    c.provided.push(key);
  }
  if (c.help) return c;
  if (!Number.isInteger(c.fps) || c.fps < 1 || c.fps > 120) throw new Error('fps 须为 1–120 的整数');
  for (const key of ['width', 'height']) if (!Number.isInteger(c[key]) || c[key] < 16 || c[key] > 7680 || c[key] % 2) throw new Error(`输出尺寸 ${key} 须为 16–7680 的偶数`);
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) throw new Error('port 须为1–65535的整数');
  if (!Number.isFinite(c.sfxGain) || c.sfxGain < 0 || c.sfxGain > 2) throw new Error('--sfx-gain 须为 0–2 的有限数');
  if (c.sfx && !c.storyboard) throw new Error('--sfx须配--storyboard：音效写在分镜的 project.sfx[] 或 scene.sfx[] 里');
  if (c.sfx && c.framesOnly && !c.framesDir) throw new Error('--sfx 与 --frames-only 须配 --frames-dir');
  if ((c.resume || c.framesOnly) && !c.framesDir) throw new Error('--resume / --frames-only 须配 --frames-dir');
  if (extname(c.out).toLowerCase() !== '.mp4') throw new Error('--out 须使用 .mp4 扩展名');
  if (/[,{};<>`"'\\\r\n]/.test(c.font)) throw new Error('字体名称不能含ASS/CSS控制字符');
  if (c.audio && !c.storyboard) throw new Error('--audio须配--storyboard，以明确音轨时基与音乐证据');
  if ((c.frameTime !== undefined) !== Boolean(c.frameOut)) throw new Error('--frame-time须配--frame-out');
  if (c.frameTime !== undefined) {
    if (!Number.isFinite(c.frameTime) || c.frameTime < 0) throw new Error('--frame-time须为非负有限秒数');
    if (extname(c.frameOut).toLowerCase() !== '.png') throw new Error('--frame-out须为.png');
    if (c.framesDir || c.framesOnly || c.resume || c.preview) throw new Error('单帧参数不能与帧目录/恢复/预览混用');
    c.frameOut = resolve(c.frameOut);
  }
  c.out = resolve(c.out); if (c.framesDir) c.framesDir = resolve(c.framesDir);
  if (c.storyboard) c.storyboard = resolve(c.storyboard); if (c.audio) c.audio = resolve(c.audio);
  if (c.sfxScript) c.sfxScript = resolve(c.sfxScript);
  // image2pipe 编码使用素材目录作为 cwd；先固定显式相对可执行路径。
  for (const key of ['ffmpeg', 'ffprobe']) if (/[\\/]/.test(c[key])) c[key] = resolve(c[key]);
  return c;
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const frameName = i => `frame-${String(i).padStart(6, '0')}.png`;

// —— 音效层 ——
// 静态 import 会让"把 starter 单独复制出去"的用法在加载期就失败，所以按需动态加载。
const sfxModules = new Map();
async function loadSfxModule(c = {}) {
  const modulePath = c.sfxScript || fileURLToPath(new URL('../../../scripts/sfx.mjs', import.meta.url));
  const key = resolve(modulePath);
  if (sfxModules.has(key)) return sfxModules.get(key);
  try {
    const module = await import(pathToFileURL(key).href);
    for (const required of ['collectSfx', 'renderTimeline', 'encodeWav']) {
      if (typeof module[required] !== 'function') throw new Error(`缺少导出 ${required}()`);
    }
    sfxModules.set(key, module);
    return module;
  } catch (error) {
    throw new Error(`--sfx 找不到或无法加载音效模块：${key}。请检查路径，或用 --sfx-script PATH 指定包含 collectSfx/renderTimeline/encodeWav 的模块。${error.message}`);
  }
}

export async function loadProject(c) {
  const result = { ...c, duration: DURATION, timeline: null, sfx: [], draftMark: null, audioPath: null, audioStart: 0, storyboardHash: null, audioHash: null, audioRecord: { path: 'generated:starter-rhythm', timebase: 'clip', provenance: 'original', license: 'Original demo audio generated by the template', credit: 'lyric-driven-code-mv starter', use: 'demo' } };
  if (!c.storyboard) return result;
  let raw, data;
  try { raw = await readFile(c.storyboard); data = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error(`分镜JSON读取失败：${error.message}`); }
  result.timeline = createTimeline(data, Object.keys(SCENE_RENDERERS));
  result.draftMark = { enabled: data.music.status === 'draft' && result.timeline.notice !== '', text: result.timeline.notice || null };
  for (const key of ['fps', 'width', 'height', 'seed']) {
    if (c.provided?.includes(key) && c[key] !== data.project[key]) throw new Error(`CLI ${key}与分镜project.${key}冲突`);
    result[key] = data.project[key];
  }
  result.duration = result.timeline.duration; result.storyboardHash = digest(raw);
  if (c.audio && data.music.status === 'illustrative') throw new Error('illustrative使用模板原创合成演示；接入歌曲请更新project.audio与音乐证据并改为draft/verified');
  // illustrative无显式音轨使用合成演示；其他状态绝不悄悄回退演示音乐。
  if (c.audio || data.music.status !== 'illustrative') {
    result.audioPath = c.audio ?? resolve(dirname(c.storyboard), data.project.audio.path);
    result.audioStart = data.project.audio.timebase === 'source' ? data.project.sourceOffset : 0;
    try { result.audioHash = digest(await readFile(result.audioPath)); }
    catch (error) { throw new Error(`真实音轨读取失败：${error.message}`); }
    const record = data.project.audio, declared = resolve(dirname(c.storyboard), record.path);
    if (record.sha256 !== undefined && (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(record.sha256))) throw new Error('project.audio.sha256须为完整SHA-256');
    if (record.sha256 && record.sha256.toLowerCase() !== result.audioHash) throw new Error('音轨与project.audio.sha256不一致；请核对素材和来源记录');
    const key = path => process.platform === 'win32' ? path.toLowerCase() : path;
    if (c.audio && key(c.audio) !== key(declared) && !record.sha256) {
      let declaredHash; try { declaredHash = digest(await readFile(declared)); } catch { /* 缺失的原路径不能证明重定位的是同一素材。 */ }
      if (declaredHash !== result.audioHash) throw new Error('--audio与project.audio.path素材绑定不一致；换歌请更新JSON路径/来源/许可/证据，重定位缺失素材请先记录其sha256');
    }
    result.audioRecord = structuredClone(record);
  }
  if (c.sfx === true) {
    const { collectSfx } = await loadSfxModule(c);
    result.sfx = collectSfx(data);
    if (result.sfx.length === 0) throw new Error('--sfx 已开启，但分镜里没有 project.sfx[] 或 scene.sfx[]；写法见 references/sfx-and-beat.md');
  }
  return result;
}

const frameOptions = c => ({ seed: c.seed, ...(c.timeline ? { timeline: c.timeline } : {}) });

export async function exportFrame(c, log = console.log) {
  const frameExists = await fileTarget(c.frameOut);
  log(`${frameExists ? '已有单帧目标' : '新建单帧目标'}：${c.frameOut}`);
  if (frameExists && c.overwrite !== true) throw new Error(`默认拒绝覆盖单帧 PNG：${c.frameOut}。影响：替换会改变此图像文件；如确认，请用 --overwrite 后重试。`);
  if (frameExists) log(`影响：将替换单帧 PNG ${c.frameOut}；已由 --overwrite 确认。`);
  c = await loadProject(c);
  if (!c.frameOut || !Number.isFinite(c.frameTime) || c.frameTime < 0 || c.frameTime >= c.duration) throw new Error('--frame-time须位于[0,duration)，并提供--frame-out');
  await mkdir(dirname(c.frameOut), { recursive: true });
  await atomicWrite(c.frameOut, encodePNG(renderFrame(c.frameTime, frameOptions(c))));
  log(`世界层单帧：${c.frameOut}（${WIDTH}×${HEIGHT}，${c.frameTime}成片秒；不含ASS字幕）`);
}

async function renderConfig(c) {
  const sourceHash = digest(Buffer.concat(await Promise.all(['frame.mjs', 'timeline.mjs', 'png.mjs', 'export.mjs'].map(file => readFile(join(here, file))))));
  const config = { version: 2, duration: c.duration ?? DURATION, fps: c.fps, frameWidth: WIDTH, frameHeight: HEIGHT, outputWidth: c.width, outputHeight: c.height, seed: c.seed, font: c.font, sourceHash, storyboardHash: c.storyboardHash ?? null, audioHash: c.audioHash ?? null, audioStart: c.audioStart ?? 0 };
  return { config, fingerprint: digest(JSON.stringify(config)), frameCount: Math.ceil(config.duration * c.fps - 1e-9), frames: {} };
}

async function atomicWrite(path, data) {
  const temporary = `${path}.writing`; await writeFile(temporary, data); await rename(temporary, path);
}

/** 断点恢复不把目录存在当作完成；配置及每个已有 PNG 均重新校验。 */
export async function prepareFrames(c, log = console.log) {
  c = await loadProject(c);
  if (!c.framesDir) throw new Error('prepareFrames 需要 frames-dir');
  await mkdir(c.framesDir, { recursive: true });
  const manifest = await renderConfig(c), manifestPath = join(c.framesDir, 'render-config.json');
  const names = await readdir(c.framesDir);
  if (c.resume) {
    let existing; try { existing = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { throw new Error('恢复失败：找不到有效 render-config.json，请使用新的帧目录'); }
    if (existing.fingerprint !== manifest.fingerprint || JSON.stringify(existing.config) !== JSON.stringify(manifest.config) || existing.frameCount !== manifest.frameCount) throw new Error('恢复失败：配置/源码与帧目录不一致，请使用新目录');
    // 旧记录没有可信逐帧指纹时，下面逐帧重算；不会静默接受已有图片。
    if (existing.frames && typeof existing.frames === 'object' && !Array.isArray(existing.frames)) manifest.frames = existing.frames;
    if (names.some(n => /^frame-\d{6}\.png$/.test(n) && Number(n.slice(6, 12)) >= manifest.frameCount)) throw new Error('恢复失败：帧目录中有超出当前配置的帧');
  } else {
    if (names.some(n => /^frame-\d{6}\.png$/.test(n) || n === 'render-config.json')) throw new Error('帧目录已有导出，请使用 --resume 或新目录');
    await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
  }
  const known = new Set(names);
  for (let i = 0; i < manifest.frameCount; i++) {
    const path = join(c.framesDir, frameName(i));
    let reusable = false;
    if (c.resume && known.has(frameName(i))) {
      const bytes = await readFile(path), dimensions = inspectPNG(bytes), record = manifest.frames[i];
      if (dimensions.width !== WIDTH || dimensions.height !== HEIGHT) throw new Error(`恢复失败：${frameName(i)} 帧尺寸不符`);
      if (record !== undefined) {
        if (!record || record.index !== i || record.name !== frameName(i) || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '')) throw new Error(`恢复失败：${frameName(i)} 帧指纹记录错误`);
        if (digest(bytes) !== record.sha256) throw new Error(`恢复失败：${frameName(i)} 帧哈希不符，可能错置或已被修改`);
        reusable = true;
      }
    }
    if (!reusable) {
      const bytes = encodePNG(renderFrame(i / c.fps, frameOptions(c)));
      await atomicWrite(path, bytes);
      manifest.frames[i] = { index: i, name: frameName(i), sha256: digest(bytes) };
      // 图片先落盘，再原子更新可信记录；中断窗口内无记录的图片会重算。
      await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
    }
    if (i % (c.fps * 2) === 0 || i + 1 === manifest.frameCount) log(`像素帧 ${i + 1}/${manifest.frameCount}`);
  }
  return manifest;
}

/** 原创、无歌词的代码合成节奏，不仿制歌曲，不调用 TTS 或外部音源。 */
export function synthesizeWAV(duration = DURATION) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('合成演示时长须为0–3600秒');
  const rate = 48000, samples = Math.round(duration * rate), wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  const notes = [261.6256, 329.6276, 391.9954, 329.6276, 293.6648, 349.2282, 440, 391.9954];
  for (let i = 0; i < samples; i++) {
    const t = i / rate, beat = Math.floor(t * 2), local = t % 0.5, note = notes[(beat + (t >= duration / 2 ? 2 : 0)) % notes.length];
    const melody = Math.sin(2 * Math.PI * note * t) * Math.exp(-local * 7) * 0.13;
    const kick = Math.sin(2 * Math.PI * (68 * local + 30 * (1 - Math.exp(-local * 18)) / 18)) * Math.exp(-local * 24) * 0.16;
    const chime = Math.sin(2 * Math.PI * note * 2 * t) * Math.exp(-local * 12) * 0.05;
    const fade = Math.min(1, t / 0.04, (duration - t) / 0.35), sample = (melody + kick + chime) * fade;
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + i * 2);
  }
  return wav;
}

function assTime(t) { const cs = Math.round(t * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; }
const assText = text => text.replace(/[{}]/g, '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\N');
const assColor = (hex, opacity = 1) => {
  const rgb = hex.slice(1).toUpperCase();
  const visible = Math.max(0, Math.min(1, opacity));
  const a = Math.round((1 - visible) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `&H${a}${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`;
};

function scenePanelASS(c, timeline, style) {
  const font = style.font || c.font, secondaryFont = style.secondaryFont || font;
  const size = Math.round(c.height * 0.045), secondarySize = Math.round(c.height * 0.028), introSize = Math.round(c.height * 0.025);
  const margin = Math.round(c.height * (style.placement === 'integrated' ? 0.16 : 0.07));
  const x = Math.round(c.width / 2), y = c.height - margin;
  const lines = [
    `Style: LyricPanel,${font},${size},${assColor(style.primary.color)},${assColor(style.primary.color)},${assColor(style.panel.border)},${assColor(style.panel.color, style.panel.alpha)},1,0,0,0,100,100,0,0,3,${Math.max(3, Math.round(c.height * 0.006))},${Math.max(2, Math.round(c.height * 0.004))},2,${Math.round(c.width * 0.08)},${Math.round(c.width * 0.08)},${margin},1`,
    `Style: LyricSecondary,${secondaryFont},${secondarySize},${assColor(style.secondary.color)},${assColor(style.secondary.color)},${assColor(style.secondary.outline)},${assColor(style.panel.color, style.panel.alpha)},0,0,0,0,100,100,0,0,3,${Math.max(2, Math.round(c.height * 0.004))},0,2,${Math.round(c.width * 0.08)},${Math.round(c.width * 0.08)},${margin},1`,
    `Style: ChapterCard,${font},${Math.round(c.height * 0.032)},${assColor(style.panel.accent)},${assColor(style.panel.accent)},${assColor(style.panel.border)},${assColor(style.panel.color, Math.min(0.94, style.panel.alpha + 0.06))},1,0,0,0,100,100,0,0,3,${Math.max(2, Math.round(c.height * 0.004))},0,${style.chapter.position === 'top' ? 7 : 1},${Math.round(c.width * 0.06)},${Math.round(c.width * 0.06)},${Math.round(c.height * 0.08)},1`,
    `Style: PanelNotice,${font},${introSize},${assColor(style.panel.accent)},${assColor(style.panel.accent)},${assColor(style.panel.border)},${assColor(style.panel.color, style.panel.alpha)},0,0,0,0,100,100,0,0,3,${Math.max(2, Math.round(c.height * 0.004))},0,8,${Math.round(c.width * 0.08)},${Math.round(c.width * 0.08)},${Math.round(c.height * 0.06)},1`
  ];
  const dialogue = [];
  if (style.chapter.show) {
    for (const chapter of timeline.chapters ?? []) {
      const end = Math.min(chapter.end, chapter.start + style.chapter.duration, timeline.duration);
      if (end > chapter.start) dialogue.push(`Dialogue: 3,${assTime(chapter.start)},${assTime(end)},ChapterCard,,0,0,0,,${assText(chapter.title)}`);
    }
  }
  if (timeline.notice) dialogue.push(`Dialogue: 1,0:00:00.00,${assTime(timeline.noticeEnd)},PanelNotice,,0,0,0,,${assText(timeline.notice)}`);
  for (const cue of timeline.captions) {
    const english = style.lines > 1 && cue.en ? `\\N{\\rLyricSecondary\\fs${secondarySize}}${assText(cue.en)}` : '';
    dialogue.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},LyricPanel,,0,0,0,,{\\an2\\pos(${x},${y})}${assText(cue.zh)}${english}`);
  }
  if (c.audioPath && c.audioRecord?.provenance !== 'original' && c.audioRecord?.credit?.trim()) {
    const credit = `音乐：${c.audioRecord.credit}${c.audioRecord.license ? `｜${c.audioRecord.license}` : ''}`;
    dialogue.push(`Dialogue: 2,${assTime(Math.max(0, c.duration - 4))},${assTime(c.duration)},PanelNotice,,0,0,0,,{\\an8\\pos(${x},${Math.round(c.height * 0.16)})}${assText(credit)}`);
  }
  return { lines, dialogue };
}

export function createASS(c) {
  const timeline = c.timeline ?? { captions: CAPTIONS, notice: '演示时点 · 原创合成节奏', noticeEnd: 2.2 };
  const captionStyle = timeline.captionStyle ?? DEFAULT_CAPTION_STYLE;
  if (captionStyle.mode === 'scene-panel') {
    const styleInfo = scenePanelASS(c, timeline, captionStyle);
    const header = [
      '[Script Info]', 'Title: 未抵达的灯 · 原创12秒模板', 'ScriptType: v4.00+', `PlayResX: ${c.width}`, `PlayResY: ${c.height}`, 'ScaledBorderAndShadow: yes', 'WrapStyle: 2', '',
      '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      ...styleInfo.lines, ''
    ];
    return [...header, '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...styleInfo.dialogue].join('\n') + '\n';
  }
  const size = Math.round(c.height * 0.041), enSize = Math.round(c.height * 0.029), margin = Math.round(c.height * 0.07), x = Math.round(c.width / 2), y = c.height - margin;
  const introSize = Math.round(c.height * 0.025);
  const font = captionStyle.font || c.font;
  const lines = [
    '[Script Info]', 'Title: 未抵达的灯 · 原创12秒模板', 'ScriptType: v4.00+', `PlayResX: ${c.width}`, `PlayResY: ${c.height}`, 'ScaledBorderAndShadow: yes', 'WrapStyle: 2', '',
    '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${font},${size},&H00F4F5ED,&H00FFFFFF,&H90131B29,&H90131B29,0,0,0,0,100,100,0,0,3,${Math.max(4, Math.round(c.height * 0.009))},0,2,${Math.round(c.width * 0.08)},${Math.round(c.width * 0.08)},${margin},1`,
    `Style: Notice,${c.font},${introSize},&H00E5DEC4,&H00FFFFFF,&H90131B29,&H90131B29,0,0,0,0,100,100,0,0,3,${Math.max(3, Math.round(c.height * 0.006))},0,8,${Math.round(c.width * 0.08)},${Math.round(c.width * 0.08)},${Math.round(c.height * 0.06)},1`, '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  if (timeline.notice) lines.push(`Dialogue: 1,0:00:00.00,${assTime(timeline.noticeEnd)},Notice,,0,0,0,,${assText(timeline.notice)}`);
  // A named style keeps the font family out of the inline ASS override syntax.
  if (captionStyle.secondaryFont) {
    const primary = lines.find(line => line.startsWith('Style: Caption,'));
    lines.splice(lines.indexOf(primary) + 1, 0, primary.replace(`Caption,${font},`, () => `CaptionSecondary,${captionStyle.secondaryFont},`));
  }
  for (const cue of timeline.captions) {
    const secondary = cue.en ? `\\N{${captionStyle.secondaryFont ? '\\rCaptionSecondary' : ''}\\fs${enSize}}${assText(cue.en)}` : '';
    lines.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Caption,,0,0,0,,{\\an2\\pos(${x},${y})}${assText(cue.zh)}${secondary}`);
  }
  if (c.audioPath && c.audioRecord?.provenance !== 'original' && c.audioRecord?.credit?.trim()) {
    const credit = `音乐：${c.audioRecord.credit}${c.audioRecord.license ? `｜${c.audioRecord.license}` : ''}`;
    lines.push(`Dialogue: 2,${assTime(Math.max(0, c.duration - 4))},${assTime(c.duration)},Notice,,0,0,0,,{\\an8\\pos(${x},${Math.round(c.height * 0.16)})}${assText(credit)}`);
  }
  return lines.join('\n') + '\n';
}

export async function assetManifest(c, audioFile) {
  return { schemaVersion: 1, storyboardSha256: c.storyboardHash, musicStatus: c.timeline?.music.status ?? 'illustrative', draftMark: c.draftMark, audio: { declared: c.audioRecord, actualPath: c.audioPath ?? 'generated:starter-rhythm', sourceSha256: c.audioHash, renderedWavSha256: digest(await readFile(audioFile)), sourceStart: c.audioStart, duration: c.duration }, limitation: '哈希证明文件绑定；来源、许可和署名为提交者记录，未验证权利有效。片尾短署名不替代具体许可要求的完整发布说明。' };
}

async function fileTarget(path) {
  try { if (!(await stat(path)).isFile()) throw new Error(`输出目标不是普通文件：${path}`); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

/** 两个文件成对更新；默认不覆盖已有交付，显式 overwrite 后失败仍可回滚。 */
export async function publishOutput(temporaryOut, out, records, move = rename, options = {}) {
  const lockPath = `${out}.publish-lock`;
  let lockHandle;
  try {
    lockHandle = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`另一个发布事务正在进行：${out}（publish lock）`, { cause: error });
    throw error;
  }
  try {
    const targets = [out, `${out}.assets.json`];
    const exists = await Promise.all(targets.map(fileTarget));
    if (exists.some(Boolean) && options.overwrite !== true) {
      throw new Error(`输出已存在，默认拒绝覆盖：${targets.filter((_, i) => exists[i]).join('、')}；如确认覆盖请使用 --overwrite`);
    }
    const staged = await mkdtemp(join(dirname(out), '.mv-publish-'));
    const backups = targets.map((_, i) => join(staged, `previous-${i}`));
    const backed = [], installed = [];
    let preserve = false;
    try {
    const metadata = join(staged, 'assets.json');
    await writeFile(metadata, JSON.stringify(records, null, 2) + '\n');
    for (let i = 0; i < targets.length; i++) if (exists[i]) { await move(targets[i], backups[i]); backed.push(i); }
    const sources = [temporaryOut, metadata];
    for (let i = 0; i < targets.length; i++) { await move(sources[i], targets[i]); installed.push(i); }
  } catch (error) {
    const recoveryErrors = [];
    for (const i of [...installed].reverse()) { try { await rm(targets[i], { force: true }); } catch (e) { recoveryErrors.push(e.message); } }
    for (const i of [...backed].reverse()) { try { await move(backups[i], targets[i]); } catch (e) { recoveryErrors.push(e.message); } }
    if (recoveryErrors.length) {
      preserve = true;
      throw new Error(`发布失败：${error.message}；回滚未完成，保留备份 ${staged}：${recoveryErrors.join('；')}`, { cause: error });
    }
    throw error;
    } finally { if (!preserve) await rm(staged, { recursive: true, force: true }); }
  } finally {
    await lockHandle.close();
    await rm(lockPath, { force: true });
  }
}

function commandOutput(binary, args, label) {
  const result = spawnSync(binary, args, { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${label} 不可用：${result.error?.message ?? result.stderr?.trim() ?? `退出 ${result.status}`}`);
  return result.stdout + result.stderr;
}

export function preflight(c) {
  const filters = commandOutput(c.ffmpeg, ['-hide_banner', '-filters'], `ffmpeg (${c.ffmpeg})`);
  if (!/\bass\s+V->V/.test(filters)) throw new Error('ffmpeg 缺少 libass 字幕过滤器；请使用已有完整版本');
  const encoders = commandOutput(c.ffmpeg, ['-hide_banner', '-encoders'], `ffmpeg (${c.ffmpeg})`);
  if (!/\blibx264\b/.test(encoders) || !/\baac\b/.test(encoders)) throw new Error('ffmpeg 缺少 libx264 或 AAC 编码器');
  commandOutput(c.ffprobe, ['-version'], `ffprobe (${c.ffprobe})`);
}

async function pipeFrames(c, assets, temporaryOut, log) {
  const count = Math.ceil(c.duration * c.fps - 1e-9);
  const args = ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'image2pipe', '-framerate', String(c.fps), '-vcodec', 'png', '-i', 'pipe:0', '-i', 'audio.wav', '-vf', `scale=${c.width}:${c.height}:flags=neighbor,ass=filename=subtitles.ass`, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-t', String(c.duration), '-movflags', '+faststart', temporaryOut];
  const child = spawn(c.ffmpeg, args, { cwd: assets, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '', spawnError = null, pipeError = null;
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-16000); });
  child.on('error', error => { spawnError = error; }); child.stdin.on('error', error => { pipeError = error; });
  const finished = new Promise(resolveResult => child.once('close', (code, signal) => resolveResult({ code, signal })));
  try {
    for (let i = 0; i < count; i++) {
      if (spawnError || pipeError || child.exitCode !== null) throw spawnError ?? pipeError ?? new Error('ffmpeg 提前结束');
      const png = c.framesDir ? await readFile(join(c.framesDir, frameName(i))) : encodePNG(renderFrame(i / c.fps, frameOptions(c)));
      if (!child.stdin.write(png)) await once(child.stdin, 'drain');
      if (i % (c.fps * 2) === 0 || i + 1 === count) log(`PNG管道 ${i + 1}/${count}`);
    }
    child.stdin.end();
    const status = await finished;
    if (status.code !== 0 || spawnError || pipeError) throw new Error(`ffmpeg 编码失败（${status.code ?? status.signal}）：${stderr.trim() || spawnError?.message || pipeError?.message}`);
    if (/Glyph .*not found|failed to find any fallback|fontselect.*failed/i.test(stderr)) throw new Error(`系统字体缺少字幕字符：${stderr.trim()}。请用 --font 指定已有中文字体；模板不会下载字体。`);
  } catch (error) {
    child.stdin.destroy(); if (child.exitCode === null) child.kill(); await finished;
    throw new Error(`PNG导出失败：${error.message}${stderr ? `\n${stderr.trim()}` : ''}`);
  }
}

/**
 * 合成音效轨并混进主音轨：音乐权重 1，音效权重 c.sfxGain。
 * 混音结果覆盖 audio.wav，因此 asset-manifest 的哈希记录的是最终音轨。
 */
export async function mixSfx(c, assets, log = console.log) {
  const { encodeWav, renderTimeline } = await loadSfxModule(c);
  const { pcm, report } = renderTimeline(c.sfx, c.duration);
  const sfxPath = join(assets, 'sfx.wav');
  await atomicWrite(sfxPath, encodeWav(pcm));
  const mixed = join(assets, 'audio-mixed.wav');
  commandOutput(c.ffmpeg, ['-v', 'error', '-y', '-i', join(assets, 'audio.wav'), '-i', sfxPath, '-filter_complex', `[0:a][1:a]amix=inputs=2:duration=first:weights=1 ${c.sfxGain}:normalize=0,alimiter=limit=0.95`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', mixed], '音效混音');
  await rename(mixed, join(assets, 'audio.wav'));
  const clipped = report.clipped.length ? `；${report.clipped.length} 个越界事件被裁在片尾` : '';
  log(`音效 ${report.events} 个（每分钟 ${report.perMinute} 个）已混入音轨，权重 ${c.sfxGain}${clipped}`);
  return report;
}

export async function verifyOutput(c, path) {
  const raw = commandOutput(c.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], 'ffprobe');
  let info; try { info = JSON.parse(raw); } catch { throw new Error('ffprobe 返回了无效JSON'); }
  const video = info.streams?.find(s => s.codec_type === 'video'), audio = info.streams?.find(s => s.codec_type === 'audio');
  const duration = c.duration ?? DURATION;
  if (!video || !audio || video.width !== c.width || video.height !== c.height || video.codec_name !== 'h264' || audio.codec_name !== 'aac' || video.pix_fmt !== 'yuv420p' || Math.abs(Number(info.format?.duration) - duration) > 1 / c.fps + 0.02 || !Number.isFinite(Number(audio.duration)) || Math.abs(Number(audio.duration) - duration) > 0.05) throw new Error('成片验收失败：时长、尺寸或音视频流不匹配');
  commandOutput(c.ffmpeg, ['-v', 'error', '-i', path, '-f', 'null', '-'], 'ffmpeg 全片解码');
  return info;
}

async function assertOutputAvailable(c, log) {
  if (c.framesDir && !c.resume) {
    let entries = [];
    try { entries = await readdir(c.framesDir); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    log(`帧目录目标：${c.framesDir}（非空目录不会覆盖）`);
    if (entries.length) throw new Error(`拒绝写入非空帧目录：${c.framesDir}。影响：可能覆盖或混入现有帧/用户文件（已有项目：${entries.slice(0, 8).join('、')}${entries.length > 8 ? '…' : ''}）；请使用新目录，或核对原工程后使用 --resume。`);
  } else if (c.framesDir && c.resume) {
    log(`帧目录目标：${c.framesDir}；--resume 将校验清单和已有帧，仅复用可信帧并补齐缺失帧。`);
  }
  if (c.framesOnly) return;
  const targets = [c.out, `${c.out}.assets.json`];
  const exists = await Promise.all(targets.map(fileTarget));
  for (const [index, target] of targets.entries()) log(`${exists[index] ? '已有目标文件' : '新建目标文件'}：${target}`);
  if (exists.some(Boolean) && c.overwrite !== true) {
    throw new Error(`默认拒绝覆盖以上目标：${targets.filter((_, i) => exists[i]).join('、')}。影响：会替换已有 MP4 和/或资产清单；如确认，请用 --overwrite 后重试。`);
  }
  if (exists.some(Boolean)) log('影响：若渲染和验收通过，将以新 MP4 和本次资产清单替换上面列出的旧文件；失败时保留旧交付。已由 --overwrite 确认。');
}
export async function exportVideo(c, log = console.log) {
  log(`工具路径：ffmpeg=${c.ffmpeg}；ffprobe=${c.ffprobe}`);
  if (c.sfx) log(`本地音效模块将以当前 Node 进程权限执行：${c.sfxScript || fileURLToPath(new URL('../../../scripts/sfx.mjs', import.meta.url))}`);
  await assertOutputAvailable(c, log);
  c = await loadProject(c);
  preflight(c);
  if (c.audioPath) {
    const info = JSON.parse(commandOutput(c.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', c.audioPath], `源音轨ffprobe (${c.ffprobe})`));
    const audio = info.streams?.find(s => s.codec_type === 'audio');
    const duration = Number(audio?.duration ?? info.format?.duration);
    if (!audio || !Number.isFinite(duration) || duration + 0.02 < c.audioStart + c.duration) throw new Error('源音轨长度不足或没有音频流；请核对时长和sourceOffset');
  }
  let temporaryAssets = null, temporaryOut = null;
  try {
    if (c.framesDir) await prepareFrames(c, log);
    if (!c.framesOnly) await mkdir(dirname(c.out), { recursive: true });
    const assets = c.framesDir ?? (temporaryAssets = await mkdtemp(join(dirname(c.out), '.pixel-mv-assets-')));
    if (c.audioPath) commandOutput(c.ffmpeg, ['-v', 'error', '-y', '-ss', String(c.audioStart), '-i', c.audioPath, '-t', String(c.duration), '-vn', '-ar', '48000', '-c:a', 'pcm_s16le', join(assets, 'audio.wav')], '音轨裁剪');
    else await atomicWrite(join(assets, 'audio.wav'), synthesizeWAV(c.duration));
    if (c.sfx.length) await mixSfx(c, assets, log);
    await atomicWrite(join(assets, 'subtitles.ass'), createASS(c));
    const records = await assetManifest(c, join(assets, 'audio.wav'));
    if (c.framesDir) await atomicWrite(join(assets, 'asset-manifest.json'), JSON.stringify(records, null, 2) + '\n');
    if (c.framesOnly) { log(`已生成可恢复帧目录：${c.framesDir}`); return null; }
    temporaryOut = join(dirname(c.out), `.rendering-${process.pid}-${basename(c.out)}`);
    await pipeFrames(c, assets, temporaryOut, log);
    const info = await verifyOutput(c, temporaryOut);
    if ((await stat(temporaryOut)).size < 1) throw new Error('编码结果为空');
    records.output = { path: c.out, sha256: digest(await readFile(temporaryOut)) };
    await publishOutput(temporaryOut, c.out, records, rename, { overwrite: c.overwrite }); temporaryOut = null;
    log(`完成：${c.out}\n已核对${c.duration}秒、${c.width}×${c.height}、H.264/AAC及全片解码。交付前仍需抽帧查看叙事和字幕。`);
    return info;
  } finally {
    if (temporaryOut) await rm(temporaryOut, { force: true });
    if (temporaryAssets) await rm(temporaryAssets, { recursive: true, force: true });
  }
}

export function createPreviewServer(c) {
  const files = new Map([['/', ['preview.html', 'text/html; charset=utf-8']], ['/preview.html', ['preview.html', 'text/html; charset=utf-8']], ['/frame.mjs', ['frame.mjs', 'text/javascript; charset=utf-8']], ['/timeline.mjs', ['timeline.mjs', 'text/javascript; charset=utf-8']]]);
  return createServer(async (req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (path === '/project.json') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ timeline: c.timeline, duration: c.duration, seed: c.seed })); return; }
    const route = files.get(path);
    if (!route) { res.writeHead(404); res.end('不存在'); return; }
    try { const body = await readFile(join(here, route[0])); res.writeHead(200, { 'Content-Type': route[1], 'Cache-Control': 'no-store' }); res.end(body); }
    catch { res.writeHead(500); res.end('读取失败'); }
  });
}

function preview(c) {
  const server = createPreviewServer(c);
  server.on('error', error => { console.error(`预览服务失败：${error.message}`); process.exitCode = 1; });
  server.listen(c.port, '127.0.0.1', () => console.log(`预览：http://127.0.0.1:${c.port} （Ctrl+C停止；不自动打开浏览器）`));
}

async function main() {
  try { const c = parseArgs(process.argv.slice(2)); if (c.help) console.log(HELP); else if (c.frameOut) await exportFrame(c); else if (c.preview) preview(await loadProject(c)); else await exportVideo(c); }
  catch (error) { console.error(`导出失败：${error.message}`); process.exitCode = 1; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
