---
name: lyric-driven-code-mv
description: Use when creating or improving lyric-driven code music videos with pixel characters, game/interface narratives, recurring motifs, or music timing; also when character designs feel generic or indistinguishable, the chorus lacks payoff, or visuals blur or cut stiffly. Do not use for standalone lyric/karaoke subtitles or typography-only music videos; route those to music-to-video. 中文：适用于用户说“帮我把这首歌做成 MV”、创作歌词驱动的像素角色/游戏界面叙事，或改进角色辨识度、副歌高潮、画面清晰度和转场的任务。不用于纯歌词/K歌字幕或纯文字卡点视频；此类使用 music-to-video。
metadata:
  channel: local
---

# 歌词驱动代码 MV

把歌曲情绪写成可观看的游戏演出：**歌词决定画什么，音乐决定何时强调。** 用人物的目标、行动、反馈和结果表达含义，进度条、道具和转场服务于这一因果链。

## 从歌曲背景到人物与故事

新作或重写叙事时，只要人物或剧情有一项未指定，就主动使用当前助手的联网搜索工具，不要求用户先编故事。只指定人物，就保留人物、补剧情；只指定剧情，就保留剧情、补人物。两项都已指定，或只在已有工程上改字幕、混音、导出时，不启动这一步。

1. **认准作品。** 用歌名、词曲作者、演唱者及录音版本交叉检索，再查「歌名 + 创作缘起 / 访谈」和原语言关键词。区分原作背景与翻唱者的演绎；同名作品无法辨认且会改变剧情时再问版本。只搜索公开标识，不上传私人录音或未发行歌词；用户禁止联网时不搜索。
2. **查到可以引用的事实。** 打开创作者访谈、官方专辑说明或同期报道，不把搜索摘要当来源。在项目制作笔记记录标题、链接、支持的事实和采用它的镜头。没有来源把某段真实经历与作品联系起来，就不把它说成创作动机；歌词里的「我」也不自动等于歌手。
3. **让背景推动行动。** 先用一句话串起主角的目标、阻碍、选择和结局，再随实际歌曲段落安排可见的行动与后果。默认可以用原创角色转译真实背景，明确区分事实与改编。例如，仅证实创作与迁居有关，可让虚构主角在主歌打包旧物、副歌试着寄回钥匙、尾声决定把钥匙留下。迁居有出处，钥匙是编剧的道具，不是真人轶事。
4. **接到成片。** 把人物写进 `actors`，把行动和后果写进每镜的 `objective`、`action`、`feedback`、`outcome`，并在对应 `scene.id` 的画法中实际呈现；重复副歌应看见前一次选择造成的变化。继续下面的样片、渲染和验收步骤，按用户要求的时长交付，不停在背景摘要。无法联网或查不到可靠材料时，说明限制，按歌词或器乐情绪创作并标明「原创演绎，非真实经历」。

人物设定、研究记录与故事弧的详细模板见 [从一首歌到连续分镜](references/research-and-story.md)。从歌曲分析、逐阶段提示词到动作样片和交付，可继续读 [像素 MV 分阶段制作](references/pixel-mv-production.md)。已有成片出现角色、高潮、清晰度或转场问题时，先读 [进阶评审与定向优化](references/mv-review-and-refinement.md)，按同一量尺定向修改与复评。
## 工作流程

**先做依赖预检。** Pillow 只被 `scripts/` 下的 Python 脚本使用，声明在技能目录的 `requirements.txt`。先运行 `python -c "import PIL"` 检查并报告缺失；如确实需要安装，先向用户说明 `Pillow`、版本、用途和安装命令，得到同意后再执行，不把 `pip install` 放进自动预检。

Node 侧零第三方包：`scripts/`、`assets/scenes/`、`assets/templates/starter/` 下的 `.mjs` 只 import `node:` 内置模块，skill 目录内没有 `package.json`，**不需要 `npm install`，离线可用**——`validate-storyboard.mjs`、`hud-density.mjs` 同样如此。FFmpeg/FFprobe 是系统二进制，按第 4 步核对。

