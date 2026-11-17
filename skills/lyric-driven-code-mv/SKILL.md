---
name: lyric-driven-code-mv
description: Use when a music video needs code animation that responds to lyric meaning, especially pixel game narratives with characters, quests, recurring motifs, and music timing. 适用于歌词呼应的代码音乐 MV、像素游戏叙事分镜及其实现；单纯频谱动画或普通口播剪辑无需使用。
---

# 歌词驱动代码 MV

把歌曲情绪写成可观看的游戏演出：**歌词决定画什么，音乐决定何时强调。** 用人物的目标、行动、反馈和结果表达含义，进度条、道具和转场服务于这一因果链。

## 工作流程

1. **固定输入与证据。** 确认歌曲文件及版本、校对歌词、截取范围、画幅、人物设定和交付范围。自己找歌时先读 [音频与授权](references/audio-and-rights.md)，核对作品及录音的使用条件。分析参考片时分别记录可见事实、音频核对结果和实现推断；只有完成全时段检查才称“看完整片”。作者工具无源码或声明证据时标为未知。
2. **建立两条时间线。** 标注句起止、段落、重要重音和留白；语义表记录人物关系、意象和动作。读 [时间与分镜](references/storyboard-and-timing.md)，统一成片坐标与原曲偏移。器乐配原创叙事字幕时说明文案角色，不当作演唱转录。已有 FFmpeg 时先用 `scripts/analyze-audio.mjs` 生成离线能量、停顿、起音和 BPM/相位候选；需要同轴检查镜头和字幕时读 [同步候选图](references/sync-review.md)。不把候选当歌词对齐，无法试听也可完成透明标注的草稿。
3. **先选装置，再选场景。** 先确定聊天、游戏系统、时间轴、计数器、章节牌、视角或材质舞台，再为每镜写目标→行动→反馈→结果。用 `chapters[]` 记录标题牌、关系阶段和结算；用 `scene.hud[]` 表达数值、状态、归零、损坏或失败的情绪反馈；同构图换季节、材质或年代时写 `materialVariant`。镜长由信息密度决定，不设固定上限；建议每 8–12 秒至少有一次可读变化，长镜头也可用于等待和留白。参考 [装置与章节](references/story-devices.md) 和 [HUD 与字幕](references/hud-and-subtitles.md)；要现成骨架时从 [装置模板](references/device-templates.md) 的五个 JSON（私信、读档、清单、结算、双轴滑块）里挑一个改写，别从空白开始。反复意象安排首次出现、变化和再出现；重复副歌增加信息或后果。保留人物身份、装束和道具来龙去脉。像素美术、摄像机、字幕和双人叙事读 [像素世界与演出](references/pixel-game-visuals.md)。
4. **选择一种实现路线。** 沿用用户指定框架及现有工程。无框架且需要最小可运行工程时，复制 `assets/templates/starter/`：仅 Node 内置模块与 FFmpeg 即可预览和导出。HTML 动效工程可采用 HyperFrames，React 工程优先 Remotion。实现前读 [依赖与交付](references/dependencies-and-delivery.md)，列出必需项、已有项和可选项；安装包、下载浏览器/模型/字体、使用 API 或付费服务前先说明并沿用已有授权。
5. **完成代表片段。** 新作品先完成约 10–15 秒，包含人物动作、歌词意象任务、反馈变化及转场；用户指定其他长度或修改已有工程时按其范围。分镜 JSON 作为时长、歌词、场景边界、转场及音乐状态的真源，代码按 `scene.id` 提供画法。每帧由时间直接求值，粒子固定种子。出口转场占前镜尾段，下一镜固定 `local=0` 预卷，不增加总时长。执行结构校验和 `scripts/qa.mjs` 的重复、逆序、乱序像素比较。
6. **扩展与验收。** 先预览代表片段，核对动作峰值、句尾、转场、字幕与摄像机边缘，再扩展已授权范围。导出后执行 FFprobe、完整解码、接触表和关键帧检查；具备播放条件时完整播放，逐项记录真实完成的检查。不能试听时交付 `draft`，明确待核对落点，不能声称音画已核对。

## 音乐证据与交付阶段

| `music.status` | 条件 | 交付义务 |
|---|---|---|
| `illustrative` | 自编时点、占位音轨或原创演示 | 开头显示“演示时点”，记录 `presentationNotice:true`；说明不是对应真实歌曲的对齐结果 |
| `draft` | 已有音频，机器分析或未经试听的标注 | `evidence.method` 写推定方法，`limitations` 写误差来源；`pendingChecks[]` 记录具体时间区间与未确认内容，允许交付草稿成片 |
| `verified` | 人工核对了相关音频、歌词与关键落点 | 记录 `evidence.reviewer`、含时区完整时间戳 `reviewedAt`（如 `2026-11-17T08:00:00Z`），交付说明写核对范围 |

自动分析不能升级为 `verified`。逐字时点按句长均分时，字幕说明为视觉填充；BPM 的半速/双速歧义、伴奏起音、拖音及源偏移均可能造成误差。缺少音频时先交付 `illustrative` 分镜或演示，不因无法试听无限等待。状态与授权是两项独立条件，草稿状态不能代替发布许可。

