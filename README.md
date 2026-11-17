# 歌词驱动代码 MV Skill

**给你的 AI 一首歌，再把这个技能丢给它，让它把歌曲写成一段有故事的代码 MV。**

你可以把喜欢的歌曲、校对歌词和想要的画面感觉交给 AI，再让它读取这个技能。你负责选歌、表达想法和确认效果，AI 按照技能组织歌曲分析、歌词分镜、人物演出、代码动画、字幕与导出，把脑海中的画面逐步做成可以预览、修改和继续扩展的视频工程。

本项目是一套**自主研制的歌词驱动代码 MV Skill**，配套提供音频分析工具、分镜校验工具、原创像素动画模板与画面验收脚本。它把歌曲创作中容易脱节的几个环节串起来：歌词在讲什么，角色应该做什么，画面什么时候发生变化，以及最终怎样落到可编辑的代码和成片上。

核心思路很直接：**歌词决定画什么，音乐决定何时强调。**

一句关于“远方”的歌词，可以变成人物隔岸送出一盏灯；一段等待，可以写成纸船缓慢漂流、另一岸始终未亮的灯光；当歌曲的情绪发生变化，人物行动、道具状态和场景也随之推进。歌词中的意象有了具体的动作，重复的副歌可以带来新的回应，同一段音乐也就有了不同的故事进展。

## 它可以帮你的 AI 做什么

| 环节 | AI 可以按这个技能完成的工作 |
|---|---|
| 歌曲分析 | 整理截取范围、段落、留白、能量变化与节拍候选，为镜头安排提供时间依据 |
| 歌词分镜 | 把歌词含义写成人物的目标、行动、反馈与结果，安排意象的出现、变化和再次出现 |
| 人物演出 | 设计等待、尝试、失败、回应和完成等动作，让人物关系、道具和场景形成连续故事 |
| 代码动画 | 组织按时间求值的动画，制作角色、场景、摄像机、粒子、转场与可任意跳播的预览 |
| 字幕与音乐 | 规划字幕位置和可读性，将关键动作、镜头变化与音乐时间线对应起来，并标明待核对的落点 |
| 检查与交付 | 校验分镜数据和画面一致性，检查导出的音视频流，整理可编辑源码、素材记录与 MP4 |

这些环节可以由具备文件读取、代码执行和视频处理能力的 AI 助手逐步完成。提供歌曲文件后，离线分析可以给出能量、停顿、起音、BPM 和相位候选；歌词时间与关键落点仍需要结合校对文本和试听核对。技能会记录演示、草稿或已核对状态，让每个阶段的结果都清楚可追踪。

## 适合做怎样的作品

- **像素游戏风音乐 MV**：用小人物、任务、道具和场景变化表达歌词，让一首歌像一段可以观看的游戏剧情。
- **双人叙事与情绪短片**：围绕靠近、等待、错过、陪伴、回应等主题，让人物的行动承接歌曲情绪。
- **副歌片段与音乐短视频**：先做一段约 10–15 秒的代表片段，确认人物动作、字幕和转场，再继续扩展。
- **可编辑的代码动画工程**：把镜头、动作和字幕保留在源文件里，方便换歌、改色、改人物、调整节奏和反复导出。

你可以直接给出喜欢的主题，例如“夜晚、两岸、纸船、暖色灯光”，也可以只确定歌曲与画幅，让 AI 先提出分镜。已有角色设定、画风或代码工程时，将它们一起交给 AI，技能会围绕你的选择组织后续制作。

## 把歌曲和技能一起交给 AI

下载仓库，把 `skills/lyric-driven-code-mv` 整个目录交给支持读取文件的 AI 助手，或者按下方步骤安装到 Codex。保留目录中的脚本、参考文档和模板，AI 就能在需要时使用相应工具。

你可以这样开口：

> 给你一首歌，再给你这个歌词驱动代码 MV 技能。先读懂技能和歌词，围绕歌曲的情绪设计人物故事，再把分镜做成可以预览和修改的代码动画。

下面这段可以直接复制，并替换歌曲位置与创作要求：