1. **固定输入与证据。** 确认歌曲文件及版本、校对歌词、截取范围、画幅、人物设定和交付范围。自己找歌时先读 [音频与授权](references/audio-and-rights.md)，核对作品及录音的使用条件。分析参考片时分别记录可见事实、音频核对结果和实现推断；只有完成全时段检查才称“看完整片”。作者工具无源码或声明证据时标为未知。
2. **建立两条时间线。** 标注句起止、段落、重要重音和留白；语义表记录人物关系、意象和动作。读 [时间与分镜](references/storyboard-and-timing.md)，统一成片坐标与原曲偏移。器乐配原创叙事字幕时说明文案角色，不当作演唱转录。已有 FFmpeg 时先用 `scripts/analyze-audio.mjs` 生成离线能量、停顿、起音和 BPM/相位候选；需要同轴检查镜头和字幕时读 [同步候选图](references/sync-review.md)。不把候选当歌词对齐，无法试听也可完成透明标注的草稿。
3. **先过角色辨识度，再选装置与场景。** 三人以上主要角色先建立角色卡和等尺度纯黑剪影对照；去掉名字、配色和小道具后，仍须凭头部/服装轮廓、身形比例或姿态中的至少两类区分每人。群像最小实际显示尺寸和单人近景都要通过；失败时先重画角色，不靠换色、加小饰品或滤镜掩盖。
4. **先选装置，再选场景。** 先确定聊天、游戏系统、时间轴、计数器、章节牌、视角或材质舞台，再为每镜写目标→行动→反馈→结果。每句歌词先落到视觉账本：具体主体/物件、可识别特征、景别、准备→动作→结果、材质/光线；不能只给同一大场景换字幕。相邻四五句后检查是否需要换场景或推进内部事件，不机械一行一切。用 `chapters[]` 记录标题牌、关系阶段和结算；用 `scene.hud[]` 表达数值、状态、归零、损坏或失败的情绪反馈；同构图换季节、材质或年代时写 `materialVariant`。镜长由信息密度决定，不设固定上限；建议每 8–12 秒至少有一次可读变化，长镜头也可用于等待和留白。参考 [装置与章节](references/story-devices.md) 和 [HUD 与字幕](references/hud-and-subtitles.md)；要现成骨架时从 [装置模板](references/device-templates.md) 的五个 JSON（私信、读档、清单、结算、双轴滑块）里挑一个改写，别从空白开始。反复意象安排首次出现、变化和再出现；重复副歌增加信息或后果。保留人物身份、装束和道具来龙去脉。像素美术、摄像机、字幕和双人叙事读 [像素世界与演出](references/pixel-game-visuals.md)。
5. **选择一种实现路线。** 沿用用户指定框架及现有工程。无框架且需要最小可运行工程时，复制整个 `assets/templates/starter/`；其中已包含共享核心与运行文件，复制后可独立运行 `node export.mjs --help`。HTML 动效工程可采用 HyperFrames，React 工程优先 Remotion。实现前读 [依赖与交付](references/dependencies-and-delivery.md)，列出必需项、已有项和可选项；安装包、下载浏览器/模型/字体、使用 API 或付费服务前先说明并沿用已有授权。
6. **完成代表片段。** 新作品先交角色卡/剪影表、关键帧接触表、原尺寸动作条和约10–15秒样片；若有三人以上主角，样片须同时包含一个单人辨识镜头和一个群像镜头，确认单人近景切回群像后仍能认出同一角色。每句歌词须有对应的可见焦点和动作结果；先审关键帧与无字幕版，再补动画。样片还必须包含歌词意象任务、反馈变化及转场；用户指定其他长度或修改已有工程时按其范围。分镜 JSON 作为时长、歌词、场景边界、转场及音乐状态的真源，代码按 `scene.id` 提供画法。每帧由时间直接求值，粒子固定种子。出口转场占前镜尾段，下一镜固定 `local=0` 预卷，不增加总时长。执行结构校验和 `scripts/qa.mjs` 的重复、逆序、乱序像素比较。
8. **扩展与验收。** 先预览代表片段，核对动作峰值、句尾、转场、歌词面板与摄像机边缘，再扩展已授权范围。修改已有成片时先审片定位问题，只改对应镜头并定向复评；保留用户已确认的转场和画面决定。参考像素歌词视频时，在分镜顶层使用 `captionStyle.mode:"scene-panel"`，让浏览器预览、ASS 导出和章节牌保持同一套暖白/描边/像素面板参数；不提供时保留普通底部字幕兼容旧稿。导出后执行 FFprobe、完整解码、接触表和关键帧检查；具备播放条件时完整播放，逐项记录真实完成的检查。不能试听时交付 `draft`，明确待核对落点，不能声称音画已核对。

## 音乐证据与交付阶段

| `music.status` | 条件 | 交付义务 |
|---|---|---|
| `illustrative` | 自编时点、占位音轨或原创演示 | 开头显示“演示时点”，记录 `presentationNotice:true`；说明不是对应真实歌曲的对齐结果 |
| `draft` | 已有音频，机器分析或未经试听的标注 | `evidence.method` 写推定方法，`limitations` 写误差来源；`pendingChecks[]` 记录具体时间区间与未确认内容，允许交付草稿成片 |
| `verified` | 人工核对了相关音频、歌词与关键落点 | 记录 `evidence.reviewer`、含时区完整时间戳 `reviewedAt`（如 `2026-11-17T08:00:00Z`），交付说明写核对范围 |

