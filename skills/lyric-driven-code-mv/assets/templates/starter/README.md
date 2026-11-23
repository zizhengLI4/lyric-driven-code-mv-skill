# 像素 MV 渲染链路检查模板

这是一个**技术检查夹具**，用于检验纯帧求值、像素摄像机、转场、字幕与导出。画面只有色块、网格和移动标记，双语句子也只是技术检查文案；默认音轨由代码合成，不对应任何真实歌曲或歌词。开头会烧入“渲染链路检查 · 合成节奏”。它不是 MV 样片，也不提供角色、故事或风格参考。开始真实项目时，应先依歌曲、角色和用户提供的风格替换检查画面及文案。

不需要 npm 包、API Key、账号、外部服务或下载字体。需要本机已有 Node.js、ffmpeg（含 libx264、AAC、libass）和 ffprobe。模板不会安装软件。现有 HyperFrames、Remotion、Canvas 或其他框架工程应沿用原工程；通过纯帧接口适配所需能力，不强制替换框架。

复制整个 starter 目录，保留 review-gate.mjs 和 audio-review.mjs。目录是扁平结构，方便网页上传或复制：`frame.mjs` 共享纯帧、`timeline.mjs` 加载与适配分镜、`png.mjs` 内置 PNG 编码、`export.mjs` 导出与本地预览、`preview.html` 浏览器预览、此说明。不要把生成的 MP4、WAV 或 PNG 上传到 skill 仓库。

## 运行

在此模板目录中执行：

```powershell
node export.mjs --help
node export.mjs --out C:\你的输出目录\check.mp4 --width 640 --height 360 --fps 10
node export.mjs --out C:\你的输出目录\render-check.mp4
node export.mjs --preview
```

最后一条仅启动 `http://127.0.0.1:8765`，自行打开即可预览，Ctrl+C 停止；不会自动启动浏览器。不要直接用 `file://` 打开 HTML，浏览器可能阻止模块导入。预览不带声音。真实项目在静帧确认前使用下方的单帧入口，确认后可启动动态预览。

只排查某个成片时点的画面时，可先导出世界层单帧，无需媒体工具：

```powershell
node export.mjs --frame-time 5.55 --frame-out C:\你的输出目录\world-frame.png
```

`--frame-time` 使用成片秒，须在 `[0,duration)`；可与 `--storyboard` 配用。默认输出 384×216 世界层 PNG。加 --frame-final 使用相同 ASS 时间轴与字号输出正式尺寸静帧，需要 FFmpeg/libass。用户确认前可以用它检查字幕。单帧模式不能与预览、帧目录或恢复参数混用。

默认 384×216 像素场景，以最近邻放大至 1920×1080，30 fps，360 帧，12 秒。小尺寸功能检查使用 640×360；正式像素稿建议输出网格的整数倍（如 1920×1080），避免不同宽度的像素列。导出先把 PNG 写入 ffmpeg `image2pipe`，不用把所有帧落盘；字幕在放大后由 ASS 绘制，音轨为 48 kHz 原创 WAV，最终编码 H.264 / yuv420p + AAC。文件编码及验收全部成功后才替换 `--out`。

保留 PNG、中断后恢复：

```powershell
node export.mjs --frames-dir C:\你的输出目录\frames --frames-only
node export.mjs --frames-dir C:\你的输出目录\frames --resume --out C:\你的输出目录\render-check.mp4
```

恢复时参数必须与首次一致，包括 fps、输出尺寸、seed、字体及源码；示例默认参数正好一致。保存的 `render-config.json` 对配置与源码做 SHA-256 指纹，并保存每帧索引、文件名和 PNG 字节 SHA-256。恢复逐帧核对可信哈希、PNG 签名、CRC、解压行和 384×216 尺寸，拒绝同尺寸错置、混用或损坏。缺失帧会重算，已有可信帧复用；旧目录或中断留下的图片若没有逐帧可信指纹会重新生成，不会静默复用。目录已存在不会被视为“已经完成”，更改参数应使用新目录。临时 WAV/ASS 与临时 MP4 在输出路径旁生成并清理；帧目录模式会保留演示 WAV、ASS、PNG 与配置供恢复。

## 纯帧与摄像机

