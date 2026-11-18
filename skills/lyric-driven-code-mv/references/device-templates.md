# 装置模板（可直接粘的骨架）

装置选型见主文档的“装置与章节”参考入口；这里给的是**能直接粘进分镜的骨架**：一个 `device` 段、一两个 `hud` 项、一组带数值的事件，字段与 `assets/storyboard-example.json` 完全一致。

| 文件 | `device.type` | 一句话 | HUD |
|---|---|---|---|
| [chat-window.json](../assets/devices/chat-window.json) | `chat` | 全片一条对不上话的时间线 | 火花天数（`counter`） |
| [save-load.json](../assets/devices/save-load.json) | `game-system` | 关系做成可存档的东西 | 存档格位（`checklist`） |
| [checklist-quest.json](../assets/devices/checklist-quest.json) | `game-system` | 把喜欢拆成可执行的小事 | 已完成项数（`counter`） |
| [settlement-panel.json](../assets/devices/settlement-panel.json) | `game-system` | 一段关系的结算与评级 | 总分（`score`）+ 评级（`badge`） |
| [dual-axis-slider.json](../assets/devices/dual-axis-slider.json) | `timeline` | 时间和心情做成两根轴 | 时间轴百分比（`axis`） |

`device.type` 的合法值为：`chat`、`game-system`、`timeline`、`counter`、`chapter-card`、`viewfinder`、`material-stage`。校验器会拒绝其他取值。

## 怎么用（三步）

1. **选一个**：按主文档“装置与章节”参考入口的决策表定类型，不按"哪个好看"定。
2. **抄 `device` 段**，改 `name` 与 `purpose`，把 `rules` 换成你这一支片的规矩（规矩要能被画面验证：能不能见面、有没有时间戳、谁在看）。
3. **抄 `hud` + `events`**，然后**按你自己的歌词重排时间**：

```text
模板给的是 20 秒级的骨架，不是你的段落长度。
段落有多长，就把事件按"每 8–12 秒一次变化"重新摊开：
  4 分钟的歌，一个装置里大约需要 20–30 个带 hud 的事件。
```

`sceneTemplate` 是本镜五个字段的写法示范，直接贴进 `scenes[]` 再改。`events[].hud` 是字符串，写的是"这一刻变成什么"；`scene.hud[]` 写的是"本镜的读数"，两者配合才能让校验器和渲染器都读得懂。

## 每个模板最容易做错的地方

| 模板 | 常见错误 | 改法 |
|---|---|---|
| 聊天窗口 | 两条消息之间空了 20 秒，靠镜头抖动撑 | 用「正在输入…」「已读」「语音条 0:07」顶住空档 |
| 读档界面 | 三格存档全写满 | 留一格空的，才有"还能重来"的错觉 |
| 任务清单 | 六项平均分配时间 | 前三项快，最后一项拖长；允许取消勾选 |
| 结算面板 | 高分高评 | 分数与评级要自相矛盾，否则是庆功不是结算 |
| 双轴滑块 | 两根轴同向变化 | 一横一纵；加阻尼、卡住、拖不过去 |

## 模板不做的事

- 不含歌词、旋律与旋律时间。`events[].at` 是**示例秒数**，必须按你的分镜重写。
- 不含画面。`device` 只描述外壳的规则；画成什么样由 `pixel-game-visuals.md` 与 `templates/starter` 决定。
- 不保证"照抄就好看"。装置只解决结构，情绪仍然要靠动作与数值。

## 自检

```powershell
node skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs --strict storyboard.json
node skills/lyric-driven-code-mv/scripts/hud-density.mjs storyboard.json --max-gap 12
```

第二条会告诉你：这个装置在时间轴上哪里空了、空多久。空窗超过 12 秒，先从模板的 `events` 里补一条变化，别再想着加镜头。
