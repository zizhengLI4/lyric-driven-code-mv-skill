# 程序化音效与 BGM 对齐

代码合成音效的同步，核心是把**音乐时间、画面事件时间、声音包络时间**放进同一条成片时钟。不是每个音效都要贴每一拍；每个 SFX 要先选它要强调的锚点，再安排“波形何时开始”以及“攻击/主体峰值何时落点”。

## 每个音效选一种锚点

| 锚点 | 使用情形 | 时间安排 |
|---|---|---|
| 画面事件 | UI click、数字 tick、物件接触、脚步落地 | 声音的可听攻击点对准画面事件；若画面事件本身落在重拍，它就会同时卡拍 |
| 音乐重拍 | 明确强调鼓点、段落落点或副歌冲击 | 将音效的主攻击/冲击峰值对准经核实的重拍，而不只是把较长音效的文件起点放在重拍 |
| 提前起声（编排手法，非 schema 锚点） | whoosh、riser、吸气、反向音等有预备段的音效 | 选择 visual 或 beat 锚点；把波形起点 `at` 放在目标前，以 `hitAt` 表示目标事件/节拍；不要写 `anchor:"preroll"` |
| 自由氛围 | 房间底噪、持续风声、无节拍环境层 | 按场景持续区间安排，不伪装成逐拍命中 |

“音效永远不要踩拍”和“每个音效都要踩拍”都是错误的通则。应逐事件选择锚点；画面与音乐本身在一处重合时，关联音效可以自然同时命中两者。提前起声只是 `at < hitAt` 的编排方式，不是第四种 `anchor` 值。

## 八种代码音色

| type | 时长 | 合成声源/包络 | 常见用途 |
|---|---:|---|---|
| `tick` | 45 ms | 1200 Hz 方波，短衰减 | 数值、刻度、进度推进 |
| `type` | 100 ms | 三连短噪声 | 短标签或界面文字逐字出现 |
| `click` | 35 ms | 2200 Hz 方波叠噪声 | 按钮、光标确认 |
| `whoosh` | 420 ms | 确定性噪声扫频 | 转场、章节切换 |
| `confirm` | 220 ms | 880→1320 Hz 双音上行 | 勾选、达成 |
| `error` | 300 ms | 下行锯齿波 | 失败、归零 |
| `riser` | 600 ms | 180 Hz 起的上升锯齿与噪声 | 段落前铺垫 |
| `chime` | 850 ms | 三音和弦 | 结算、收束 |

时长和波形以当前 `scripts/sfx.mjs` 为准；`pitch` 会同时改变音高与时长。以上是合成器的用途参考，不取代听感或混音验收。

## 统一时间基准

分镜 `at` 使用成片/clip 秒，`sfx.mjs` 按 `round(at * 44100)` 把音效写到确定的采样帧。原曲中的标注时间要先转换一次：

```text
clipTime = sourceTime - project.sourceOffset
sourceTime = project.sourceOffset + clipTime
```

如果输入音频已经裁成片段并声明 `project.audio.timebase:"clip"`，片段从 0 秒开始，不要再减一次偏移。starter 根据 `project.audio.timebase:"source"` 与 `sourceOffset` 接原曲时，也使用成片秒编排 SFX；不要把音效的 BGM 起点再加回原曲偏移。

示例：从原曲 37.2 秒开始制作，原曲 38.8 秒的目标鼓点换算为成片 1.6 秒。事件标 `at:1.6`。切点或事件使用 `sync:"beat"` 时由已有分镜拍点校验；SFX 的起点 `at` 可以早于目标击中点。

## 起始时间不等于听感落点

当前 SFX JSON 的 `at` 是合成波形的**起始时间**。短促 `tick/click` 的攻击接近波形开头，通常可直接设成目标时间；长 `whoosh/riser/chime` 的主体峰值可能晚于 `at`。先单独渲染该音效、测它的攻击和主体峰值相对起点的偏移 `peakOffset`，再安排：

```text
sfx.at = sfx.hitAt - peakOffset
```

例如现有 `whoosh` 约 420 ms，主要能量在中段；若经试听/波形确认主体峰值距起点约 210 ms，目标落点为成片 1.600 秒，则可先试 `sfx.at = 1.390`，再听感复核。这个偏移是该音色的测量值，不是通用常数。现有 `riser` 往往以尾端作为高潮，应让上升段早开始、终点到 beat；若需要额外存储一个 `peakAt` 字段，先扩展 schema、校验器、渲染与测试，不要让 prompt 约定一个运行时忽略的 JSON 字段。

## 代码合成与混音步骤