```text
使用 $lyric-driven-code-mv，并先完整阅读这个技能的 SKILL.md。

我把歌曲音频和校对歌词一起交给你。
请围绕歌词含义制作一支像素游戏风代码 MV：
夜晚、两岸、纸船与灯光，两个人物通过行动逐步回应彼此。
画幅为横屏 1920×1080，30 fps。

先截取原曲 37.2–49.2 秒，完成 12 秒代表片段。
先给出歌词时间线和“目标→行动→反馈→结果”分镜，
再制作人物、场景、字幕、音乐强调与转场。
已有工程就沿用；没有工程就从内置 starter 开始。

完成后交付可编辑源码、分镜数据、素材来源记录和 MP4，
检查时长、音视频流、字幕、转场与画面一致性。
记录音乐证据状态，列出需要我试听确认的时间点。
代表片段确认后，再按我指定的范围继续扩展。
```

如果你已经有清晰的创作想法，可以把人物身份、故事主题、色调、横竖屏、片长和字幕语言一起写进去。只有音频时，如 AI 具备可用的转录能力，可以先准备歌词与时间线草稿，再结合你的校对继续制作。

## 制作过程与交付结果

通常从确定歌曲版本和创作范围开始，接着建立音乐时间线与歌词语义表，设计人物任务和镜头，再实现一段代表片段。预览时重点看人物是否真正发生了行动、重复段落是否有发展、字幕是否清楚，以及转场和摄像机移动是否自然。确认这段效果后，可以按你的要求扩展成更长的作品。

完成视频制作时，技能会指导 AI 整理以下内容：

- **成片与可编辑工程**：导出的 MP4，以及对应的动画源文件、场景、字幕和时间参数。
- **分镜与分析数据**：歌词时间、人物行动、镜头安排、事件落点与音频分析结果。
- **素材与署名记录**：歌曲、录音及其他资源的来源、许可与需要保留的署名信息。
- **简短验收记录**：时长、分辨率、帧率、音视频流、抽帧检查及待试听确认项。

之后你可以继续对 AI 说“让人物在第二句时停下来”“把岸边灯光改成暖黄色”“让最后一次副歌增加一次回应”，让修改落实到具体镜头和代码中。仅需要分镜、短片段或调整已有工程时，也可以直接限定交付范围。

## 内置工具与原创模板

仓库内置一套 **12 秒纸船与两岸灯光演示**，包含人物动作、场景变化、摄像机留边、尾段转场、高分辨率字幕和本地生成的原创节奏。可以先把这个工程跑通，再让 AI 按你的歌曲与分镜改写。

- **离线音频分析**：使用 Node 内置模块与 FFmpeg，输出能量、停顿、起音和 BPM/相位候选；支持输入已知 BPM、合并邻近候选，并明确标识低置信网格。
- **分镜校验**：检查时间范围、镜头覆盖和角色/道具引用，并提示跨镜歌词、显式踩拍、HUD 支撑与授权记录缺项。
- **确定性 QA**：预热后重复、逆序和乱序求值同一批帧，单独记录首次光栅差异；适配器可提供清理钩子，让浏览器等资源在检查后正常退出。
- **同步候选图**：把能量、候选拍点、镜头边界和字幕区间放在同一时间轴，输出SVG与JSON并报告起点误差，帮助定位需要试听核对的位置。
- **音轨追踪与单帧检查**：音频重定位核对同一素材，导出保存实际音轨哈希与署名记录；可先导出某个时点的世界层PNG，再检查正式成片字幕。
- **两种导出方式**：管道直出适合快速验证；PNG 落盘与恢复适合保留渲染进度。
- **画面验收**：通过接触表查看整体叙事，再检查每镜和转场的关键帧。

内置模板使用已有 Node.js、FFmpeg 与 FFprobe。HTML/Canvas/SVG 工程可按需要使用，HTML 动效路线可选择 HyperFrames，React 工程可选择 Remotion；其他框架的依赖由 AI 根据现有环境和你的选择配置。

## 从零到成片

第一次用、又不打算让 AI 代劳的，读 [GETTING-STARTED.md](GETTING-STARTED.md)：它把装依赖、装 skill、跑通 12 秒、单帧排错、接入自己的歌、离线找拍点、三档校验、断点续渲和验收串成一条可以直接照抄的路径，每一步都给出实测输出和出错处理。文中所有耗时、帧数、BPM 与偏差毫秒均为真实运行结果。

