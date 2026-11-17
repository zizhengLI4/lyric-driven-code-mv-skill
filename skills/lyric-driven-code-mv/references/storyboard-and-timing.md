# 时间与分镜

## 一套成片坐标

源音频从 `sourceOffset` 秒截取；歌词、节拍和事件统一成片秒：

```js
const t = frame / fps;
const sourceTime = sourceOffset + t;
const clipTime = annotatedSourceTime - sourceOffset;
```

只在数据入口换算一次。源片段 `[37.2,49.2)` 中句子 `[38,41)` 转为 `[0.8,3.8)`；重复出现的句子分配新 ID。已经剪好的音频记录 `audio.timebase="clip"` 并从零播放；源文件用 `"source"` 并裁掉 `sourceOffset`，避免重复偏移。分析脚本输出已是 clip 秒，不能再减偏移。

所有区间用 `[start,end)`。截断跨片段边界的歌词及事件，保留必要前置状态。让 `duration=durationFrames/fps`；最后一帧时间为 `(durationFrames-1)/fps`。嵌套场景的 `local=t-scene.start`，Remotion Sequence 内的帧已是局部帧，不能再减场景起点。

## 渲染函数收到什么时间

**在每个渲染入口写明时间含义，并在适配边界转换一次。** 分镜保留成片秒；场景画法可以使用成片秒或镜头局部秒，关键是动作参数与函数入参使用同一坐标。

| 入口或数据 | 时间含义 |
|---|---|
| `renderFrame(clipT)`、JSON 的句起止、`event.at` | 从成片第 0 秒起算 |
| `renderTimelineFrame` 的 `drawScene(index, localT, options)` | `localT=clipT-scene.start`，当前镜从 0 起算 |
| 原曲注释与音轨截取 | `sourceT=sourceOffset+clipT`，仅在音频入口换算 |

例如镜头 `[16.8,46.2)`：成片第 30 秒是 `localT=13.2`；JSON 事件 `at=33` 转为该镜动作点 `eventLocal=16.2`。按成片秒写的 `ramp(t,33,34.4)` 不能直接接收 `localT`。沿用这种旧画法时，可在 `drawScene` 的适配边界恢复成片秒：

```js
const drawScene = (index, localT, options) => {
  const scene = options.timeline.scenes[index];
  return drawUsingClipTime(scene.start + localT, scene, options);
};
```

下一镜预卷的 `localT=0` 恢复为**下一镜的 `scene.start`**，不是转场当下的成片时间。反过来，纯局部画法把 JSON 事件转换为 `event.at-scene.start`，之后不再减镜头起点。

starter 还包含一层演出缩放：JSON 路线在调用 `SCENE_RENDERERS[scene.id]` 前使用 `designT=localT*6/(scene.end-scene.start)`，使内置 `send/receive` 的 6 秒演出适配实际镜长。当前注册画法收到的是这套设计秒；新增画法应声明并适配这个约定。需要直接使用真实 `localT` 的工程可在 `renderTimelineFrame` 的 `drawScene` 层接入自己的画法。不要把设计秒误当成片秒或真实镜头秒。

## 从含义到事件

先写一句“人物想要什么，因什么受阻或改变”，再设计可见演出。

| 含义 | 目标与行动 | 反馈与结果 |
|---|---|---|
| 珍惜纪念物 | 抱起礼物，选择保留，摆上搁板 | 完整礼物留下，保留标记出现 |
| 无法抵达 | 放出纸船，漂向远方，遇到阻碍 | 船停住，路线断裂，仍有距离 |
| 付出与消耗 | 攀升、奔跑、跨过风雪 | 距离增大，体力改变；变化对应动作 |
| 回忆变冷 | 触摸照片，结冰，再尝试解冻 | 图标失色、裂纹、温度格变化 |
| 重新联系 | 两地相望，光锥跨屏，同步举灯 | 连线完成后才共同动作 |

让动作准备稍早开始，峰值对准需要强调的音乐点。缓慢观察、句尾停留和间奏可以继续推进地点、记忆与关系。第一次送纸船失败，第二次揭示另一岸也在等待，可增加信息且保留遗憾；副歌不必全部变成成功。

## 器乐与原创叙事字幕

纯器乐可以配原创叙事字幕。继续用 `lyrics[]` 保存句子、起止与镜头引用，在项目说明或 `note` 里写明“原创叙事字幕，音轨无人声演唱”及文案作者；这不增加必填 schema 字段。文字由故事设计，不称为歌曲中已演唱的歌词。允许整句显示并按阅读需要留时，也可在动作前预示或动作后回应，不套用演唱逐词跟唱规则。