```javascript
import { renderFrame, FB, renderTimelineFrame } from './frame.mjs';
const { width, height, data } = renderFrame(5.55);
// data: Uint8ClampedArray，按行RGBA8，长度 width*height*4。
// 可选：renderFrame(t, { seed, width, height, camera: {x,y,zoom} })。
const fb = new FB().setCam(192, 108, 1);
fb.rect(-192, -108, 768, 432, [19, 30, 51]);
// X(x)、Y(y) 及 rect/line/circle/poly 共享世界→屏幕整数取整。
fb.layer({
  glow: layer => layer.glow(192, 108, 24, [255, 206, 130]),
  subject: layer => layer.circle(192, 108, 8, [255, 239, 190]),
});
```

`FB.layer` 总是先画 `glow`/`underlay`，再画 `subject`/`body`，因此光晕不会盖住主体；其他反光和粒子也应在主体前绘制。`FB.glow(x,y,radius,color,{steps,alpha})` 返回同一个 FB，可与 `layer` 一起复用。

`renderFrame(t)` 仅由绝对秒数、显式 seed 与可选配置决定。每帧重新建立缓冲；随机量按 seed+索引计算，不使用累积 PRNG、帧间缓存、`Date.now()` 或“上一帧状态”。乱序 seek 与先后渲染必须得到相同 RGBA。导出取 `i/fps`，`i=0..359`；`t=12` 只供预览保持最终状态，不额外导出一帧。负时间裁到 0，超出结尾裁到 12，NaN/Infinity 拒绝。

世界矩形留边为 `[-192,576]×[-108,324]`，保证模板规定的摄像机范围：中心 x=120–264、y=70–146、zoom=0.75–1.25。FB 初始透明；世界真正覆盖视野四边，测试能够发现留边不足。自定义镜头越过该范围前，应重新计算世界留边；不要靠清屏隐藏空洞。色块、网格与标记都走 FB 的同一摄像机变换。

`renderScene` 会拒绝超出此摄像机范围的配置。底层 `FB.setCam` 也拒绝非有限坐标、绝对值超过1000000的中心及0.01–64之外的 zoom；图元坐标与半径同样有限并有上限。直线先裁剪再步进，圆只遍历落在视口内的范围，避免极端缩放或巨大半径造成无界循环。

已有工程可把自己的场景接给 `renderTimelineFrame(t, drawScene, options)`。`drawScene(index, local, options)` 返回同尺寸 RGBA；若原框架已能乱序求值、转场和输出，就保留其实现，并按下面时窗契约验收。

## 接入真实歌曲

`--storyboard <json>` 让 JSON 成为时间线与字幕的真源。`project.duration/fps/width/height/seed` 控制输出，`lyrics[].text`（或 `zh`）及可选 `en` 控制字幕，`scenes[].start/end/exit` 控制镜头边界和转场。逐词字幕可在 lyric cue 下加 `words[]`，具体时间与拼接规则见 [时间与分镜](../../../references/storyboard-and-timing.md)。CLI 显式给出与 JSON 冲突的 fps、尺寸或 seed 会失败；先在 JSON 修改这些参数。分镜时间全部为成片秒，`timebase` 固定 `clip`。本模板画法使用384×216虚拟网格，输出尺寸须为同一整数倍。

```powershell
node export.mjs --storyboard C:\你的工程\storyboard.json --frame-time 2.5 --frame-out C:\你的工程\scene-01.png --frame-final
node export.mjs --storyboard C:\你的工程\storyboard.json --review C:\你的工程\visual-review.json --out C:\你的输出\song-mv.mp4
```

用户确认本项目场景和人物后，按[确认记录格式](../../../references/production-review.md)填写 visual-review.json。真实歌曲的帧序列、短片和整曲都读该记录。传 --audio 只用于重定位同一文件。默认混入 project.sfx[] 与 scene.sfx[]，--sfx 用于要求该分镜至少有一条事件。复制到外部项目时，用 --sfx-script 指定 Skill 的 scripts/sfx.mjs 或实际的自定义音效模块。--no-sfx 用于演示分镜的静默技术检查。

两层对齐关系见 [音效层与卡点](../../../references/sfx-and-beat.md)：visual/beat/free 锚点按事件选择，长音效可提前起声；beat 校验检查 `hitAt`，不把波形起点 `at` 误当落点。

音效事件可用 `scripts/verify-sfx.mjs` 按 50 ms RMS 包络检查事件窗口；只提供混音音轨时，输出仅表示观察到瞬变，不能证明瞬变来自 SFX。若提供同起点、同采样率、同长度的 BGM-only 参考音轨，则会额外输出差分候选、双声道 RMS 和真峰值。可加 --sfx-track 指独立音效轨。最终 AAC 与同期原曲、音效轨对照后再实际试听。

