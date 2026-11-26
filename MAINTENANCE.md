# 歌词驱动代码 MV Skill 长期维护指南

这份指南用于持续维护 `lyric-driven-code-mv` 的入口文档、参考资料、工具脚本、原创模板和测试。维护目标是让 AI 拿到歌曲与技能后，能够建立分镜、运行代码动画并交付可复现的结果；每次改进都应保留可编辑性，说明证据范围，并减少首次使用时的障碍。

仓库：<https://github.com/zizhengLI4/lyric-driven-code-mv-skill>。以下命令均从仓库根目录执行，示例里的歌曲、分镜与输出路径需要替换成真实路径。安装后的技能目录是使用副本；长期开发应在仓库副本中进行，验证后再更新安装目录。

## 1. 维护哪些文件

| 文件或目录 | 职责 | 修改时同时检查 |
|---|---|---|
| `README.md` | 给使用者解释用途、安装、第一次运行与交付结果 | 示例命令是否可用；主页介绍与实际能力是否一致 |
| `MAINTENANCE.md` | 本维护指南，记录工作方法、兼容契约和长期验证主题 | 每次新增接口、验收产物或改变发布流程时同步 |
| `skills/lyric-driven-code-mv/SKILL.md` | 让 AI 选择流程、按需读取资料、判断交付阶段 | 触发条件、依赖说明、入口与参考链接 |
| `skills/lyric-driven-code-mv/agents/openai.yaml` | 技能的界面名称、描述和默认提示 | YAML 字段及技能名称；与入口的用途一致 |
| `references/storyboard-and-timing.md` | JSON、成片时钟、镜头事件和转场契约 | 校验器、模板执行范围及相关测试 |
| `references/audio-and-rights.md` | 音频分析、素材来源、许可与署名 | 分析输出、音轨选择和实际交付记录 |
| `references/sync-review.md` | 能量、候选拍点、镜头和字幕的复核图 | 输入时基、误差含义、器乐分支及规模限制 |
| `references/pixel-game-visuals.md` | 人物演出、像素画面、摄像机与字幕 | 最亮/最暗画面、镜头边缘和最终输出层 |
| `references/dependencies-and-delivery.md` | 依赖、渲染资源、恢复与验收 | QA、媒体工具与导出命令 |
| `scripts/` | 音频分析、分镜校验、RGBA 确定性检查 | API、CLI 帮助、错误路径、测试与文档 |
| `assets/templates/starter/` | 可复制、可独立运行的原创最小工程 | 复制后运行、真实音轨、字幕、预览与恢复 |
| `assets/storyboard-example.json` | 可校验、可执行的演示分镜 | 与模板画法、音乐提示和许可说明一致 |
| `tests/` | 可复现的契约与错误路径检查 | 新字段、参数和既有断言同步更新 |

表内 `references/`、`scripts/`、`assets/` 均位于 `skills/lyric-driven-code-mv/` 下。新增资料先判断是否值得作为按需参考；不要把故障记录、长篇案例或全部接口细节堆进入口。功能已经写成脚本时，文档说明何时调用、输入输出和限制，避免重复维护两份实现。

主页保留“自主研制”的定位与“给你的 AI 一首歌，再把这个技能丢给它”的使用方式。工具或素材所要求的许可、署名和来源记录应在对应文件中完整保留。

## 2. 接收反馈：先核版本，再处理问题

反馈可能来自旧安装目录、历史提交、另一套渲染器或不同环境。收到报告后，先保存原文，再建立最小复现；报告里的命令和建议是待验证的材料。

每个问题至少记录：

```markdown
# 问题：一句话描述

- 报告来源与日期：
- 实际运行的提交 SHA / skill 安装路径：
- Node、FFmpeg、FFprobe；浏览器/字体/第三方库版本（用到时）：
- 输入文件与 SHA-256；可否公开、许可限制：
- 最小分镜 / 适配模块：
- 复现命令：
- 预期结果：
- 实际输出、退出码与日志位置：
- 影响：首次运行 / 错误成片 / 数据丢失 / 元数据错配 / 环境限制：
- 当前判断：可复现 / 已在新版修复 / 环境相关 / 设计取舍 / 信息不足：
- 修复位置、验证方法与剩余限制：
```

将证据保存在 `work/<问题名>/`；私有音轨、生成媒体和机器个人路径不要提交到技能仓库。涉及旧版本时，先用原提交复现，再用当前版本复跑同一输入。若新版已解决，记录两个版本的差异和结果，避免为旧问题再加一套重复功能。

