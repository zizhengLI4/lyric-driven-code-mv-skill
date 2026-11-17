# 从零做出一支歌词驱动代码 MV

给**没写过视频代码、但会复制粘贴命令**的人。

跟着走一遍，你会得到一条能播的 `mp4`：有画面、有音乐、有字幕，人物在按歌词做动作。
第一次约 1.5 小时（大半花在装依赖），第二次 30 分钟。

> 本文每条命令都在 Windows PowerShell + Node v24.16 + ffmpeg 9.0.2 实测跑过。
> 文中所有耗时、帧数、BPM、偏差毫秒都是真实运行结果，不是示意值。
>
> 这份文档只做一件事：把散在 README、`SKILL.md`、参考文档和 starter README
> 里的东西，按"新手第一次要动手的顺序"串成一条路，并把每一步的**期望输出**和**常见失败**写清楚。

---

## 目录

- [0. 这东西是什么](#0-这东西是什么)
- [1. 装依赖](#1-装依赖)
- [2. 拿到仓库并装 skill](#2-拿到仓库并装-skill)
- [3. 跑通那 12 秒](#3-跑通那-12-秒)
- [4. 看懂那 12 秒怎么来的](#4-看懂那-12-秒怎么来的)
- [5. 接入你自己的歌](#5-接入你自己的歌)
- [6. 让机器帮你找拍点](#6-让机器帮你找拍点)
- [7. 三档校验](#7-三档校验)
- [8. 断点续渲](#8-断点续渲)
- [9. 验收](#9-验收)
- [10. 出错怎么办](#10-出错怎么办)
- [11. 交付清单](#11-交付清单)
- [附：从 12 秒做到整首](#附从-12-秒做到整首)

---

## 0. 这东西是什么

一句话：**歌词决定画什么，音乐决定何时强调。**

不是频谱可视化，不是文字跟着鼓点跳。是让歌里的一句话变成一个**没做成、但有了回应**的小任务：

```
字幕：「送一盏小灯到对岸」
目标：把载灯的纸船送到对岸
行动：左岸人物推船下水
反馈：水流拐弯，船漂到河心；右岸伸手接不到
结果：船没抵达，但右岸点亮自己的灯回应
```

观众看到的是叙事，不是动效。这就是"歌词呼应"。

工程只有三样东西：

| 东西 | 是什么 | 谁写 |
|---|---|---|
| `storyboard.json` | 分镜：每镜讲什么、什么时间发生什么、字幕说什么 | **你**（复制模板改） |
| `frame.mjs` | 把「第几秒」算成一张 384×216 的画面 | 你（改现成模板） |
| `export.mjs` | 把画面 + 音轨 + 字幕变成 mp4 | 不用改 |

**唯一的核心约束**：任何一帧只能由「当前是第几秒」算出来，不许记上一帧长什么样。
这样你才能随时跳帧排错、改一处不用从头渲、两台机器渲出一模一样。

---

## 1. 装依赖

### 1.1 先看你有什么

```powershell
node --version
ffmpeg -version
ffprobe -version
```

三条都有版本号就跳到 [第 2 步](#2-拿到仓库并装-skill)。需要 Node ≥ 18 和任何近几年的 ffmpeg。

### 1.2 装

**Windows**（装完**关掉 PowerShell 再重开**，否则 PATH 不生效）：

```powershell
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg
```

**macOS：**

```bash
brew install node ffmpeg
```

**Linux（Debian / Ubuntu）：**

```bash
sudo apt update && sudo apt install -y nodejs ffmpeg
```

### 1.3 必须确认 ffmpeg 带这三个东西

这是最容易翻车的一步——很多人装的是精简版 ffmpeg，渲染到字幕那一步才炸：

```powershell
ffmpeg -hide_banner -encoders 2>&1 | Select-String 'libx264|aac'
ffmpeg -hide_banner -filters  2>&1 | Select-String 'ass'
```

**期望看到 `libx264`、`aac`、`ass` 三项都在。**

- 缺 `libx264` 或 `aac` → 装完整版 ffmpeg
- 缺 `ass` → 字幕这一步会直接失败，必须换完整版

> 本项目**不需要** `npm install`、不需要 API Key、不需要账号、不需要下载字体。
> 模板零第三方依赖，只用 Node 内置模块 + 本机 ffmpeg + 本机已装的字体。

---

## 2. 拿到仓库并装 skill

```powershell
git clone https://github.com/zizhengLI4/lyric-driven-code-mv-skill.git
cd lyric-driven-code-mv-skill
```

装进 Codex（可选，但这样 AI 才会自动用上）：

```powershell
$skillRoot = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'skills' } else { Join-Path $env:USERPROFILE '.codex/skills' }
New-Item -ItemType Directory -Path $skillRoot -Force | Out-Null
$target = Join-Path $skillRoot 'lyric-driven-code-mv'
if (Test-Path -LiteralPath $target) { throw '同名 skill 已存在，先检查内容再合并。' }
Copy-Item -LiteralPath './skills/lyric-driven-code-mv' -Destination $target -Recurse
```

**后面所有命令都在仓库根目录运行。**

---

## 3. 跑通那 12 秒

### 3.1 先跑默认演示（不碰任何文件）

```powershell
node skills/lyric-driven-code-mv/assets/templates/starter/export.mjs --out "$PWD\work\demo.mp4"
```

**期望输出**（实测 2.8 秒）：

```
PNG管道 1/360
...
PNG管道 360/360
完成：...\work\demo.mp4
已核对12秒、1920×1080、H.264/AAC及全片解码。交付前仍需抽帧查看叙事和字幕。
```

打开 `work/demo.mp4` 看一遍。**你现在已经有一条完整的片了。**

### 3.2 排错专用：只渲一帧（0.1 秒，不需要 ffmpeg）

改画面时不要每次渲全片：

```powershell
node skills/lyric-driven-code-mv/assets/templates/starter/export.mjs `
  --frame-time 5.55 --frame-out "$PWD\work\world-555.png"
```

**期望输出**（实测 0.1 秒）：

```
世界层单帧：...\work\world-555.png（384×216，5.55成片秒；不含ASS字幕）
```

导出的是 384×216 世界层，**不含字幕**——检查字幕必须看 MP4 的抽帧。
`--frame-time` 用成片秒，必须落在 `[0, duration)` 内。

### 3.3 快跑检查（改完代码时用）

```powershell
node skills/lyric-driven-code-mv/assets/templates/starter/export.mjs `
  --out "$PWD\work\check-fast.mp4" --width 640 --height 360 --fps 10
```

小尺寸只用来确认链路通，**不是成片**。真正交付用默认参数。

### 3.4 确定性检查

```powershell
node skills/lyric-driven-code-mv/scripts/qa.mjs `
  skills/lyric-driven-code-mv/assets/templates/starter/frame.mjs `
  --duration 12 --fps 30 --out work/qa.json
```

**期望输出：**

```
确定性检查 pass：26 个时间点，104 次渲染，0 处不一致
```

它按**顺序、重复、倒序、随机**四种顺序各渲同一批帧，比较像素哈希。
0 处不一致，说明你的时间求值是纯函数——跳帧预览、断点续渲都不会错位。

---

## 4. 看懂那 12 秒怎么来的

打开 `skills/lyric-driven-code-mv/assets/templates/starter/frame.mjs`，只看三处。

### 4.1 世界尺寸与摄像机（第 2–6 行）

```javascript
export const WIDTH = 384;
export const HEIGHT = 216;
export const DURATION = 12;
export const DEFAULT_SEED = 'paper-boat-original-v1';
export const CAMERA_LIMITS = Object.freeze({ minX: 120, maxX: 264, minY: 70, maxY: 146, minZoom: 0.75, maxZoom: 1.25 });
```

384×216 被最近邻放大 5 倍成 1920×1080。**画在这层，绝不在这层写中文**——会变成砖块。

`CAMERA_LIMITS` 是摄像机允许的活动范围。场景超出它，`renderScene` 直接抛错，
而不是给你一条露黑边的片。这是好事：**不要靠黑色清屏隐藏空洞。**

### 4.2 画法注册表

`SCENE_RENDERERS[scene.id]` 是唯一的画法注册表，内置 `send` 和 `receive`。
**分镜里出现新的 `scene.id` 但没注册画法 → 直接失败。** 报错会告诉你缺哪个。

两个内置演出的动作节奏按**镜头局部时长归一化**，所以改镜头时窗会改变动作快慢。
这是设计上的取舍：JSON 能调时间，但不能凭空产生新的人物动作，新动作要你自己写画法。

### 4.3 字幕

指定分镜时，字幕从 `lyrics[].text`（或 `zh`）和可选的 `en` 读取。
字幕在**放大之后**由 ffmpeg 的 ASS 滤镜绘制，所以是清晰的高分辨率文字，带暗板。

Windows 默认用 `Microsoft YaHei`，可用 `--font "已有字体名称"` 指定。
**导出检测到缺字会失败并提示换字体**，不会静默给你一堆方框。

---

## 5. 接入你自己的歌

新版最省事的地方：**`storyboard.json` 是时间线、字幕、转场、项目参数的真源**，
你不再需要手改 `frame.mjs` 里的常量。

### 5.1 准备音频

```powershell
ffmpeg -v error -y -ss 37.2 -t 12 -i "你的歌.mp3" -ac 2 -ar 48000 -c:a pcm_s16le work/song.wav
```

裁过就记 `"timebase": "clip"` 配 `sourceOffset: 0`；
没裁就记 `"sourceOffset": 37.2` 配 `"timebase": "source"`。**两种只选一种，不要偏移两次。**

### 5.2 改分镜里的音频与许可

```json
"project": {
  "duration": 12, "fps": 30, "sourceOffset": 0,
  "width": 1920, "height": 1080,
  "virtualWidth": 384, "virtualHeight": 216,
  "seed": "paper-boat-original-v1",
  "audio": {
    "path": "song.wav", "timebase": "clip",
    "provenance": "external",
    "license": "CC BY 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "url": "https://example.com/track-page",
    "credit": "曲名 / 作者",
    "use": "music-video"
  }
}
```

`project.audio.path` **相对于 JSON 所在目录**。

### 5.3 改音乐证据状态

```json
"music": {
  "status": "draft",
  "evidence": {
    "method": "analyze-audio.mjs 离线候选（BPM/相位/能量），歌词时点手写",
    "limitations": "未人工试听核对落点；BPM 存在半速/双速歧义"
  },
  "pendingChecks": [{ "start": 0, "end": 12, "check": "确认第二句字幕是否踩在乐句收尾上" }]
}
```

三档状态的行为**不一样**，实测确认：

| `status` | 画面上的提示 | 音轨要求 |
|---|---|---|
| `illustrative` | 开头烧入「演示时点 · 原创合成节奏」 | **拒绝显式音轨**，只用模板合成节奏 |
| `draft` | **全时段**顶部显示「草稿 · 待核对落点」 | 必须提供真实音频，缺文件不回退演示音乐 |
| `verified` | 按分镜证据记录核对结果 | 必须提供真实音频 |

### 5.4 导出

```powershell
node skills/lyric-driven-code-mv/assets/templates/starter/export.mjs `
  --storyboard work/sb-real.json --out "$PWD\work\real.mp4"
```

**实测输出**（2.7 秒，360 帧）：

```
PNG管道 360/360
完成：...\work\real.mp4
已核对12秒、1920×1080、H.264/AAC及全片解码。交付前仍需抽帧查看叙事和字幕。
```

### 5.5 ⚠️ 用 `--storyboard` 时不能再用 CLI 覆盖 fps / 尺寸 / seed

实测这个命令会失败：

```powershell
node .../export.mjs --storyboard .../storyboard-example.json --out x.mp4 --width 640 --fps 10
```

```
导出失败：CLI fps与分镜project.fps冲突
```

**要改就改 JSON 里的 `project`。** 这是有意的：同一个工程不该有两个真源。

### 5.6 一起拿到的东西

每次导出 MP4 会在同路径生成 `.mp4.assets.json`，实测内容：

```json
{
  "storyboardSha256": "ab04b23f...",
  "musicStatus": "illustrative",
  "audio": {
    "declared": { "path": "generated:starter-rhythm", "provenance": "original", "license": "...", "credit": "..." },
    "actualPath": "generated:starter-rhythm",
    "renderedWavSha256": "6d281b9b...",
    "sourceStart": 0, "duration": 12
  },
  "output": { "path": "...\\sb-demo.mp4", "sha256": "daf69abc..." }
}
```

用真实音频时，若 `audio.credit` 非空，**最后最多 4 秒会烧入短署名**。实测片上显示：

```
音乐：Kevin MacLeod / incompetech.com | CC BY 4.0
```

**这只是短署名，不能替代具体许可要求的完整发布说明。**
哈希只证明"文件绑定"，不证明许可有效——来源和许可始终是你自己填的记录。

---

## 6. 让机器帮你找拍点

### 6.1 分析音频

```powershell
node skills/lyric-driven-code-mv/scripts/analyze-audio.mjs `
  path/to/your.wav --start 0 --duration 12 --out work/analysis.json
```

输出 `draft` 报告：能量包络、能量阶段、停顿、起音、BPM/相位候选、**以及候选拍点数组**。

**实测三种输入：**

| 输入 | `tempo.bpm` | `confidence` | `beats` |
|---|---|---|---|
| 120 BPM 点击轨 | `120` | `0.984833` | 24 个点 |
| 3/4 拍圆舞曲片段 | `null` | `0` | 空数组 |

第二种情况的 `reason` 写的是「候选投票或周期一致性不足；请人工听辨。」

这**不是工具坏了**，是它拒绝编一个假 BPM。遇到 `bpm: null` 就按段落和语义手动定时间点，
别硬凑——这一步永远不会自动变成 `verified`。

### 6.2 生成同步复核图

```powershell
node skills/lyric-driven-code-mv/scripts/visualize-sync.mjs `
  work/sb-real.json work/analysis.json --out work/sync-review.svg
```

输出 SVG（浏览器打开）+ 同名 JSON。四条轨道共用成片秒时间轴：
能量、候选拍点、镜头区间、字幕区间。

**实测一份 120 BPM 报告的结果：**

```
tempo: { bpm: 120, status: 'estimated' }
beats: 24  [0.000457, 0.500457, 1.000457, ...]

镜头起点
  send     0 - 6    nearest 0.000457  deltaMs  -0.457
  receive  6 - 12   nearest 6.000457  deltaMs  -0.457

字幕起点
  line-1      0.45 - 2.80   deltaMs  -50.457   送一盏小灯到对岸
  line-water  3.00 - 5.00   deltaMs   -0.457   水流拐弯，我松开手
  line-2      6.30 - 8.50   deltaMs -200.457   送一盏小灯到对岸
  line-reply  8.70 - 11.70  deltaMs +199.543   未能抵达，也有回光

summary.captionStarts: 平均绝对 112.73 ms，最大 200.46 ms
```

### 6.3 怎么读这些数字

```
deltaSeconds = 你的起点 − 最近的机器候选拍点
```

- **负数** = 你的落点比拍点**早**（`line-2` 早 200 毫秒）
- **正数** = 比拍点**晚**（`line-reply` 晚 200 毫秒）
- 两个拍点距离相同时取**较早**的那个

**字幕起点不必逐句贴拍。** 上表里 `line-reply` 晚 200 毫秒不是错误——
末句要在"未能抵达"的余韵里收住，卡在拍上反而生硬。
真正该关注的是**镜头切点**（上表两条都是 -0.457 毫秒，几乎完美）和你的关键动作。

`status: "candidate-review"` 只描述这张图的性质，**不是音乐校对等级**，
也不会把 `draft` 升级成 `verified`。

### 6.4 把拍点锁进分镜（80 ms 容差）

分析出的 `beats` 要写进分镜的 `music.beats`，校验器才有网格可比。一条命令搬过去：

```powershell
node -e "const fs=require('fs');const a=JSON.parse(fs.readFileSync('work/analysis.json','utf8'));const s=JSON.parse(fs.readFileSync('work/sb-real.json','utf8'));s.music.beats=a.beats;fs.writeFileSync('work/sb-real.json',JSON.stringify(s,null,2));console.log('written',a.beats.length,'beats')"
```

实测（24 个候选拍点写进一份 `duration: 12` 的分镜）：

```
written 24 beats; first 0.000484 last 11.500484; duration 12
```

然后把**必须在拍上发生**的动作标 `"sync": "beat"`：

```json
"events": [
  { "at": 5.501, "action": "灯亮的一瞬落在拍上", "sync": "beat" },
  { "at": 5.63,  "action": "这一下晚 130ms，会被抓出来", "sync": "beat" }
]
```

再跑校验：

```
警告：scenes[0].events[4].at: sync:"beat" 偏离最近节拍 5.500484 秒：offsetMs=129.516；容差 80 ms
分镜校验通过。          ← 退出码 0
```

`--strict` 下同一条警告会让退出码变成 1。容差改法：`project.settings.beatToleranceMs`。

> 这里报 `129.516` 而不是整数 `130`，是因为网格换成了机器候选：`5.63 − 5.500484 = 0.129516`。那 0.484 毫秒就是上面的 `phaseSeconds`。README 里同一段用的是 `0.5` 秒整数网格，所以写的是 `130`——两处都对，差在网格来源。

三条硬规则，踩过就白跑：

- `music.beats` 必须**严格递增**，且每个点都在 `[0, duration)` 内。把 `duration` 从 12 改成 10 却不删末尾拍点，校验器会按 `music.beats[i]: 必须位于 [0, duration)` 报错。
- 只有标了 `sync:"beat"` 的动作受 80 ms 约束。**别给所有动作都标**——末句余韵、留白、走位本来就该偏离网格，标了只会制造假警告。
- `deltaMs` 为负是早于拍点，为正是晚于拍点。偏移量本身不判断好坏，判断的是你有没有意识到它偏了。

---

## 7. 三档校验

```powershell
# 1) 普通结构校验：错误让退出码=1，警告不拦
node skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs work/sb-real.json

# 2) 严格：把警告也当失败
node skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs work/sb-real.json --strict

# 3) 发布检查：额外查许可记录、证据状态、待核对清单
node skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs work/sb-real.json --delivery
```

**实测：一份只有 `license` 没有 `url`/`licenseUrl` 的分镜**

```
# 普通校验
警告：project.audio: 许可记录尚未完成：url、licenseUrl；发布前核对授权与署名义务
分镜校验通过。                       ← 退出码 0

# --strict
严格检查未通过：仍有 1 条警告。        ← 退出码 1

# --delivery
project.audio.url: 发布检查需要非空且已明确的记录；unknown/pending 等仍为未解决
project.audio.licenseUrl: 发布检查需要非空且已明确的记录；unknown/pending 等仍为未解决
music.pendingChecks: draft 交付需要非空待核对清单；每项写成片 start/end 与具体未确认内容 check
```

**实测：把 `duration` 从 12 改成 8，但不动 `scenes`/`lyrics`/`beats`**

校验器一次报出 **18 条错误**，包括：

```
lyrics[2].end: 不得超过成片 duration（舍入容差1e-6秒）
music.beats[16]: 必须位于 [0, duration)
scenes[1]: 最后一个场景必须结束于 duration
scenes[1].events[0].at: 事件必须位于成片 [0,duration)
```

这是新版最值得信任的地方：**改时长漏改内容，根本进不到渲染那一步。**

> 校验通过 ≠ 片子能看。它审结构，也审标了 `sync:"beat"` 的动作偏离网格多少毫秒（见 [6.4](#64-把拍点锁进分镜80-ms-容差)）；但它不审故事好不好、某段走位**该不该**卡在拍上、字幕读不读得出来。

---

## 8. 断点续渲

```powershell
# 只生成帧 + 配置 + 音轨 + 字幕，不编码
node skills/lyric-driven-code-mv/assets/templates/starter/export.mjs `
  --frames-dir "$PWD\work\frames" --frames-only

# 编码（复用已有可信帧）
node skills/lyric-driven-code-mv/assets/templates/starter/export.mjs `
  --frames-dir "$PWD\work\frames" --resume --out "$PWD\work\demo.mp4"
```

帧目录里会出现 `frame-000000.png` … `render-config.json`、`subtitles.ass`、`audio.wav`。

**实测：删掉 5 帧再 `--resume`** → 只补算缺失的，恢复成 120 帧，出片正常。
**实测：参数与首次不一致**（改了 `--width`）→ 直接拒绝：

```
导出失败：恢复失败：配置/源码与帧目录不一致，请使用新目录
```

配置、源码、JSON、音频内容都做了 SHA-256 指纹。改任何一项就换新目录，别指望它猜你的意图。

---

## 9. 验收

```powershell
# 1) 完整解码（无输出 = 通过）
ffmpeg -v error -i outputs/my-mv.mp4 -f null -

# 2) 流参数
ffprobe -v error -show_entries format=duration,size `
  -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,channels `
  -of default=noprint_wrappers=1 outputs/my-mv.mp4

# 3) 每半秒抽一帧
New-Item -ItemType Directory -Path work/check -Force | Out-Null
ffmpeg -v error -y -i outputs/my-mv.mp4 -vf "fps=2" work/check/s_%03d.png

# 4) 关键位置单帧：转场边界与末帧
ffmpeg -v error -y -ss 5.55 -i outputs/my-mv.mp4 -frames:v 1 work/check/transition.png
ffmpeg -v error -y -ss 11.9 -i outputs/my-mv.mp4 -frames:v 1 work/check/ending.png

# 5) 可读变化密度：最长空窗超过 12 秒就该补变化，别加镜头
node skills/lyric-driven-code-mv/scripts/hud-density.mjs work/sb-real.json --max-gap 12

# 6) 平台安全区：字幕底边与 HUD 关键读数必须躲开参考线
python skills/lyric-driven-code-mv/scripts/safe-area.py --video outputs/my-mv.mp4 --at 3 10 -o work/safe-check.png
```

**期望的流参数（实测）：**

```
codec_name=h264
width=1920
height=1080
pix_fmt=yuv420p
r_frame_rate=30/1
codec_name=aac
sample_rate=48000
channels=1
duration=12.000000
```

`pix_fmt=yuv420p` 必须对，否则很多播放器和平台放不出来。

第 5 条实测在 12 秒示例上的输出：`可读变化点 14 个（每分钟 70 个）/ 最长空窗 2.3s（阈值 12s）`——它按切镜、材质、HUD、事件、字幕五类变化算，报的是"观众多久没看到新东西"。第 6 条出一张叠了顶部、底部 8.5%、右侧 6.5%、4:3、9:16 五条参考线的图，用眼睛确认字幕底边和 HUD 没压进去；这两条查完，再去看下面三件人眼的事。

**然后做三件机器查不出来的事：**

1. **完整播一遍**（不是跳着看），听音乐落点和动作对不对得上。
2. **把字幕关掉再看一遍**。画面本身讲不清故事，就是 PPT，不是 MV。
3. **在最亮和最暗的镜头各停一次**，确认字幕读得出来。

---

## 10. 出错怎么办

### 环境类

| 现象 | 原因 | 修法 |
|---|---|---|
| `不是内部或外部命令` | 装了但没进 PATH | 关掉 PowerShell 重开；还不行重装并勾 Add to PATH |
| 字幕整段缺失 / `ass` 报错 | ffmpeg 缺 libass | 装完整版（Windows：`winget install Gyan.FFmpeg`） |
| `unknown encoder 'libx264'` | 精简版 ffmpeg | 同上 |
| 缺字、字幕变方框 | 本机没这个字体 | `--font "已安装字体名"`，Windows 默认 `Microsoft YaHei` |

### 分镜与导出类

| 报错 | 原因 | 修法 |
|---|---|---|
| `CLI fps与分镜project.fps冲突` | 用 `--storyboard` 时又传了 `--fps`/`--width`/`--seed` | 改 JSON 的 `project`，不要用 CLI 覆盖 |
| `最后一个场景必须结束于 duration` | 改了 `duration` 没改 `scenes` | 场景必须首尾相接覆盖 `[0,duration)` |
| `自定义 scene.id 缺画法` | 分镜里出现 `SCENE_RENDERERS` 没注册的 id | 注册画法，或用内置 `send`/`receive` |
| `许可记录尚未完成：url、licenseUrl` | 音频元数据缺字段 | 补齐 `url`、`licenseUrl`；发布前必须清 |
| `draft 交付需要非空待核对清单` | `status:"draft"` 但没写 `pendingChecks` | 逐条写出待核对的时间段和内容 |
| 分析与分镜 `sourceOffset` 错配 | 一个用原曲秒、一个用成片秒 | 对同一区间、同一偏移重新分析 |
| `--resume` 报配置不一致 | 改了参数/源码/JSON/音频 | 换新目录重渲 |
| 同一帧渲两次不一样 | 用了累加状态或共享随机数 | 随机量只能用 `seeded(seed, index)`，不许 `Math.random()`/`Date.now()`/上一帧状态 |

### 中文相关的两个坑（Windows 特有）

**坑 1：用 PowerShell 改含中文的源码，会把文件写坏。**

`Get-Content ... | Set-Content` 和 `-replace` 默认按 ANSI 读写，中文变乱码，
Node 直接 `SyntaxError: Invalid or unexpected token`。

**用编辑器改**，或者用 Node 读改写：

```javascript
import { readFile, writeFile } from 'node:fs/promises';
const s = await readFile('frame.mjs', 'utf8');
await writeFile('frame.mjs', s.replace('export const DURATION = 12;', 'export const DURATION = 8;'), 'utf8');
```

**坑 2：文件其实是好的，是终端在骗你。**

PowerShell 控制台默认 GBK（代码页 936）。用 `Get-Content` 或 `python` 打印含中文的
UTF-8 JSON，会显示成一堆乱码，**看起来像文件坏了**。

先用对编码再判断：

```powershell
chcp 65001 | Out-Null
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Get-Content work/qa.json -Encoding utf8 -Raw
```

写这份文档时就差点因为这个，去"修"一个完全正常的 `qa.json`。
**看到乱码先怀疑终端，别怀疑文件。**

---

## 11. 交付清单

```
my-mv/
├── frame.mjs                       纯帧与场景（可编辑）
├── timeline.mjs                    加载与适配分镜
├── export.mjs                      导出与预览
├── preview.html                    浏览器预览
├── storyboard.json                 分镜（唯一事实源）
├── outputs/my-mv.mp4               成片
├── outputs/my-mv.mp4.assets.json   素材与许可清单
└── README.md                       怎么复现
```

逐条打勾：

- [ ] `ffprobe` 参数齐全：分辨率、帧率、`pix_fmt=yuv420p`、采样率、声道
- [ ] `ffmpeg -f null -` 完整解码零错误
- [ ] `qa.mjs` 通过：`确定性检查 pass：N 个时间点，M 次渲染，0 处不一致`
- [ ] 首帧、末帧、转场前后、每个关键动作都抽帧看过
- [ ] 完整播过一遍
- [ ] **去掉字幕再看一遍**，画面还能讲清故事
- [ ] `--delivery` 校验零未解决项
- [ ] `music.status` 与实际核对程度相符（自动分析**永远**不能当 `verified`）
- [ ] `pendingChecks` 写清每个待核对的时间段和内容
- [ ] `.mp4.assets.json` 在场，来源/许可/署名完整
- [ ] 未解决项如实列出

最后一条最重要：**一份写清"哪里没做到"的交付，比一份自称完美的交付可信得多。**

---

## 附：从 12 秒做到整首

1. **镜长由信息密度决定**，不设固定上限；建议每 8–12 秒至少出现一次可读变化（字幕、HUD、光线、材质、粒子或状态）。等待和留白是结果时，可以保留长镜头。装置、章节牌和 HUD 字段见 [装置与章节](skills/lyric-driven-code-mv/references/story-devices.md) 与 [HUD 与字幕](skills/lyric-driven-code-mv/references/hud-and-subtitles.md)。
2. **先把分镜写满全程再渲**，不要边渲边加——时间一改，`lyrics`/`beats`/`events` 全要重算
   （校验器会用几十条错误提醒你漏改了什么）。
3. **每次只改一处**，改完用 `--frame-time` 看单帧，或 `--width 640 --height 360 --fps 10` 快跑。
4. **改 `duration` 时同步改**：`lyrics`、`music.beats`、`music.sections`、`scenes.end`、`scenes.events.at`。
5. **全片渲染前**，先确认 3–4 个关键镜头的风格统一，再渲全部。
6. **长时间渲染用 `--frames-dir`**，中断了 `--resume`，别从头再来。

---

## 附：这份文档本身对不对

- 所有命令在 Windows PowerShell + Node v24.16.0 + ffmpeg 9.0.2 实测通过。
- 默认演示 1920×1080 全片实测 2.8 秒；单帧 0.1 秒；分镜驱动全片 2.7 秒。
- `qa.mjs` 实测：26 个时间点、104 次渲染、0 处不一致。
- 删 5 帧后 `--resume` 实测补回；参数不一致实测被拒绝。
- 120 BPM 点击轨实测 `bpm=120, confidence=0.984833`，`beats` 24 个点，
  字幕起点偏差实测 −50.457 / −0.457 / −200.457 / +199.543 毫秒。
- 3/4 拍圆舞曲实测 `bpm=null`，拍点为空数组，工具拒绝伪造。
- `duration` 改 8 不动其他内容，实测校验器报 18 条错误。
- `--storyboard` 与 `--fps` 冲突、`--delivery` 许可缺项、`--strict` 把警告当失败，均实测触发。
- macOS / Linux 命令按对应包管理器写的，未在本机实测。