先识别能说明段落变化的音乐结构、音色或和声变化，再为需要强调的动作选择落点；能量拐点与拍点都是候选证据。切镜可以随乐句、留白或叙事结果发生，只对明确声明 `sync:"beat"` 的事件检查踩拍，不要求每镜事件、HUD 负反馈或每个切点都在强拍上。

器乐不自动限定为 `draft`：只有机器分析或尚未试听时保持 `draft`，方法、限制与 `pendingChecks` 写明待确认的乐句边界、节拍相位或动作峰值；人工听辨并核对相关片段后，可以按实际范围记录 `verified`。核对对象是配乐结构、动作与叙事字幕的阅读时序，无人声时不宣称逐词演唱对齐。自编时点的演示仍用 `illustrative`。

## JSON 约定

`schemaVersion:1` 保持兼容，可增加工程特有字段。

| 字段 | 内容 |
|---|---|
| `schemaVersion`, `timebase` | `1`、`"clip"` |
| `project` | `fps,duration,sourceOffset,width,height,virtualWidth,virtualHeight,seed,audio` |
| `project.audio` | `path,timebase,provenance?,license,credit,url?,licenseUrl?,use`，授权说明见音频参考 |
| `device?` | `{id,type,name,purpose}`；先描述承载叙事的界面、系统、时间轴、视角或材质舞台，再决定场景画法 |
| `chapters?` | 至少一个且连续覆盖 `[0,duration)` 的 `{id,start,end,title,meaning}`；用于标题牌、章节牌或关系阶段，不替代 `scenes[]` |
| `lyrics[]` | `id,start,end,text`，可加 `zh,en`；有意跨镜可加 `allowSceneSplit:true,splitReason` |
| `music` | `status,beats[],sections[]:{id,start,end},evidence?,presentationNotice?,pendingChecks?` |
| `music.evidence` | `method,limitations,reviewer?,reviewedAt?`；最后两项用于人工核对 |
| `music.pendingChecks[]` | `{start,end,check}`：成片秒区间与具体未确认内容；草稿交付时必需非空 |
| `actors[]`、`props[]` | 稳定人物 ID 与 `costumes[]`；道具 ID 列表 |
| `scenes[]` | `id,start,end,meaning,location,objective,action,feedback,outcome,lyricIds,actors,props,events,exit,materialVariant?,hud?` |
| `scene.materialVariant` | `{id,label,change}`；同构图换季节、材质或年代时记录可见变化，画法仍需自行实现 |
| `scene.hud[]` | `{id,type,label,value?,min?,max?,meaning}`；`value` 若提供为非空字符串或有限数，`bar` 要求数值落在 `min..max` 内；类型可为 `counter/bar/heart/status/clock/badge/log/checklist/axis/level/score/banner`，负值、归零、损坏和失败均可作为语义结果 |
| `scene.actors[]` | `{id,costume}` 引用根人物表 |
| `scene.events[]` | `{at,action,hud?,sync?,lyricIds?,meaning?,support?}`；`at` 为成片秒，位于镜头内且升序 |
| `scene.exit` | `{type,dur,origin?,target?}`；类型为 cut/dissolve/ripple/water |

主场景连续覆盖 `[0,duration)`，不重叠、不留洞。角色装束明确指定；道具拥有、消耗与保留另记状态并核对。`scene.lyricIds` 引用与镜头相交的歌词；留白镜头可为空。

先选 `device` 再选场景：装置决定观众如何读懂状态，场景只负责这一段目标、行动、反馈和结果。`chapters` 可以让标题牌、关系卡或结算牌拥有明确时间区间。长镜头没有固定秒数上限；镜长由信息密度决定，建议每 8–12 秒至少有一次可读变化（字幕、HUD、光线、材质、粒子或状态），留白可以保留。

starter 的 `--storyboard` 直接读取项目配置、歌词、场景与 `exit`，绘图函数通过 `SCENE_RENDERERS[scene.id]` 注册。自带 `send/receive` 画法按镜头局部时长求值；新增 ID 需实现对应画法，JSON 只定义分镜而不生成美术。`device`、`chapters`、`materialVariant` 和 `scene.hud` 目前是兼容的语义元数据，校验器会检查结构，但不会替自定义画法生成界面。字幕只从当前 JSON 的 `text/zh/en` 读取；源音频路径与配置覆盖规则见 starter 说明。