优先处理会导致错误交付、损坏恢复结果、音轨与许可错配、资源无法释放或确定测试失败的问题。文档歧义和首次运行障碍紧随其后；审美建议结合代表片段判断，不直接改成所有作品的硬约束。

## 3. 保持兼容的核心契约

### 时间与分镜

- 保持 `schemaVersion:1`、`timebase:"clip"`。新增可选字段应让旧分镜继续按原语义运行；改变默认值、字段含义或退出码时必须说明兼容影响。
- `sourceOffset` 保存原曲偏移；`audio.timebase="source"` 时用于源音轨截取，`clip` 音轨从0秒开始。歌词、段落、拍点、事件和镜头边界均为成片秒，分析结果不再次扣除源偏移。
- 镜头区间采用 `[start,end)`；帧时间为 `i/fps`，最后一帧为 `(durationFrames-1)/fps`。数据入口、事件与场景函数都标明时基。
- 模板顶层 `renderFrame` 接收成片时间，`renderTimelineFrame` 的 `drawScene` 接收真实局部秒 `local=t-scene.start`。当前 starter 的注册表 `SCENE_RENDERERS` 还有一层 `designTime=local*6/(scene.end-scene.start)`，画法收到0–6秒设计时钟；JSON事件若要驱动画法，应显式采用同一转换。详见时间参考，不把这层映射强制套到已有框架。
- 转场占前镜尾部 `[end-dur,end)`。前镜继续运动，下一镜以 `local=0` 静态预卷；切入后从零播放，不额外增加片长。
- 通用分镜有效与 starter 支持范围分别校验。当前 starter 末镜仅支持 `exit:{type:"cut",dur:0}`；不能让通用规范通过被误解为模板已实现全部画法。
- 容差需有明确精度和适用范围。尾边界的十进制舍入要有失败复现，也要保留实际越界的失败用例，避免容差吞掉一整帧或真实时间空隙。

### 纯帧、资源与恢复

- `renderFrame(t, options)` 返回同尺寸 RGBA 字节帧；同一时间、seed、参数和渲染环境产生一致像素。不要引入页面时钟、上一帧状态或未固定随机序列。
- CLI 的预热默认值与 API 默认值分开维护：现有 QA CLI 默认 3 帧，`runDeterminismQA` API 默认 0；支持值为 0、2、3。预热差异与正式不一致分别记录，不能用增加预热次数掩盖持续漂移。
- 浏览器适配模块用 `cleanup()`，直接调用 QA API 时由资源所有者提供 `teardown`；成功、失败和清理失败都应可诊断。
- 确定性检查默认优先低分辨率世界层；字幕和后处理在最终输出层另验。1080p RGBA 每帧约 8.3 MB，多次截图和传输会增加资源压力。QA 对超过一百万像素的输入每次运行提示一次，通过 `warnings[]` 留存，API 可用 `onWarning` 接收；提示不改变判定。缩小帧的结果只覆盖缩小后的尺寸。
- `export.mjs --frame-time <成片秒> --frame-out <PNG>` 输出 384×216 世界层单帧，无需 FFmpeg，不含 ASS 字幕。时间应位于 `[0,duration)`；它适合先看画法，不能代替最终输出层的验收。
- 恢复结果与输入、源码、配置和逐帧完整性绑定。更换音轨、JSON、seed、字体或源码后使用新帧目录；不能只凭文件名存在复用旧帧。

### 音乐证据与许可

