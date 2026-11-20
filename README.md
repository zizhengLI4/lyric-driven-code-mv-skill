# 歌词驱动代码 MV Skill

**给你的 AI 一首歌，再把这个技能丢给它，让它把歌曲写成一段有故事的代码 MV。**

你可以把喜欢的歌曲、校对歌词和想要的画面感觉交给 AI，再让它读取这个技能。你负责选歌、表达想法和确认效果，AI 按照技能组织歌曲分析、叙事装置、歌词分镜、人物演出、HUD/章节牌、代码动画、字幕与导出，把脑海中的画面逐步做成可以预览、修改和继续扩展的视频工程。音乐同步采用混合模式：先给出能量和拍点候选，关键动作由你确认后再锁定为卡点。

本项目是一套**自主研制的歌词驱动代码 MV Skill**，配套提供音频分析工具、分镜校验工具、原创像素动画模板与画面验收脚本。它把歌曲创作中容易脱节的几个环节串起来：歌词在讲什么，角色应该做什么，画面什么时候发生变化，以及最终怎样落到可编辑的代码和成片上。

核心思路很直接：**歌词决定画什么，音乐决定何时强调。**

一句关于“远方”的歌词，可以变成人物隔岸送出一盏灯；一段等待，可以写成纸船缓慢漂流、另一岸始终未亮的灯光；当歌曲的情绪发生变化，人物行动、道具状态和场景也随之推进。歌词中的意象有了具体的动作，重复的副歌可以带来新的回应，同一段音乐也就有了不同的故事进展。