`exitTransition` 自由文本仍接受，用于旧工程的叙事说明；新工程采用结构化 `exit` 确定时序。`cut` 的 `dur` 为 0，其他转场满足 `0 < dur < end-start`。`origin` 是两个 `[0,1]` 归一化坐标。`target` 默认为下一镜，也可明确写下一镜 ID；末镜非 cut 必须 `target:"background"`。

starter 当前实现通用分镜规范的执行子集：末镜仅支持 `exit:{type:"cut",dur:0}`。末镜 `target:"background"` 转场需由现有框架或自定义渲染适配实现；通用分镜校验与 starter 执行校验分别检查规范有效性和模板支持范围。

## 出口转场与预卷

```json
{ "exit": { "type": "water", "dur": 0.9, "origin": [0.55, 0.62] } }
```

前镜 `[0,6)` 时，转场窗口为 `[5.1,6)`。窗口中前镜继续按当前 `local=t-start` 求值，下一镜固定 `local=0` 预卷，再按遮罩合成。到 `t=6` 切入下一镜并从零正常播放。末镜淡至背景时只揭示项目定义的背景，不虚构下一镜。

转场占前镜尾段，不另加镜头时长，也不延长总片长。将结果动作安排在转场之前或确保遮罩期间仍可读。水面/地平线等跨镜元素通过相同世界坐标或明确遮罩对齐，重点查看转场中点与边界，避免双地平线。

## 语义提示的边界

- 句子被镜头边界切开会提示；有意拆镜时写 `allowSceneSplit:true` 与具体 `splitReason`，字幕层保持连续。不能由提示直接推断叙事一定错误。
- 仅 `event.sync:"beat"` 检查最近 `beats[]` 的距离，默认容差 80 ms。歌词起句或缓慢动作不必都踩拍；节拍表为空时提示证据不足。调用 `analyzeStoryboard` 的 `beatToleranceMs` 参数可调整容差。
- HUD 可由事件/镜头的 `lyricIds` 支撑，间奏可由 `event.meaning` 或 `support` 解释因果。`event.lyricIds` 必须与本镜相交，并由 `scene.lyricIds` 支持或在事件 `at` 时有效；预示动作可添加镜头级引用。引用可定位不等于含义已经正确。
- 普通模式返回提示；`--strict` 将全部警告升为失败。这是结构检查的退出码策略，草稿可以通过，状态仍为 `draft`。`--delivery` 检查许可记录与音乐证据，`audio.use` 为 publish/public/commercial 时也启用同样检查；两者通过均不证明许可有效或实际音画已经核对。

音乐状态遵循 SKILL.md 三档规则。`draft` 可以有空 beats；交付检查要求方法、限制与非空 `music.pendingChecks`。每项满足 `0 <= start < end <= duration`，`check` 写明尚未确认的句起止、节拍相位或动作落点；仅“待核对”或 `pending` 等占位文本会失败。例如：

```json
"pendingChecks": [
  { "start": 6.3, "end": 8.5, "check": "确认重复句尾音与伸手动作峰值的对应关系；目前只有机器时点" }
]
```

清单在普通模式可省略，保持旧分镜兼容；提供时仍校验字段和区间。校验器能确认可定位的记录，具体描述是否完整需在核听时判断。`verified` 必须有人工核对记录。均分逐字点亮属于视觉填充；离线起音检测不是歌词识别或对齐。

## 确定性求值

```js
const local = t - shot.start;
const progress = Math.max(0, Math.min(1, (t - actionStart) / actionDuration));
const sprite = Math.floor(Math.max(0, local) * spriteFps) % frames.length;
const x = Math.round(x0 + (x1 - x0) * progress);
const state = events.filter(e => e.at <= t).reduce(applyEvent, initialState());
```

位置、镜头、数值、粒子和遮罩都由时间求值，随机初值固定种子；物理可预模拟保存轨迹。`renderFrame(t,options)` 返回 `{width,height,data}`，data 为 RGBA 字节数组；同一时间与 options 应给出相同像素。资源先准备好，不能使用运行中的页面时钟或上一帧累积状态。

```sh
node scripts/qa.mjs path/to/frame.mjs --duration 12 --fps 30 --storyboard path/to/storyboard.json --out work/qa.json
```

脚本自动覆盖首尾、每镜首/中/尾、转场前/中/后及事件周围，用正序、重复、逆序和固定乱序比较 SHA-256。`--times 0,5.1,5.55,6` 可专查落点。其他框架提供一个导出相同 RGBA 契约的适配模块；浏览器 profile、资源准备及预热见 [渲染与恢复](dependencies-and-delivery.md#渲染与恢复)。报告只检查所抽样时间在当前环境的确定性。