- `illustrative` 表示演示时点/占位或原创演示，画面显示演示提示；`draft` 表示仍待核对，交付时写清方法、限制和具体的 `pendingChecks`；`verified` 需要实际人工核对记录及范围。
- `--strict` 仅把结构警告升为失败；`--delivery` 检查交付字段。通过工具仍要如实记录试听和许可核对范围。
- 器乐曲可用叙事字幕，不能把原创叙事文字说成演唱歌词。可选 `music.captionRole` 或顶层 `captionRole` 用于同步图上的文字角色说明；未试听保持 `draft`，完成相关人工核对后可记录为 `verified`，器乐身份本身不限制状态升级。
- `--audio` 只重定位 JSON 声明的同一素材。归一化路径相同、原声明文件的内容哈希相同，或实际文件匹配 `project.audio.sha256` 时可接入；原路径已缺失时，先记录原素材的完整 SHA-256。换歌要一起更新 JSON 路径、来源、许可、署名、用途和音乐证据；`illustrative` 拒绝显式歌曲，接歌时改为 `draft/verified`。
- 未声明哈希时，同路径文件被替换无法仅靠路径判断原素材身份；重要交付保留 `project.audio.sha256` 与实际文件核对。哈希不匹配应拒绝，对重定位、同路径替换和原创模板换歌分别做回归。
- MP4 导出生成 `<成片路径>.assets.json`；帧目录保存 `asset-manifest.json`。清单记录实际源音轨、裁剪 WAV、分镜与声明许可，MP4 旁的清单还包含成片哈希。外部非原创音轨根据 `credit` 与 `license` 在最后 4 秒生成短署名，仍需人工核对完整来源/许可链接、修改说明及署名方式。
- MP4/素材清单与同步图SVG/JSON成对提交；可处理的写入错误会恢复旧交付。若恢复也失败，错误消息给出保留的备份目录，先恢复并比对文件再重试。进程被强制终止或断电仍可能打断事务，不能把成对更新称为操作系统级原子操作。
- 数据记录完整性、文件身份与真实授权有效性分别核对。公开用音轨的署名位置和修改说明按实际许可执行；音乐状态不代替许可条件。

## 4. 每次改进怎么做

1. **建立证据。** 用最小输入证明问题，保存原始命令与输出。代码缺陷先建立能失败的契约/回归用例；低影响文案修订只需核对内容与链接。
2. **确定影响范围。** 判断修改涉及入口、通用校验、starter 执行子集还是具体渲染器。只有特定 Pillow、字体或浏览器版本出现的现象，要写复现条件。
3. **做最小修复。** 沿用现有模块和用户工程。没有实际需要时不引入新包、新框架、模型或远程服务；需要安装或付费前先说明并核对已有授权。
4. **同步变更。** 同一次改动更新对应测试、示例、CLI `--help` 和文档。新参数检查未知、重复、缺值和不合法取值；新字段检查省略、合法、无效及旧数据兼容。
5. **检查实际效果。** 涉及渲染、字幕、音轨或时间线时，除测试外跑一个短导出；改变画法时查看代表帧。纯文档修改不必无条件重新渲染长片。
6. **记录结论。** 写明修复了什么、证据在哪里、还缺哪项核对。外部作者的复测应标注来源；维护者本人没运行过的内容不能记作本轮实测。

跨镜字幕、留白镜头、缓慢动作、开放结局和纯器乐都是可能合理的创作选择。语义提示要能定位和解释，不为提高“严格程度”强制所有镜头有事件、所有 HUD 都出现失败或所有切镜都踩拍。

真实项目的动态导出必须使用当前静帧确认记录。维护时复测无确认、只确认场景或人物、完整确认、分镜或绘制文件与字幕设置变更后拒绝的路径。单帧、演示夹具和已定版的恢复路径也要跑到。全程保留用户明确答复作为项目记录。

## 5. 回归与成片验收

### 工具与结构检查

```powershell
node --version
node skills/lyric-driven-code-mv/scripts/check-environment.mjs --missing-only

node skills/lyric-driven-code-mv/scripts/analyze-audio.mjs --help
node skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs --help
node skills/lyric-driven-code-mv/scripts/qa.mjs --help
node skills/lyric-driven-code-mv/scripts/visualize-sync.mjs --help
node skills/lyric-driven-code-mv/assets/templates/starter/export.mjs --help

node skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs skills/lyric-driven-code-mv/assets/storyboard-example.json --delivery
node --test
```

已有媒体工具位于非 PATH 路径时，可在当前 PowerShell 会话设置 `$env:FFMPEG_PATH` 和 `$env:FFPROBE_PATH`，值应为已有程序的真实路径。默认 PATH 缺工具时，媒体集成测试可带明确原因跳过，纯逻辑测试继续运行；显式无效配置应失败。发布前须在媒体工具可用的环境实际跑集成检查，不能把跳过记成导出通过。

需要验证技能格式时，可使用本机 Codex `skill-creator` 自带的 `scripts/quick_validate.py`；它不属于本仓库。Windows 使用 `python -X utf8 <该工具的实际路径> skills/lyric-driven-code-mv`，只有本机已有 Python 和该工具时执行。

### 复制模板与低成本冒烟检查

下面的目录须尚不存在，避免把模板混入以前的工程。