**快速入口：**[适用范围](#适合做怎样的作品) · [交给 AI 使用](#把歌曲和技能一起交给-ai) · [安装](#安装) · [12 秒示例](#先跑通-12-秒) · [音乐卡点](#音乐卡点从拍点到校验) · [完整制作指南](GETTING-STARTED.md)

## 它可以帮你的 AI 做什么

| 环节 | AI 可以按这个技能完成的工作 |
|---|---|
| 歌曲分析 | 整理截取范围、段落、留白、能量变化与节拍候选，为镜头安排提供时间依据；关键动作保留人工确认入口 |
| 叙事装置 | 先选聊天、游戏系统、时间轴、计数器、章节牌、视角或材质舞台，再拆场景 |
| 歌词分镜 | 把歌词含义写成人物的目标、行动、反馈与结果，安排意象的出现、变化和再次出现 |
| 人物演出 | 设计等待、尝试、失败、回应和完成等动作，让人物关系、道具和场景形成连续故事 |
| 代码动画 | 组织按时间求值的动画，制作角色、场景、摄像机、粒子、转场、HUD、章节牌与材质变奏，并提供可任意跳播的预览 |
| 字幕与音乐 | 规划字幕位置和可读性，将关键动作、镜头变化与音乐时间线对应起来，并标明待核对的落点 |
| 检查与交付 | 校验分镜数据和画面一致性，检查导出的音视频流，整理可编辑源码、素材记录与 MP4 |

这些环节可以由具备文件读取、代码执行和视频处理能力的 AI 助手逐步完成。提供歌曲文件后，离线分析可以给出能量、停顿、起音、BPM 和相位候选；歌词时间与关键落点仍需要结合校对文本和试听核对。技能会记录演示、草稿或已核对状态，让每个阶段的结果都清楚可追踪。

## 适合做怎样的作品

- **像素游戏风音乐 MV**：用小人物、任务、道具和场景变化表达歌词，让一首歌像一段可以观看的游戏剧情。
- **双人叙事与情绪短片**：围绕靠近、等待、错过、陪伴、回应等主题，让人物的行动承接歌曲情绪。
- **副歌片段与音乐短视频**：先做一段约 10–15 秒的代表片段，确认人物动作、字幕和转场，再继续扩展。
- **可编辑的代码动画工程**：把镜头、动作和字幕保留在源文件里，方便换歌、改色、改人物、调整节奏和反复导出。

你可以直接给出喜欢的主题，例如“夜晚、两岸、纸船、暖色灯光”，也可以只确定歌曲与画幅，让 AI 先提出分镜。已有角色设定、画风或代码工程时，将它们一起交给 AI，技能会围绕你的选择组织后续制作。

### 角色辨识度与画面质感

角色好看不只靠配色和装饰；观众应当在缩小、去色或切回群像后仍认得出是谁。这个 Skill 会先把角色当作造型系统设计，再进入场景和动画：

1. 给每位主角建立角色卡，记录叙事功能、头部/发型、身形比例、服装轮廓、常用姿态、材质、识别物和持物位置。
2. 把角色缩到同一尺度并做纯黑剪影测试。去掉姓名、颜色和手持小物后，每人仍应至少凭头部/服装轮廓、身形/重心、姿态三类中的两类与其他人区分。
3. 在成片里最小的群像尺寸复查；较大的近景另备细节素材，不把小精灵直接放大充当特写。
4. 质感按大形、色块、材质光影、少量识别细节逐层增加。统一像素尺度和光源方向，用褶皱、发束和克制反光表现材质；噪点、模糊和堆配件不能替代造型。

参考视频可借鉴“剪影清楚、姿态有性格、细节受控”等原则，不照搬具体角色设计。完整规范见 [像素世界与演出](skills/lyric-driven-code-mv/references/pixel-game-visuals.md#角色差异度与完成度门槛)。

### 逐句歌词变成可读画面

代码控制不是“先画一个大场景，再把歌词放上去”，而是让每句都有可辨的主体、动作和结果；相邻几句可以留在同一地点，但镜头焦点与事件必须推进。制作时先用角色/物件模块保持身份，再用统一时间线驱动逐帧画面；先审关键帧和无字幕版，确认物件与动作读得懂后再细化光影与材质。

- [代码控制视觉提示法](skills/lyric-driven-code-mv/references/code-directed-visuals.md)：分阶段提示词、逐句视觉账本、关键帧→代码实现→无字幕验收模板。
- [四场景逐句演示（带字幕说明）](skills/lyric-driven-code-mv/assets/demos/four-cue-scene-change-demo.mp4) · [同一演示（无字幕）](skills/lyric-driven-code-mv/assets/demos/four-cue-scene-change-no-captions.mp4) · [接触表](skills/lyric-driven-code-mv/assets/demos/four-scene-contact.png)。它使用原创示例文案和代码绘制，静音，不对应任何真实歌曲；用于检查每句的视觉变化，而非展示完整成片质感。

### 适用边界

本项目面向**歌词驱动的角色/场景叙事和代码动画 MV**。如果只需要逐句显示歌词、K 歌字幕或纯文字卡点，不需要角色行动和故事画面，请改用更适合歌词字幕、素材蒙太奇和纯文字音乐短片的 `music-to-video` Skill。

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

技术工具不会替你取得歌曲、录音、歌词或参考素材的使用许可；发布前请按素材实际许可确认可用范围及署名要求。提供未发行或私人音频前，请确认所用 AI/工具如何处理文件；仓库内置的本地脚本不会自动上传。

## 内置工具与原创模板

仓库内置一套 **12 秒纸船与两岸灯光演示**，包含人物动作、场景变化、摄像机留边、尾段转场、高分辨率字幕和本地生成的原创节奏。可以先把这个工程跑通，再让 AI 按你的歌曲与分镜改写。

- **离线音频分析**：使用 Node 内置模块与 FFmpeg，输出能量、停顿、起音和 BPM/相位候选；支持输入已知 BPM、合并邻近候选，并明确标识低置信网格。
- **分镜校验**：检查时间范围、镜头覆盖、角色/道具引用、装置类型、章节覆盖、HUD 数值范围与材质变体，并提示跨镜歌词、显式踩拍和授权记录缺项。
- **确定性 QA**：预热后重复、逆序和乱序求值同一批帧，单独记录首次光栅差异；适配器可提供清理钩子，让浏览器等资源在检查后正常退出。
- **同步候选图**：把能量、候选拍点、镜头边界和字幕区间放在同一时间轴，输出SVG与JSON并报告起点误差，帮助定位需要试听核对的位置。
- **卡点校验**：标了 `event.sync:"beat"` 的动作会被拿去和 `music.beats` 网格比对，偏离超过 `beatToleranceMs`（默认 80 ms）就报警告，`--strict` 下直接失败。完整链路见 [音乐卡点：从拍点到校验](#音乐卡点从拍点到校验)。
- **可读变化密度**：`hud-density.mjs` 统计切镜、材质、HUD、事件、音效、歌词句头和章节牌七类时间点，报告最长空白窗与单镜内部空窗；同一时刻的多项变化只算一个点。它帮助检查变化密度，不代替对动作是否易读的人工审片。
- **平台安全区**：`safe-area.py` 在帧或视频上叠顶部、底部 8.5%、右侧 6.5%、4:3 与 9:16 五条参考线，字幕底边与 HUD 关键读数必须躲开；它在开发中抓出过双语字幕压底、HUD 压顶两个真问题。
- **点阵标题牌**：`pixel-font.py` 把数字与字母烘成 6×8 点阵（图集 PNG + 点阵 JSON），中文仍用系统字体，混排接近参考片的标题牌质感。
- **最小渲染器**：`minimal-renderer.py` 用 Pillow 与 FFmpeg 生成占位画面，检查标题牌、数值 HUD、字幕和版面位置；它不绘制完整场景，不是成片渲染器。正式画面请使用 starter 或现有视频工程。
- **装置模板库**：`assets/devices/` 五个可直接粘的骨架（私信、读档、清单、结算、双轴滑块），各带三条外壳规则、`scene.hud[]` 与 4–5 个带数值事件；字段映射见 [装置模板](skills/lyric-driven-code-mv/references/device-templates.md)。
- **音效合成**：`scripts/sfx.mjs` 用振荡器与确定性噪声合成八种音效（tick / type / click / whoosh / confirm / error / riser / chime），长度严格等于 `project.duration`，首尾自动淡入淡出；`project.sfx[]` 与 `scene.sfx[]` 由校验器检查类型、时间、增益、`hitAt` 与 visual/beat/free 锚点。两层对齐关系见 [音效层与卡点](skills/lyric-driven-code-mv/references/sfx-and-beat.md)。
- **音轨追踪与单帧检查**：音频重定位核对同一素材，导出保存实际音轨哈希与署名记录；可先导出某个时点的世界层PNG，再检查正式成片字幕。
- **两种导出方式**：管道直出适合快速验证；PNG 落盘与恢复适合保留渲染进度。
- **画面验收**：通过接触表查看整体叙事，再检查每镜和转场的关键帧。

内置模板使用已有 Node.js、FFmpeg 与 FFprobe。HTML/Canvas/SVG 工程可按需要使用，HTML 动效路线可选择 HyperFrames，React 工程可选择 Remotion；其他框架的依赖由 AI 根据现有环境和你的选择配置。设计分镜时先选承载叙事的装置（聊天、游戏系统、时间轴、章节牌或材质舞台），再拆场景；可用 `chapters`、`scene.hud` 和 `materialVariant` 记录章节、情绪数值和同构图变奏。镜头不设固定秒数上限，按信息密度安排，建议每 8–12 秒有一次可读变化。

参考像素游戏歌词视频时，可在分镜顶层加入 `captionStyle`，把歌词变成画面内 UI，而不是普通外挂字幕。`mode:"scene-panel"` 会在预览和 ASS 导出中同步生成暖白主歌词、淡色辅助行、红粉描边、深色像素面板、角标装饰和章节牌；`placement:"integrated"` 会把面板放进画面下方安全区。未提供该字段仍使用旧的普通底部双语字幕，旧分镜无需修改。

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

这套配置只负责歌词和章节牌的视觉层，不会替代歌词时间校对；关键动作仍按“能量自动、关键动作确认后卡点”的混合模式落到时间线上。

细化装置、HUD、字幕和参考片证据时，按需阅读 [装置与章节](skills/lyric-driven-code-mv/references/story-devices.md)、[HUD 与字幕](skills/lyric-driven-code-mv/references/hud-and-subtitles.md)、[渲染故障预防](skills/lyric-driven-code-mv/references/render-pitfalls.md) 与 [参考片取证](skills/lyric-driven-code-mv/references/reference-film-analysis.md)。这些资料把画面观察、可复现测量和技术推断分开记录。

## 音乐卡点：从拍点到校验

上面那句"先给能量和拍点候选，关键动作由你确认后再锁定为卡点"，落到工具上是四步，每步都有输出：

**① 分析音轨，拿到拍点候选**

```powershell
node skills/lyric-driven-code-mv/scripts/analyze-audio.mjs 'path/to/song.wav' --start 37.2 --duration 12 --out work/analysis.json
```

已知速度就直接给，并把依据写清，工具会停止猜：

```powershell
node skills/lyric-driven-code-mv/scripts/analyze-audio.mjs 'path/to/song.wav' --start 37.2 --duration 12 --bpm 110 --bpm-source metadata --bpm-evidence '曲目页标注 110 BPM' --out work/analysis.json
```

输出是 `status:"draft"` 的报告，含 `energy`、`pauses`、`onsets`、`tempo`（BPM + 相位 + 置信度 + 半速/双速歧义）和 `beats` 网格。对合成的 120 BPM 节拍实测：

```text
bpm 120 | status=estimated | confidence 0.9855 | periodSeconds 0.5 | phaseSeconds 0.000484
beats 24 个（0.000484, 0.500484, 1.000484 …） | onsets 24
ambiguities: 60（half）、240（double）
```

**② 把拍点写进分镜**

`music.beats[]` 存拍点秒数，必须严格递增且都落在 `[0, duration)` 内；要在拍上发生的动作标 `event.sync:"beat"`：

```json
"music": { "status": "draft", "beats": [0.0, 0.5, 1.0, 1.5] },
"events": [
  { "at": 5.501, "action": "灯亮的一瞬落在拍上", "sync": "beat" },
  { "at": 5.63,  "action": "这一下晚 130ms，校验器会报", "sync": "beat" }
]
```

**③ 让校验器判，不靠眼睛**

```powershell
node skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs work/storyboard.json
node skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs --strict work/storyboard.json
```

上面那两条事件的实测结果：

```text
普通模式：警告：scenes[0].events[1].at: sync:"beat" 最近节拍=5500ms，偏差 offsetMs=130；容差 80ms
         分镜校验通过。                                    退出码 0
strict：  严格检查未通过：仍有 1 条警告。                    退出码 1
```

偏 0.5 ms 的那条不报警，偏 130 ms 的这条被抓出来。容差由 `project.settings.beatToleranceMs` 控制，默认 80 ms。校验器用毫秒报告偏差；负值表示提前，正值表示滞后。以下只摘录关键字段，具体提示文字以当前命令输出为准。

**④ 画出来看整段有没有系统性错位**

```powershell
node skills/lyric-driven-code-mv/scripts/visualize-sync.mjs work/storyboard.json work/analysis.json --out work/sync-review.svg
python skills/lyric-driven-code-mv/scripts/timeline-sync.py 'path/to/song.wav' --storyboard work/storyboard.json -o work/timeline.png --json work/timeline.json
```

前者出 SVG + JSON（能量、候选拍点、镜头/字幕区间、每个起点误差），并检查 `duration`/`sourceOffset` 与分镜是否一致；后者更快，出 PNG 和一份切点到最近拍点的偏移统计：

```text
duration 12.00s | beats 23 | 120 BPM (speculative) | cuts 2 | lyrics 4
cut-to-beat offset median 250ms, max 500ms, within 80ms: 1/2
```

`within 80ms` 比例高说明切点大致落在拍上；median 偏大说明整段错位，该回去改时窗，而不是改画面。

**⑤ 叠音效层：按事件选择同步锚点**

不同音效可以服务画面动作、音乐重拍或自由氛围；长 whoosh/riser 可以先起声，再让主体攻击或峰值落点。参考作品里测到的瞬变分布只能描述那支作品，不能推出“音效不该踩拍”或“所有音效都该踩拍”。本 Skill 为每条音效明确区分波形起点 `at`、目标落点 `hitAt` 与锚点 `anchor`。

音效写进分镜，和画面事件同层，才能被同一份校验器检查：

```json
"project": { "sfx": [{ "at": 0, "type": "riser", "gain": 0.40 }] },
"scenes": [{
  "events": [{ "at": 3.0, "action": "数字跳到 42", "sync": "beat" }],
  "sfx":    [{ "at": 3.0, "hitAt": 3.0, "anchor": "visual", "type": "tick", "gain": 0.60 }]
}]
```

```powershell
# 一条命令：合成音效轨 → 与音轨混音 → 编码，直接出带音效的成片
node skills/lyric-driven-code-mv/assets/templates/starter/export.mjs --storyboard work/storyboard.json --audio 你的歌.wav --sfx --out work/final.mp4
```

要单独拿一条音效轨（贴进别的剪辑软件），或自己控制混音权重：

```powershell
node skills/lyric-driven-code-mv/scripts/sfx.mjs --from-storyboard work/storyboard.json --out work/sfx.wav --report work/sfx-report.json
ffmpeg -y -i work/demo.mp4 -i work/sfx.wav -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:weights=1 0.85:normalize=0,alimiter=limit=0.95" -c:v copy -c:a aac -b:a 192k work/final.mp4
```

`--sfx` 默认权重 0.85，`--sfx-gain 0.6` 可调；分镜里一个 sfx 都没写时它直接报错，不会悄悄漏掉音效。八种音效全是代码合成的（tick / type / click / whoosh / confirm / error / riser / chime），没有采样素材也就没有授权问题。

验证器要如实解释：只给混音轨时，事件附近 RMS 上升只能说明观察到瞬变，纯 BGM 鼓点也可能触发，**不能证明来源是 SFX**。如需归因候选，额外提供完全对齐的 BGM-only 无损参考轨：

```powershell
node skills/lyric-driven-code-mv/scripts/verify-sfx.mjs --audio work/mixed.wav --reference-audio work/music-only.wav --storyboard work/storyboard.json --window-ms 50 --out work/sfx-evidence.json
```

同路径差分也只是候选证据；最终仍须试听，并检查最终有损编码。`9/9` 表示九个事件窗口都观察到瞬变，不等同于九个 SFX 均已完成因果归因或峰值卡点验证。

**能证明什么、不能证明什么**

- 能：拍点网格在哪、哪个动作偏了多少毫秒、整片切点是否系统性地不在拍上。
- 不能：`status:"draft"` 不能升级成 `verified`——那需要人工核听，并填 `evidence.reviewer` 与含时区的 `reviewedAt`。
- 不能：BPM 永远带半速/双速歧义（80 BPM 的歌在 160 BPM 网格上也"对得齐"），工具把歧义列出来，选哪个要人耳定。
- 字幕不必逐句贴拍；只有显式标了 `sync:"beat"` 的事件才受 80 ms 容差约束。

## 从零到成片

第一次用、又不打算让 AI 代劳的，读 [GETTING-STARTED.md](GETTING-STARTED.md)：它把装依赖、装 skill、跑通 12 秒、单帧排错、接入自己的歌、离线找拍点、三档校验、断点续渲和验收串成一条可以直接照抄的路径，每一步都给出实测输出和出错处理。文中所有耗时、帧数、BPM 与偏差毫秒均为真实运行结果。

## 安装

从仓库根目录获取本项目；若尚未克隆：

```powershell
git clone https://github.com/zizhengLI4/lyric-driven-code-mv-skill.git
cd lyric-driven-code-mv-skill
```

复制整个 `skills/lyric-driven-code-mv` 目录到 Codex 的 skills 目录，模板、脚本和参考文档都随安装保留；不要只复制 `SKILL.md`。Windows 可用：

```powershell
$taskSkillRoot = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'skills' } else { Join-Path $env:USERPROFILE '.codex/skills' }
New-Item -ItemType Directory -Path $taskSkillRoot -Force | Out-Null
$taskSkillTarget = Join-Path $taskSkillRoot 'lyric-driven-code-mv'
if (Test-Path -LiteralPath $taskSkillTarget) { throw '同名 skill 已存在，请先检查内容再合并。' }
Copy-Item -LiteralPath './skills/lyric-driven-code-mv' -Destination $taskSkillTarget -Recurse
```

安装 skill 不会安装视频框架、模型或 API。最小 starter 需要已有 Node.js、FFmpeg（含 `libx264`、`libass`）和 FFprobe；代码侧使用 Node 内置模块，不需 `npm install`。`Pillow` 仅供接触表、字幕/安全区检查等 Python 辅助脚本使用；使用这些脚本前可检查 `python -c "import PIL"`，缺失时按需安装：

```powershell
python -m pip install -r skills/lyric-driven-code-mv/requirements.txt
```

macOS/Linux 可将整个目录复制到 `~/.codex/skills/lyric-driven-code-mv`（若设置了 `CODEX_HOME`，使用其下的 `skills/` 目录）。其他框架、字体、模型、API 或付费服务均为可选项，不会由 Skill 静默安装或调用。已安装同名 Skill 时先备份并比较本地改动，再更新，避免覆盖个人修改。

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

模板通过 `SCENE_RENDERERS[scene.id]` 选择画法；内置 `send` 与 `receive`，新增故事镜头时由 AI 实现对应画法。真实歌曲的字幕和时窗只修改 JSON；音频为原曲时按 `project.sourceOffset` 裁剪。成片默认不烧草稿水印（`draft` 也不烧，要成片内可见提示须显式写 `project.draftMark:true`），核对进度由导出资产清单记录。预览、音轨时基与恢复规则见 [starter README](skills/lyric-driven-code-mv/assets/templates/starter/README.md)。

## 开发与检查

```powershell
node skills/lyric-driven-code-mv/scripts/analyze-audio.mjs 'path/to/song.wav' --start 37.2 --duration 12 --out work/analysis.json
node skills/lyric-driven-code-mv/scripts/analyze-audio.mjs 'path/to/song.wav' --start 37.2 --duration 12 --bpm 110 --out work/known-bpm.json
node skills/lyric-driven-code-mv/scripts/visualize-sync.mjs work/storyboard.json work/analysis.json --out work/sync-review.svg
node skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs skills/lyric-driven-code-mv/assets/storyboard-example.json --delivery
node skills/lyric-driven-code-mv/scripts/hud-density.mjs skills/lyric-driven-code-mv/assets/storyboard-example.json --max-gap 12
python skills/lyric-driven-code-mv/scripts/timeline-sync.py work/beat120.wav --storyboard skills/lyric-driven-code-mv/assets/storyboard-example.json -o work/timeline.png
python skills/lyric-driven-code-mv/scripts/safe-area.py --video work/demo.mp4 --at 3 10 -o work/safe-check.png
python skills/lyric-driven-code-mv/scripts/minimal-renderer.py skills/lyric-driven-code-mv/assets/storyboard-example.json --probe 0 120 300 --out work/probe
node --test
```

测试可使用 `FFMPEG_PATH` / `FFPROBE_PATH` 指向已有程序；PATH 中缺少工具时只跳过需要实际解码/编码的用例，并说明原因。显式配置无效路径会报错。`--strict` 把结构警告升级为失败，通过它仍需核听；草稿交付须附 `music.pendingChecks` 具体时间区间与检查内容。使用说明见 [SKILL.md](skills/lyric-driven-code-mv/SKILL.md)、[时间与分镜](skills/lyric-driven-code-mv/references/storyboard-and-timing.md)、[像素/字幕](skills/lyric-driven-code-mv/references/pixel-game-visuals.md)、[音频/授权](skills/lyric-driven-code-mv/references/audio-and-rights.md)、[依赖/验收](skills/lyric-driven-code-mv/references/dependencies-and-delivery.md)。

长期维护、复现反馈、兼容性、发布与回退流程见 [维护指南](MAINTENANCE.md)。同步图的误差解释与器乐叙事字幕说明见 [同步复核](skills/lyric-driven-code-mv/references/sync-review.md)；音效与拍点的两层关系见 [音效层与卡点](skills/lyric-driven-code-mv/references/sfx-and-beat.md)；装置骨架的字段映射见 [装置模板](skills/lyric-driven-code-mv/references/device-templates.md)；40 条参考作品的复盘与改进依据见 [案例研究](docs/CASE-STUDY-2026-11.md)。