```powershell
node ..\..\..\scripts\verify-sfx.mjs --audio C:\你的工程\mixed.wav --reference-audio C:\你的工程\music-only.wav --storyboard C:\你的工程\storyboard.json --window-ms 50 --out C:\你的工程\sfx-evidence.json
```

`project.audio.path` 相对于 JSON 所在目录。`--audio` 仅用于重定位同一素材：它与声明路径一致，或与仍可读取的声明文件SHA-256相同，或匹配预先记录的 `project.audio.sha256`。原路径已失效又没有哈希时会拒绝覆盖；先核对素材并更新JSON。换歌须同时更新路径、来源、许可、署名与音乐证据，不能把原创模板记录套到另一首歌上。

`audio.timebase=source` 时从 `project.sourceOffset` 截取 `project.duration` 秒，`clip` 时从音轨0秒截取。源音轨长度不足直接失败。`illustrative` 使用模板原创合成节奏并拒绝显式音轨；真实音轨请改为 `draft/verified`，缺文件不能回退到演示音乐。`illustrative` 自动显示演示提示。**`draft` 默认不往画面烧任何提示**——成片是给人看的，反复在顶部盖一行「草稿」属于干扰；核对到哪一步由 `.mp4.assets.json` 的 `musicStatus` / `draftMark` 与 `music.pendingChecks` 如实记录。需要成片内可见的草稿提示时显式写 `project.draftMark:true`，文案用 `project.draftMarkText` 改；写 `false` 与不写等价。`verified` 按分镜提供的证据记录核对结果。

每次MP4导出生成同路径 `.mp4.assets.json`，保存声明的来源/许可、实际音轨与裁剪WAV哈希、裁切起点、分镜及输出哈希。帧目录另保留 `asset-manifest.json`。外部非 `original` 音轨有 `credit` 时，在最后最多4秒烧入“音乐：署名｜许可”短署名；完整来源、许可链接与修改说明保留在记录中，按具体许可补到发布说明或片尾并检查可读性。记录完整和哈希相同都不证明许可有效。

`SCENE_RENDERERS[scene.id]` 是唯一画法注册表。内置的 `send` 与 `receive` 是既有示例分镜兼容 ID，对应的画面仅用于检查时间求值和转场，不代表故事或美术方向。真实项目应为实际 `scene.id` 实现画法。新 ID 缺画法会失败；JSON 可以调整时间，不能自动产生场景内容。完整分镜仍先用 `validate-storyboard.mjs --delivery` 校验叙事、事件、授权与音乐证据；导出另用自包含 `timeline.mjs` 校验实际可执行字段，复制模板后也能独立运行。

本 skill 中另有 [12 个场景资产](../../scenes/README.md)，为 `window/leave/empty/turn/neon/street/shatter/lesson/night/dawn/path/lookback` 分别提供画法工厂；每个都可传入 `duration`、主体取景位置 `subject:{x,y}` 和颜色名到 RGB 的 `palette` 覆盖。`scripts/lrc.mjs --lrc song.lrc --offset 12 --storyboard storyboard.json` 会转换成 `lyrics[]`，推算结束时点，并为跨镜歌词生成 `allowSceneSplit`；`scripts/new-storyboard.mjs --preset narrative-12 --duration 90 --lyrics lyrics.json` 生成可填写的12镜骨架。

starter 当前实现通用分镜规范的执行子集：末镜仅支持 `exit:{type:"cut",dur:0}`。通用规范允许的末镜 `target:"background"` 转场需由现有框架或自定义渲染适配实现；通用分镜校验通过后，仍需满足 starter 的执行范围。

预览和导出读取同一份已加载 JSON；修改文件后重启预览。`qa.mjs --storyboard` 会调用模块的 `frameOptionsForStoryboard(data)`，将同一时间线与 seed 传入像素检查；另对实际尺寸不少于4096像素的抽样帧检查主体估算占比低于0.5%、平均亮度低于30/255、单色超过60%，提供 `subjectMaskAt()` 的模块可更精确测主体。提示用于筛查构图，不代替人工抽帧。恢复指纹含 JSON、音频内容、sourceOffset 和源码，修改任何一项须使用新帧目录。`FFMPEG_PATH` / `FFPROBE_PATH` 可配置已有工具路径。