```powershell
New-Item -ItemType Directory -Path 'work/maintenance-smoke' -Force | Out-Null
if (Test-Path -LiteralPath 'work/maintenance-smoke/starter') { throw '冒烟工程已存在，请换用新的目录名。' }
Copy-Item -LiteralPath 'skills/lyric-driven-code-mv/assets/templates/starter' -Destination 'work/maintenance-smoke/starter' -Recurse

node work/maintenance-smoke/starter/export.mjs --frame-time 5.55 --frame-out work/maintenance-smoke/world-frame.png
node work/maintenance-smoke/starter/export.mjs --width 640 --height 360 --fps 10 --out work/maintenance-smoke/demo.mp4
node skills/lyric-driven-code-mv/scripts/qa.mjs work/maintenance-smoke/starter/frame.mjs --duration 12 --fps 10 --out work/maintenance-smoke/qa.json
```

真实分镜需要另做接入检查：JSON 里写好实际音轨、许可和身份记录，再执行 `export.mjs --storyboard <分镜> --audio <同一音轨的实际路径> --out <成片>`。源音轨与已截取音轨各检查一次时基；修改字幕、镜头边界和状态后，在输出帧中确认变化。未注册画法、音轨不足、冲突参数和素材身份错配应得到明确失败或诊断，不能静默回退到演示音乐。核对实际文件与导出清单中的 SHA-256，并抽查短署名内容；清单里的许可仍需核对原始来源。

### 逐镜和最终音效回归

使用 qa.mjs --review-index 和 film-sheet.py 从实际 MP4 取得逐镜文件，检查索引帧率、帧数、字幕时点和相邻镜头。含 9 事件的包内分镜应默认混入 9 个。用实际编码后的 AAC 回读双声道事件电平和总线真峰。测试机走 FFMPEG_PATH 和 FFPROBE_PATH 的显式配置，检查缺工具与无法启动的实际差异。

### 输出检查与正面的同步证据

```powershell
ffprobe -v error -show_format -show_streams -of json 'work/maintenance-smoke/demo.mp4'
ffmpeg -v error -i 'work/maintenance-smoke/demo.mp4' -f null -
ffmpeg -i 'work/maintenance-smoke/demo.mp4' -vf 'fps=1,scale=384:-1,tile=4x3' -frames:v 1 'work/maintenance-smoke/contact.png'
ffmpeg -ss 5.55 -i 'work/maintenance-smoke/demo.mp4' -frames:v 1 'work/maintenance-smoke/transition.png'
```

记录目标与实测的时长、分辨率、帧率、像素格式、音频流、采样率和声道。容器或编码器尾部差异结合帧率判断。查看首尾、镜头边缘、转场前中后、动作峰值、最亮背景字幕及最终分辨率文字；接触表只是总览，关键边界另外精查。

音画核对分两层进行：

1. **结构证据：** 使用 `visualize-sync.mjs` 将能量、候选拍点、镜头和字幕画在同一根成片时间轴，查看起点误差。关键事件另结合分镜校验或工程时间线核对；对声明踩拍的事件记录候选来源和容差。算法距离可以复现，但候选拍未必是实际重拍。
2. **听感证据：** 播放实际导出文件，核对歌曲版本、源偏移、段落、动作峰值、字幕与切点；按可定位区间记录核对者、时间和结果。无法试听时保留 `draft` 和待核对清单。

```powershell
node skills/lyric-driven-code-mv/scripts/analyze-audio.mjs 'path/to/song.wav' --start 37.2 --duration 12 --out work/analysis.json
node skills/lyric-driven-code-mv/scripts/visualize-sync.mjs 'path/to/storyboard.json' work/analysis.json --out work/sync-review.svg
```

分镜须使用相同的 `duration` 与 `sourceOffset`。第二条同时输出 `work/sync-review.json`，状态为 `candidate-review`，不会改变音乐证据状态；它接受标准分析报告的 `schemaVersion:1/status:"draft"/timebase:"clip"`。报告保存输入哈希与候选误差；图的哈希只绑定分镜和分析文件，不能证明分析使用了正确音轨。时长容许一个 PCM 样本或 `1e-6` 秒舍入，偏移容许 `1e-6` 秒；不能为生成图随意改偏移。输入、点数和输出有上限，包络按桶保留极值降采样，精确区间以 JSON 为准，具体限制见 `references/sync-review.md`。

叙事验收可关闭字幕后观看动作，记录实际观察范围；需要盲测时再请观看者复述故事。播放器色域、暗部色带或响度只在实际查过后给结论，平台有明确要求时再增加对应检查。

## 6. 发布与回滚

### 发布