## 模板与命令

复制 [原创 12 秒分镜](assets/storyboard-example.json) 并替换内容。最小工程见 [starter 说明](assets/templates/starter/README.md)，自带纸船、两岸灯光、尾段转场、高分辨率字幕及本地生成的原创节奏。`export.mjs --storyboard` 读取分镜配置；真实歌曲先更新 `project.audio` 与证据，`--audio` 只能重定位同一素材，按 `scene.id` 调整或注册画法。导出保存实际音轨哈希及来源记录，外部音轨有 `credit` 时生成片尾短署名，发布前仍核对完整署名义务。字幕与音乐状态提示由 JSON 生成。

以下在 skill 目录运行；其他目录使用脚本的绝对路径：

```sh
node scripts/analyze-audio.mjs path/to/song.wav --start 37.2 --duration 12 --out work/audio-analysis.json
node scripts/validate-storyboard.mjs assets/storyboard-example.json
node scripts/validate-storyboard.mjs path/to/storyboard.json --delivery
node scripts/visualize-sync.mjs path/to/storyboard.json work/audio-analysis.json --out work/sync-review.svg
node scripts/qa.mjs assets/templates/starter/frame.mjs --duration 12 --fps 30 --storyboard assets/storyboard-example.json --out work/qa.json
node assets/templates/starter/export.mjs --storyboard assets/storyboard-example.json --out work/demo.mp4
node assets/templates/starter/export.mjs --frame-time 5.55 --frame-out work/world-frame.png
node assets/templates/starter/export.mjs --storyboard path/to/storyboard.json --audio path/to/song.wav --out work/mv.mp4
```

量节奏、看音画、查安全区、做点阵标题牌：

```sh
node scripts/hud-density.mjs path/to/storyboard.json --max-gap 12        # 可读变化密度与空白窗
python scripts/timeline-sync.py song.wav --storyboard storyboard.json -o work/timeline.png
python scripts/safe-area.py --video work/mv.mp4 --at 3 10 -o work/check.png
python scripts/film-sheet.py shots/<片名> -o sheet.jpg --cols 3
python scripts/pixel-font.py --sample work/title-sample.png
python scripts/minimal-renderer.py path/to/storyboard.json --probe 0 120 300
node scripts/sfx.mjs --from-storyboard path/to/storyboard.json --out work/sfx.wav --report work/sfx-report.json
node scripts/sfx.mjs --list
```

`hud-density.mjs` 把切镜、材质、HUD、事件、音效、字幕六类变化摊到时间轴上，报最长空白窗与单镜内部空窗；`--strict` 时有空窗即非零退出。`timeline-sync.py` 从音轨取能量包络并估拍点，与切镜、字幕画进同一张图，标 `speculative` 的 BPM 只能用来发现整段踩错，不能据此宣称同步。`safe-area.py` 叠平台安全区（顶部、底部 8.5%、右侧 6.5%、4:3、9:16），字幕底边与 HUD 都要躲开。`minimal-renderer.py` 是不用 starter 工程也能出画面的最小实现，演示标题牌、数值 HUD 与双语字幕。`sfx.mjs` 合成八种音效（tick/type/click/whoosh/confirm/error/riser/chime），长度严格等于 `project.duration`，供混音使用；两层对齐关系见 [音效层与卡点](references/sfx-and-beat.md)——**画面踩拍点，音效跟画面同帧，音效不踩拍**。

校验器保留 `validateStoryboard(data) → errors[]`，提供 `analyzeStoryboard(data,{beatToleranceMs,delivery}) → {errors,warnings}`。普通提示不改变退出码；`--strict` 只是将结构检查中的警告视为失败，通过不证明可发布或 `verified`。`--delivery` 检查许可记录、音乐证据及草稿待核对清单，字段规则见时间与分镜参考。跨镜歌词、显式踩拍事件、HUD 支撑、装置/章节覆盖及授权缺项都有可定位的提示；工具不证明语义正确、许可有效或实际音画同步。

## 完成标准

- 去掉字幕，动作仍能说明段落含义；HUD 变化可追溯到行动，道具先获得再使用。
- 重复段落有发展，等待、失败、完成及留白与歌曲情绪相称。
- 同帧重复和乱序求值一致，首尾、每镜及转场没有状态漂移；摄像机移动不露黑，字幕清晰。
- 字幕底边与 HUD 都在平台安全区内：用 `safe-area.py` 叠一帧确认，别只看成片。
- `hud-density.mjs` 报出的最长空窗不超过 12 秒；超过就先补变化，别加镜头。
- 音效落在画面事件上（不是拍点上），`project.sfx[]`/`scene.sfx[]` 通过校验，混音后峰值不削顶。
- 成片音视频流、时长、画幅和帧率正确；音乐证据状态及实际检查范围写清楚。
- 交付可编辑源文件、分镜与分析数据、资源来源/许可/署名、所选依赖锁文件（使用依赖时）、成片和简短验收记录。仅请求报告、分镜或草稿时交付对应阶段，不擅自扩展整曲。
