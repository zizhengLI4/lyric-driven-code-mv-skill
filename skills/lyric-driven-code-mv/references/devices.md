# 装置、章节与长镜头

## 先选装置

装置是观众用来理解状态的外壳。先问“这个关系或目标正在什么系统里运行”，再拆场景：

| 装置 | 适合表达 |
|---|---|
| `chat` | 消息流入、已读、时间戳、未发送的回应 |
| `game-system` | 角色属性、任务清单、存档、菜单、结算 |
| `timeline` | 年份、滑块、站点、过去与现在 |
| `counter` | 天数、次数、年龄、心率、进度 |
| `chapter-card` | 歌名牌、关系阶段、章节和结算 |
| `viewfinder` | 圆窗、准星、手机或掌机视角 |
| `material-stage` | 同一构图的季节、材质或年代变奏 |

在 JSON 顶层写 `device`、`chapters` 和可选的 `captionStyle`，场景写 `materialVariant` 和 `hud`。这些字段帮助分镜和复核保持一致；starter 会把 `captionStyle.mode:"scene-panel"` 与章节标题绘制成歌词面板和章节牌，世界层的新 HUD 仍需由自定义画法实现。

## HUD 是情绪的反馈

HUD 不只是装饰。每个条目必须写清 `meaning`，说明数值如何回应人物行动。可以使用 `counter`、`bar`、`heart`、`status`、`clock`、`badge`、`log`、`checklist`、`axis`、`level`、`score`、`banner`。正向增长、下降、归零、损坏和失败都可以成立，例如 `心情 -56`、`心碎 -99`、`HP 0`、`存档已损坏` 或 `伪劣值 100%`。

不要为了“像游戏”给每镜加数值。没有行动因果的 HUD 会变成噪声；间奏 HUD 可以用事件的 `meaning` 或 `support` 解释它为什么出现。

## 标题牌、章节牌与关系卡

开头 0–5 秒可以用歌名、演唱者或视觉母题建立识别。中段用 `chapters[]` 记录关系阶段、时间段或视角切换，结尾用结算牌、存档结果或留白收束。章节应该连续覆盖成片时间，但不要求每章对应一个场景，也不替代歌词和事件。

## 长镜头判据

镜头长度本身不是质量标准。一个 13–30 秒的固定机位如果持续出现可读变化，就能承担一个段落；建议每 8–12 秒至少出现字幕、HUD、光线、材质、粒子或状态变化。若信息密度很低，缩短镜头；若等待和留白是叙事结果，保留长镜头并在分镜里写清目的。

## 证据边界

参考片复盘如果只有均匀抽帧，只能支持构图、装置、HUD、字幕和段落顺序。它不能证明 BPM、实际音画同步、缓动曲线、粒子生命周期或作者使用 Remotion、Canvas、AE 等技术栈；这些结论必须标为推断，或补充音频、逐帧和原始工程证据。

## 可直接使用的装置模板

下列为**能直接粘进分镜的骨架**：一个 `device` 段、一两个 `hud` 项、一组带数值的事件，字段与 `assets/storyboard-example.json` 完全一致。

| 文件 | `device.type` | 一句话 | HUD |
|---|---|---|---|
| [chat-window.json](../assets/devices/chat-window.json) | `chat` | 全片一条对不上话的时间线 | 火花天数（`counter`） |
| [save-load.json](../assets/devices/save-load.json) | `game-system` | 关系做成可存档的东西 | 存档格位（`checklist`） |
| [checklist-quest.json](../assets/devices/checklist-quest.json) | `game-system` | 把喜欢拆成可执行的小事 | 已完成项数（`counter`） |
| [settlement-panel.json](../assets/devices/settlement-panel.json) | `game-system` | 一段关系的结算与评级 | 总分（`score`）+ 评级（`badge`） |
| [dual-axis-slider.json](../assets/devices/dual-axis-slider.json) | `timeline` | 时间和心情做成两根轴 | 时间轴百分比（`axis`） |

`device.type` 的合法值为`chat`、`game-system`、`timeline`、`counter`、`chapter-card`、`viewfinder`、`material-stage`。校验器会拒绝其他取值。

### 怎么用（三步）

1. **选一个**：按本页装置选型表和故事中的后果确定类型。
2. **抄 `device` 段**，改 `name` 与 `purpose`，把 `rules` 换成你这一支片的规矩（规矩要能被画面验证：能不能见面、有没有时间戳、谁在看）。
3. **抄 `hud` + `events`**，然后**按你自己的歌词重排时间**：

```text
模板给的是 20 秒级的骨架，不是你的段落长度。
段落有多长，就把事件按"每 8–12 秒一次变化"重新摊开：
  4 分钟的歌，一个装置里大约需要 20–30 个带 hud 的事件。
```

`sceneTemplate` 是本镜五个字段的写法示范，直接贴进 `scenes[]` 再改。`events[].hud` 是字符串，写的是"这一刻变成什么"；`scene.hud[]` 写的是"本镜的读数"，两者配合才能让校验器和渲染器都读得懂。

### 每个模板最容易做错的地方

| 模板 | 常见错误 | 改法 |
|---|---|---|
| 聊天窗口 | 两条消息之间空了 20 秒，靠镜头抖动撑 | 用「正在输入…」「已读」「语音条 0:07」顶住空档 |
| 读档界面 | 三格存档全写满 | 留一格空的，才有"还能重来"的错觉 |
| 任务清单 | 六项平均分配时间 | 前三项快，最后一项拖长；允许取消勾选 |
| 结算面板 | 高分高评 | 分数与评级要自相矛盾，否则是庆功不是结算 |
| 双轴滑块 | 两根轴同向变化 | 一横一纵；加阻尼、卡住、拖不过去 |

### 模板不做的事

- 不含歌词、旋律与旋律时间。`events[].at` 是**示例秒数**，必须按你的分镜重写。
- 不含画面。`device` 只描述外壳的规则；画成什么样由 `pixel-game-visuals.md` 与 `templates/starter` 决定。
- 不保证"照抄就好看"。装置只解决结构，情绪仍然要靠动作与数值。

### 自检

```powershell
node "<SKILL_DIR>/scripts/validate-storyboard.mjs" --strict storyboard.json
node "<SKILL_DIR>/scripts/hud-density.mjs" storyboard.json --max-gap 12
```

第二条会告诉你：这个装置在时间轴上哪里空了、空多久。空窗超过 12 秒，先从模板的 `events` 里补一条变化，别再想着加镜头。