1. **分析用户提供的实际 BGM 文件**：取得拍点/小节线、强起音、段落和片段偏移候选。`librosa.beat_track`/`onset_strength` 等可给候选，半速/双速与变速曲会误判；关键落点结合原曲试听或波形确认，标记 `draft`/`verified` 状态。
2. **给画面事件选锚点**：需要踩重拍的动作在 `events[].at` 标记 `sync:"beat"`；非拍点叙事动作不强迫吸附。视觉 click 可与相应事件同秒；直接强调音乐的 SFX 可根据 SFX 的内部攻击/峰值偏移提前起声。
3. **生成独立、确定性的 SFX 轨**：使用合成振荡器、滤波噪声、频率扫描和 ADSR/振幅包络；重复相同参数和时间应逐采样一致。既有 `scripts/sfx.mjs` 已按采样帧将各音色放进长度严格等于 `project.duration` 的 WAV。
4. **保留原曲，单独控制 SFX 增益**：使用 `amix` 等混音把原曲与 SFX 轨组合，限幅避免削波。保留独立原曲和 SFX 轨；不要为了混音覆盖输入素材。BGM 版本、裁切点、增益及输出音轨哈希可记录在资产清单。
5. **试听并检验落点**：先听独立 SFX 确认攻击与峰值，再听 BGM+SFX；检查目标重拍上的主体峰值是否清楚、尾音是否影响下一句、SFX 是否掩盖人声或低频主拍。逐事件留下通过/未通过记录，而不是只给整首一个“同步通过”。

```json
{
  "scenes": [{
    "events": [
      { "at": 1.5, "action": "手掌拍下，画面触点落重拍", "sync": "beat" },
      { "at": 2.3, "action": "旋钮停稳", "sync": "none" }
    ],
    "sfx": [
      { "at": 1.5, "type": "click", "gain": 0.45, "hitAt": 1.5, "anchor": "beat" },
      { "at": 2.09, "type": "whoosh", "gain": 0.35, "hitAt": 2.3, "anchor": "visual" }
    ]
  }]
}
```

第二个事件可用 `{ "at": 2.09, "hitAt": 2.3, "anchor": "visual", "type": "whoosh" }` 在视觉事件前启动约 210 ms；该值是示意，真实 `peakOffset` 应测量并试听后再定。

当前校验器支持可选 `anchor: "visual" | "beat" | "free"` 与 `hitAt`：visual 锚点只放在 `scene.sfx[]`，并要求同一镜头存在同一时刻的 `scene.events[]`；beat 锚点对照 `music.beats`，使用 `hitAt` 而非波形起点 `at`；free 不做拍点/视觉事件约束。未填写锚点的旧格式 `{at,type,gain,pitch}` 继续兼容。beat 容差默认为 80 ms，也可由 `project.settings.beatToleranceMs` 调整。

导出入口：

```powershell
node assets/templates/starter/export.mjs --storyboard work/storyboard.json --audio path/to/song.wav --sfx --out work/final.mp4
```

## 验证边界

一条 209.1 秒参考片的既往样本检测记录为 218 个宽带瞬变候选，其中 84 个与所选 132.3 BPM 网格相差小于 80 ms，中位偏差约 141 ms。这只描述该片和该检测方法，不能推断创作者意图、瞬变来源，也不能作为所有 SFX 的同步规则。


- `scripts/analyze-audio.mjs` 的 beat/onset 是音乐定位候选；它不能独立证明歌词解释正确，或用户偏好的落点一定是最近拍点。
- 当前 `scripts/verify-sfx.mjs` 读取混音后的 PCM，只检查事件时间附近 RMS 是否有上升。纯 BGM 的鼓点也可能使它显示候选命中；它**不能证明瞬变由 SFX 引起，也没有验证长 SFX 的主峰值是否落到目标 beat**。所以将其报告解释为“该窗口观察到瞬变”，不是“音效源已归因且同步通过”。
- 若要验证混音里确实有 SFX，保留同一导出路径下的 BGM-only 与 BGM+SFX 两个无损对照，按同一起点/采样率逐段相减；比较事件前基线、目标攻击/峰值窗口和尾部，再检查有损编码的最终 MP4 并实际试听。RMS 只能补充证据，不能替代 A/B 差分与听感判断。
- `gain`、限幅和总响度要检查最终混音；不应仅凭 SFX 单轨未削波就宣称完整混音没有削波。

## 来源

- [librosa beat tracking](https://librosa.org/doc/main/generated/librosa.beat.beat_track.html)：从输入音频的 onset strength 估计 tempo 和 beat positions，属于分析候选。
- [Web Audio API `AudioScheduledSourceNode.start(when)`](https://developer.mozilla.org/en-US/docs/Web/API/AudioScheduledSourceNode/start)：实时预览需要按 AudioContext 时钟排程时，使用 audio time 而非普通 JS 定时器。
- [MDN `OfflineAudioContext.startRendering()`](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext/startRendering)：在浏览器里离线合成一段可重复渲染的 PCM。
- [FFmpeg `amix` filter](https://ffmpeg.org/ffmpeg-filters.html#amix)：将独立音轨合成输出；需要在实际混音后检查增益与峰值。
- [djj45/mv-kit 声音交付说明](https://github.com/djj45/mv-kit/blob/main/docs/SOUND-DELIVERY.md)：独立音轨、时间线交付与输出后同步回测的公开工程示例；它与本 Skill 的程序合成器是不同实现。