自动分析不能升级为 `verified`。逐字时点按句长均分时，字幕说明为视觉填充；BPM 的半速/双速歧义、伴奏起音、拖音及源偏移均可能造成误差。缺少音频时先交付 `illustrative` 分镜或演示，不因无法试听无限等待。状态与授权是两项独立条件，草稿状态不能代替发布许可。

## 画法规范

像素场景按“背景 → 装饰/光晕 → 主体 → 前景遮挡”的顺序绘制。装饰必须先于主体落笔，避免光晕、反光或粒子盖住主体轮廓；在 starter 的 `FB` 中用 `fb.layer({ glow: layer => ..., subject: layer => ... })` 固定该顺序，`fb.glow(x, y, radius, color)` 只绘制底层光晕。画面构图应检查主体占比、整体亮度和单色面积；`scripts/qa.mjs` 会对可分析帧提示主体估算占比低于 0.5%、平均亮度低于 30/255 或单一颜色超过 60%。这些是筛查提示，不能替代抽帧审片。

例如霓虹招牌镜头先铺夜景，再画光晕与招牌主体，最后加前景遮挡。`layer` 的两个回调都会收到同一个 `FB` 实例，先执行 `glow`，再执行 `subject`：

```js
fb.rect(0, 0, 384, 216, nightSky); // 背景
fb.layer({
  glow: layer => layer.glow(258, 72, 32, [255, 62, 164], { alpha: 0.65 }),
  subject: layer => {
    layer.rect(231, 52, 54, 38, [28, 26, 42]); // 招牌底板
    layer.rect(237, 59, 42, 4, [255, 110, 194]); // 招牌字形
    layer.rect(250, 92, 16, 42, coat); // 主体人物
  },
});
fb.rect(0, 190, 384, 26, foreground); // 前景遮挡
```

## 模板与命令

复制 [原创 12 秒分镜](assets/storyboard-example.json) 并替换内容。最小工程见 [starter 说明](assets/templates/starter/README.md)，自带纸船、两岸灯光、尾段转场、高分辨率字幕及本地生成的原创节奏。`export.mjs --storyboard` 读取分镜配置；真实歌曲先更新 `project.audio` 与证据，`--audio` 只能重定位同一素材，按 `scene.id` 调整或注册画法。导出保存实际音轨哈希及来源记录，外部音轨有 `credit` 时生成片尾短署名，发布前仍核对完整署名义务。字幕与音乐状态提示由 JSON 生成。

以下在视频工程根目录运行；将 `<SKILL_DIR>` 替换为技能安装目录的绝对路径，分镜/素材输入也用对应路径；所有 `work/` 输出相对视频工程根目录。不要从 Skill 安装目录运行会写文件的命令：

```sh
node "<SKILL_DIR>/scripts/analyze-audio.mjs" path/to/song.wav --start 37.2 --duration 12 --out work/audio-analysis.json
node "<SKILL_DIR>/scripts/validate-storyboard.mjs" "<SKILL_DIR>/assets/storyboard-example.json"
node "<SKILL_DIR>/scripts/validate-storyboard.mjs" path/to/storyboard.json --delivery
node "<SKILL_DIR>/scripts/visualize-sync.mjs" path/to/storyboard.json work/audio-analysis.json --out work/sync-review.svg
node "<SKILL_DIR>/scripts/qa.mjs" "<SKILL_DIR>/assets/templates/starter/frame.mjs" --duration 12 --fps 30 --storyboard "<SKILL_DIR>/assets/storyboard-example.json" --out work/qa.json
node "<SKILL_DIR>/scripts/verify-sfx.mjs" --audio work/mixed.wav --reference-audio work/music-only.wav --storyboard work/storyboard.json --window-ms 50 --out work/sfx-evidence.json
node "<SKILL_DIR>/scripts/lrc.mjs" --lrc work/song.lrc --offset 12 --storyboard work/storyboard.json --out work/lyrics.json
node "<SKILL_DIR>/scripts/new-storyboard.mjs" --preset narrative-12 --duration 90 --lyrics work/lyrics.json --out work/storyboard.json
node "<SKILL_DIR>/assets/templates/starter/export.mjs" --storyboard "<SKILL_DIR>/assets/storyboard-example.json" --out work/demo.mp4
node "<SKILL_DIR>/assets/templates/starter/export.mjs" --frame-time 5.55 --frame-out work/world-frame.png
node "<SKILL_DIR>/assets/templates/starter/export.mjs" --storyboard path/to/storyboard.json --audio path/to/song.wav --out work/mv.mp4
```

量节奏、看音画、查安全区、做点阵标题牌：