## 两镜与转场

前 6 秒检查色块、网格与标记；后 6 秒反向移动标记并沿用同一调色板。此段只确认帧随时间变化、转场衔接和边缘覆盖，不演示歌词故事。

```javascript
exit: { type: 'ripple', dur: 0.9, origin: [0.55, 0.62] }
// type 可为 dissolve / ripple / water / cut；cut 的 dur 必须为0。
```

前镜出镜窗口严格为 `[end-dur,end)`，本例 `[5.1,6)`。在窗口内前镜仍以当前位置 `local=t-start` 求值；下一镜固定 `local=0` 作为静态预卷。转场占前镜尾部，不能额外增加 0.9 秒，也不能令下一镜动作偷跑。6 秒时切换至下一镜第0秒，12秒结束。进度≤0完整前镜，≥1完整后镜；末镜是 `cut,dur:0`，没有不存在的第三镜，也没有未解释的黑场。`origin` 为视口归一化坐标，ripple 从指定点扩散；water 从上向下带波纹，dissolve 做混合。

## 字幕与验收

技术检查文案保存在 `CAPTIONS`；指定分镜时从 `lyrics[]` 读取，中文与英文均由 JSON 提供。导出 ASS 的 `PlayResX/Y` 等于最终输出尺寸，最近邻放大画面后才加字幕。底部双语字幕保留约7%下边距、8%左右安全区，带暗板；音乐状态提示在上部安全区。不要先在384网格画中文后一起放大。

没有 `words[]` 时继续整句字幕。提供词级时间时，预览与 ASS 导出在整句始终可见的前提下逐词切换颜色；词间空隙不推进高亮，导出会拒绝百分秒量化成零长的词。LRC 转换器仍只生成整句 cue，不会自动推导词界；准确歌词同步须基于实际音频校对。

Windows 默认使用已有 `Microsoft YaHei`；可通过 `--font "已有字体名称"` 指定本机字体。浏览器与 ffmpeg 的字体选择和排版可能随系统变化，模板不下载字体。导出检测到缺字会失败并提示换用已安装字体，交付字幕以成片为准。

### 像素歌词面板

分镜顶层可以加入 `captionStyle`，把歌词做成参考像素游戏视频里的画面内 UI：

```json
"captionStyle": {
  "mode": "scene-panel",
  "placement": "integrated",
  "lines": 2,
  "primary": { "color": "#FFF1D6", "outline": "#E56B7A", "shadow": "#24152B" },
  "secondary": { "color": "#F3C8C7", "outline": "#24152B" },
  "panel": { "color": "#24152B", "alpha": 0.88, "border": "#F0A06D", "accent": "#FFD58A" },
  "chapter": { "show": true, "position": "top", "duration": 2.4 }
}
```

`mode:"scene-panel"` 会同时改变浏览器预览和 ASS 导出的歌词层：主歌词暖白、辅助行淡色、彩色描边、深色像素面板和角标装饰。`chapter.show` 会把 `chapters[].title` 显示为章节牌。未提供 `captionStyle` 时保留普通底部双语字幕，旧分镜兼容；该配置只改变视觉呈现，不会替代歌词校对或关键卡点确认。

导出自动用 ffprobe 核对时长、尺寸、实际帧率、H.264/AAC 及像素格式，并用 ffmpeg 解码全片。技术检查时看开头提示、转场边界、移动标记和字幕暗板。真实项目另外按[逐镜审片方法](../../../references/production-review.md)看最终 MP4，核素材清单里的确认记录和提示音。

```powershell
ffprobe -v error -show_format -show_streams -of json C:\你的输出目录\render-check.mp4
ffmpeg -v error -i C:\你的输出目录\render-check.mp4 -f null -
ffmpeg -y -ss 5.55 -i C:\你的输出目录\render-check.mp4 -frames:v 1 C:\你的输出目录\transition.png
ffmpeg -y -ss 11.9 -i C:\你的输出目录\render-check.mp4 -frames:v 1 C:\你的输出目录\ending.png
```


`frame.mjs` 与 `frame-core.mjs` 同目录，复制本目录即可独立运行 `export.mjs --help`。

可选 Remotion 驱动沿用此入口，传 --renderer remotion。安装、Studio、旧工具调用及正式导出参见 [Remotion 制作与旧工具接入](../../../references/remotion-mv.md)。
