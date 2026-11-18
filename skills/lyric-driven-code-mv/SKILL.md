---
name: lyric-driven-code-mv
description: Use when creating or improving a lyric-driven code music video, pixel-game narrative, interface MV, or song-to-story storyboard—especially requests such as “给这首歌做个 MV”, “歌词视频”, “像素剧情 MV”, or “音乐可视化” with lyrics, characters, story, or code animation, or “按歌词和鼓点检查副歌分镜”. 适用于歌曲背景考据、人物/故事、连续分镜、角色任务、节奏检查，以及画面像 PPT、高潮弱、人物动作异常、模糊或转场僵硬的现有 MV；不适用于单独频谱动画、给采访加逐字字幕、普通口播或仅做字幕剪辑；例如“给纯器乐做频谱动画”不单独触发本 Skill。
---

# 歌词驱动代码 MV

把歌曲情绪写成可观看的游戏演出：**歌词决定画什么，音乐决定何时强调。** 角色目标、行动、反馈和结果要形成连续因果；进度条、道具、章节牌和转场都服务于这条因果链。

## 默认人物与故事入口

只要人物或剧情至少有一项未指定，新作就主动联网搜索查歌曲背景，不先反问“你想要什么故事”。人物已指定则保留人物、补剧情；剧情已指定则保留剧情、补人物；两者都已指定或只改已有工程的字幕、混音、导出时，不重写叙事。歌名/版本只有在无法辨认且会改变故事时才追问。

查到的创作缘起、作者/演唱者经历和歌词只作为证据与灵感，不把歌手生平直接当角色经历。先根据歌曲背景、歌词意象和用户给的形象约束，先生成主角外观卡；再构思阻碍、配角和世界规则，最后把目标、行动、反馈和结果写成故事。事实、推断、创作分开记录。联网失败或找不到可靠材料时，明确说明并标为原创演绎。具体规则见[歌曲考据与故事转译](references/song-research-and-story.md)和[主角外观卡与衣装连续性](references/character-design.md)。

## 参考入口

只打开当前问题需要的 reference；参数、容差、退出码和字段细节以 reference 为唯一依据。

- **歌曲与叙事：**[歌曲考据与故事转译](references/song-research-and-story.md)、[主角外观卡与衣装连续性](references/character-design.md)、[装置与章节](references/story-devices.md)、[装置模板](references/device-templates.md)、[时间与分镜](references/storyboard-and-timing.md)、[HUD 与字幕](references/hud-and-subtitles.md)。
- **视觉与参考片：**[像素世界与演出](references/pixel-game-visuals.md)、[参考片分析](references/reference-film-analysis.md)。
- **节奏与质量检查：**[时间工具选型与同步检查](references/sync-review.md)、[音效与卡点](references/sfx-and-beat.md)、[渲染故障预防](references/render-pitfalls.md)。
- **制作与交付：**[音频与授权](references/audio-and-rights.md)、[依赖与交付](references/dependencies-and-delivery.md)。

## 核心三步与最小可用子集

最小核心先分两种情况：**没有真实音频**时，只跑分镜结构校验和可读变化密度，能离线完成，不声称音画同步；**有真实音频**时，再增加音频分析与出片前时间核对。Pillow、FFmpeg、接触表、同步图、布局检查和渲染器都按当前问题按需调用，不是每次都必跑。

### 1. 固定输入与证据

确认歌曲/录音版本、歌词或器乐说明、截取范围、画幅、人物设定、交付范围和授权限制。人物或剧情缺失时先完成歌曲考据；有音频就分析实际片段，所有时间统一使用成片秒。机器分析只是候选，不自动代表已核听。

### 2. 做连续分镜与代表片段

先生成主角外观卡和一张目标像素尺寸的角色/剪影验收帧；再构思阻碍、配角和世界规则，按歌曲段落建立“目标 → 行动 → 反馈 → 结果”。保持人物、道具、位置和 HUD 跨镜连续；无歌词副歌/间奏也要沿故事线推进，不只保持静止空镜。先做约 10–15 秒代表片段，沿用用户已有框架；无工程时使用内置 starter。分镜 JSON 是时长、字幕、镜头边界、转场和音乐状态的真源。

### 3. 验收后扩展

先跑环境预检、分镜结构检查、变化密度检查和与音频相关的时间检查，再预览代表片段。核对动作峰值、句尾、转场、字幕安全区、画面边缘和去字幕后的叙事；导出后用 FFprobe、完整解码、接触表和关键帧复核。代表片段通过后才扩展到用户授权的范围。

## 环境与失败路由

在 skill 根目录运行 `python scripts/check_environment.py`；它只诊断，不安装软件。`ready` 才表示完整链路可用；`partial` 仍可继续不依赖缺项的分镜与 Node 校验；`needs_setup` 先处理 Node.js 等核心缺项。平台准备、Pillow 安装和缺 FFmpeg/FFprobe 时的处理见[依赖与交付](references/dependencies-and-delivery.md)。安装包、字体、浏览器、模型、API 或付费服务前先说明，不擅自下载或注册。

## 最小命令

以下命令在 skill 根目录运行；更完整的参数和排障命令见对应 reference：

```sh
python scripts/check_environment.py
node scripts/validate-storyboard.mjs path/to/storyboard.json
node scripts/hud-density.mjs path/to/storyboard.json --strict
```

没有真实音频时，校验结果只证明结构和可读变化，不证明音画同步；有真实音频时再按同步参考运行出片前时间总闸。需要渲染或交付时按依赖与交付参考执行。

## 交付边界

`illustrative`、`draft`、`verified` 的条件和必需记录见[时间与分镜](references/storyboard-and-timing.md)。机器分析不能升级为 `verified`；不能试听时交付 `draft`，写清 `pendingChecks`。状态与授权是两件事，技术检查通过不等于可公开发布。

## 完成标准

- 去掉字幕后，动作仍能说明段落含义；重复段落有发展，人物、道具和规则不跳变。
- 分镜与画法可重复求值；代表片段的关键动作、转场、字幕和安全区经抽帧确认。
- 成片音视频流、时长、画幅和帧率符合目标；交付可编辑源文件、分镜/分析数据、资源许可记录、成片和实际验收记录。
- 仅请求报告、分镜或草稿时交付对应阶段，不擅自扩展整曲。