```sh
node "<SKILL_DIR>/scripts/hud-density.mjs" path/to/storyboard.json --max-gap 12        # 可读变化密度与空白窗
python "<SKILL_DIR>/scripts/sync-audit.py" path/to/storyboard.json \
  --analysis work/audio-analysis.json --video work/mv.mp4               # 出片前一条命令查全部时间问题
python "<SKILL_DIR>/scripts/layout-check.py" path/to/storyboard.json \
  --hud "档案:56,44,596,200" --hud "神选度:1256,44,1794,200" \
  --log "56,700,640,880" --subtitle-band "360,930,1560,988" \
  --safe "right=124,bottom=92" --scenes "s09-ledger:full-ui"
python "<SKILL_DIR>/scripts/timeline-sync.py" song.wav --storyboard storyboard.json -o work/timeline.png
python "<SKILL_DIR>/scripts/safe-area.py" --video work/mv.mp4 --at 3 10 -o work/check.png
python "<SKILL_DIR>/scripts/film-sheet.py" shots/<片名> -o sheet.jpg --cols 3
python "<SKILL_DIR>/scripts/pixel-font.py" --sample work/title-sample.png
python "<SKILL_DIR>/scripts/minimal-renderer.py" path/to/storyboard.json --probe 0 120 300 --out work/probe
node "<SKILL_DIR>/scripts/sfx.mjs" --from-storyboard path/to/storyboard.json --out work/sfx.wav --report work/sfx-report.json
node "<SKILL_DIR>/scripts/sfx.mjs" --list
node "<SKILL_DIR>/assets/templates/starter/export.mjs" --storyboard path/to/storyboard.json --audio path/to/song.wav --sfx --out work/mv.mp4
```

`scripts/lrc.mjs` 把 LRC 时点按 `--offset` 秒加到片段时钟，逐行推算 `end`；提供 `--storyboard` 时会为跨镜歌词补 `allowSceneSplit` 与原因。`scripts/new-storyboard.mjs` 生成 12 镜待填写骨架，歌词可从 JSON 直接导入。12 个画法资产位于 [assets/scenes](assets/scenes/README.md)，每个工厂都可配置主体取景位置、调色板和镜头时长。`--sfx-script PATH` 可让复制出去的 starter 使用自定义音效模块，不需要改源码。**成片默认不烧草稿水印**：`draft` 也不会在画面上盖字，核对进度由导出资产清单的 `musicStatus`/`draftMark` 与 `music.pendingChecks` 记录；确实需要成片内可见提示时显式写 `project.draftMark:true`（文案 `project.draftMarkText`）。

`sfx.mjs` 合成八种音效（tick/type/click/whoosh/confirm/error/riser/chime），长度严格等于 `project.duration`，供混音使用；两层对齐关系见 [音效层与卡点](references/sfx-and-beat.md)：逐条选择 visual/beat/free 锚点，长音效可在目标前启动，beat 锚点的 hitAt 才参与拍点核对。混音轨 RMS 只能报告瞬变；若使用 BGM-only 差分也只报告归因候选，最终仍需试听。

校验器保留 `validateStoryboard(data) → errors[]`，提供 `analyzeStoryboard(data,{beatToleranceMs,delivery}) → {errors,warnings}`；CLI 读取 `project.settings.beatToleranceMs` 并传入同一分析器。

## 完成标准

- 去掉字幕，动作仍能说明每句的具体含义；主体、道具、接触与结果都可读，HUD 变化可追溯到行动。
- 细节与精致度通过材质、光向、遮挡、角色特征和次级动作体现；不靠抽象装饰、背景铺陈或噪点填满画面。
- 主要角色在纯黑剪影、最小群像尺寸和单人近景间仍可辨，不只靠颜色、姓名牌或小道具识别；单人近景使用独立细节资产，不把低分辨率群像精灵直接放大。
- 重复段落有发展，等待、失败、完成及留白与歌曲情绪相称。
- 同帧重复和乱序求值一致，首尾、每镜及转场没有状态漂移；摄像机移动不露黑，字幕清晰。
- 字幕底边与 HUD 都在平台安全区内：用 `safe-area.py` 叠一帧确认，别只看成片。
- `hud-density.mjs` 报出的最长空窗不超过 12 秒；超过就先补变化，别加镜头。
- 每条音效选择 visual/beat/free 锚点；起点 at 与落点 hitAt 含义清楚。混音后检查峰值，音效来源及同步结论不超出验证证据。
- 成片音视频流、时长、画幅和帧率正确；音乐证据状态及实际检查范围写清楚。
- 交付可编辑源文件、分镜与分析数据、资源来源/许可/署名、所选依赖锁文件（使用依赖时）、成片和简短验收记录。仅请求报告、分镜或草稿时交付对应阶段，不擅自扩展整曲。