## 安装

复制整个 `skills/lyric-driven-code-mv` 目录到 Codex 的 skills 目录，模板与脚本都随安装保留。Windows 可用：

```powershell
$taskSkillRoot = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'skills' } else { Join-Path $env:USERPROFILE '.codex/skills' }
New-Item -ItemType Directory -Path $taskSkillRoot -Force | Out-Null
$taskSkillTarget = Join-Path $taskSkillRoot 'lyric-driven-code-mv'
if (Test-Path -LiteralPath $taskSkillTarget) { throw '同名 skill 已存在，请先检查内容再合并。' }
Copy-Item -LiteralPath './skills/lyric-driven-code-mv' -Destination $taskSkillTarget -Recurse
```

安装 skill 不安装视频框架或模型。最小模板只用已有 Node、FFmpeg、FFprobe；选择其他框架、安装依赖/字体或使用 API 前先说明。

## 先跑通 12 秒

在仓库根目录运行：

```powershell
New-Item -ItemType Directory -Path 'work' -Force | Out-Null
Copy-Item -LiteralPath 'skills/lyric-driven-code-mv/assets/templates/starter' -Destination 'work/my-mv' -Recurse
node work/my-mv/export.mjs --out work/demo.mp4
node skills/lyric-driven-code-mv/scripts/qa.mjs work/my-mv/frame.mjs --duration 12 --fps 30 --out work/qa.json
```

默认输出 1920×1080、30 fps；开头标注“演示时点 · 原创合成节奏”。也可以让分镜 JSON 直接控制项目时长、帧率、尺寸、字幕、镜头边界、转场与音乐状态：

```powershell
node work/my-mv/export.mjs --storyboard skills/lyric-driven-code-mv/assets/storyboard-example.json --out work/storyboard-demo.mp4
node work/my-mv/export.mjs --storyboard work/storyboard.json --audio 'path/to/song.wav' --out work/song-mv.mp4
node skills/lyric-driven-code-mv/scripts/qa.mjs work/my-mv/frame.mjs --storyboard work/storyboard.json --out work/song-qa.json
```

模板通过 `SCENE_RENDERERS[scene.id]` 选择画法；内置 `send` 与 `receive`，新增故事镜头时由 AI 实现对应画法。真实歌曲的字幕和时窗只修改 JSON，`draft` 状态自动烧入“待核对落点”提示；音频为原曲时按 `project.sourceOffset` 裁剪。预览、音轨时基与恢复规则见 [starter README](skills/lyric-driven-code-mv/assets/templates/starter/README.md)。

## 开发与检查

```powershell
node skills/lyric-driven-code-mv/scripts/analyze-audio.mjs 'path/to/song.wav' --start 37.2 --duration 12 --out work/analysis.json
node skills/lyric-driven-code-mv/scripts/analyze-audio.mjs 'path/to/song.wav' --start 37.2 --duration 12 --bpm 110 --out work/known-bpm.json
node skills/lyric-driven-code-mv/scripts/visualize-sync.mjs work/storyboard.json work/analysis.json --out work/sync-review.svg
node skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs skills/lyric-driven-code-mv/assets/storyboard-example.json --delivery
node --test
```

测试可使用 `FFMPEG_PATH` / `FFPROBE_PATH` 指向已有程序；PATH 中缺少工具时只跳过需要实际解码/编码的用例，并说明原因。显式配置无效路径会报错。`--strict` 把结构警告升级为失败，通过它仍需核听；草稿交付须附 `music.pendingChecks` 具体时间区间与检查内容。使用说明见 [SKILL.md](skills/lyric-driven-code-mv/SKILL.md)、[时间与分镜](skills/lyric-driven-code-mv/references/storyboard-and-timing.md)、[像素/字幕](skills/lyric-driven-code-mv/references/pixel-game-visuals.md)、[音频/授权](skills/lyric-driven-code-mv/references/audio-and-rights.md)、[依赖/验收](skills/lyric-driven-code-mv/references/dependencies-and-delivery.md)。

长期维护、复现反馈、兼容性、发布与回退流程见 [维护指南](MAINTENANCE.md)。同步图的误差解释与器乐叙事字幕说明见 [同步复核](skills/lyric-driven-code-mv/references/sync-review.md)。