1. 检查工作树和分支，明确本次要发布的改动；用户工程、素材和临时导出不混入仓库。
2. 在最终待发布版本上完成适用测试和冒烟检查，保存命令、退出码、实际统计、日期与环境；后续改代码时重跑受影响检查。
3. 在变更说明中写问题、最终行为、兼容影响和验证范围。记录完整提交 SHA，避免用“最新版本”代替可定位版本。
4. 从这个固定版本生成交付包；逐文件核对包内技能与仓库内容，并检查没有漏模板、参考资料或脚本。
5. 只有获得发布/推送授权后执行对应外部操作。成功后读取远端提交与文件清单，核对实际文件或哈希；浏览器显示已上传不能代替内容核对。
6. 更新安装副本前先比较其修改，保留本地定制，再按版本更新。让用户重新加载技能，并记录实际加载路径与版本。

测试数量会随功能变化，维护指南不固定写死。每次发布记录真实通过、失败和跳过及原因；“零失败但跳过媒体集成”与“实际导出验证通过”分别表述。

### 回滚

保留最近可运行版本的提交、交付包、环境和验收记录。出现回归时先隔离问题，不覆盖用户在同目录的改动；找到引入问题的提交后，用可追踪的回退提交或恢复固定版本副本，再跑受影响检查。不要对脏工作树使用 `reset --hard`、`clean` 或整目录删除。

若回归涉及恢复指纹、时间线或音轨身份，使用新的渲染目录验证，旧目录保留作为证据。回滚也要核对远端和交付文件，说明回退范围及暂不可用功能。

## 7. 长期维护节奏与待办

| 时机 | 维护动作 | 留下的记录 |
|---|---|---|
| 每次新反馈 | 核版本、分类、最小复现、影响判断 | 问题证据卡 |
| 每次功能/修复 | 同步契约、测试、帮助、模板和文档 | 修复提交与受影响验证 |
| 每次发布 | 固定版本全量测试、必要导出、包与线上核对 | 发布验收与完整 SHA |
| 依赖或环境变化 | 核官方要求、媒体编码能力、浏览器/字体 profile | 环境变化与兼容结果 |
| 每月人工维护时 | 整理未解决问题、重复反馈、过期链接和首次使用障碍 | 待办优先级与下次验证目标 |

按月检查是维护建议；它不会自动创建定时任务或安装软件。变更应由真实需求推动，不为追版本无条件升级依赖。

建议长期保留以下回归主题：

- 原创模板换歌时，实际音轨与许可、署名、用途和身份记录一致。
- 器乐叙事字幕与演唱歌词的区别；草稿到核对状态的证据完整。
- 时间轴对齐结果与试听范围分别记录，容差能解释。
- 小数尾边界、源偏移、镜头局部时钟和预卷没有重复换算。
- 浏览器预热、清理失败和大帧资源成本有诊断；增加采样覆盖时评估渲染次数。
- 恢复不复用错音轨、错参数、错置或损坏的帧。
- 明暗背景字幕可读、摄像机四边有覆盖，最终分辨率文字与低分辨率世界层分别验收。
- 缺省工具跳过与显式配置错误分别测试，新增字段不会让旧测试静默失效。

关闭一条待办需要对应实现或明确取舍、可复现验证和剩余限制。仅增加一段文案而没有解决实际行为时，记录为“说明已补充”，不记作功能已修复。

## 8. 可以直接交给下一位 AI 的维护任务

```text
请继续维护 lyric-driven-code-mv。
先读取本维护指南、仓库 README、技能 SKILL.md 与本次反馈涉及的参考文档，
检查当前分支、完整提交 SHA、工作树改动和实际安装目录。

逐条核对反馈对应的运行版本，保存最小输入、命令、实际输出与影响。
区分当前可复现问题、旧版已修复问题、环境相关现象和创作取舍。
代码缺陷先建立失败复现，再做最小修复；同步测试、示例、CLI 帮助和文档。
保持既有 JSON、成片时基、纯帧、预卷、草稿证据及资源清理契约。

使用已安装工具，不擅自安装依赖、下载模型、注册账号或付费。
测试通过后，根据修改范围做短片导出、FFprobe、完整解码和抽帧检查；
涉及音轨时核对文件身份、来源、许可、署名和实际裁切范围。
没有完成的试听或叙事检查写成可定位待办，不升级证据状态。

交付修改后的技能、维护文档、实际验收记录和明确剩余项。
发布前固定提交与交付包，核对文件一致；外部发布沿用本次用户授权。
汇报最终行为、验证方法与限制，使用简体中文。
```
