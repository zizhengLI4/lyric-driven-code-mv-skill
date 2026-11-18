# 12 个可复用像素场景

每个 `.mjs` 文件导出一个 `create<Name>Scene(options)` 工厂，并且**自己就是这个镜头的画法真源**：
画法函数、出厂时长、取景中心、默认调色板都写在同一个文件里。不存在「下标数组 + 画法查表」，
改一个镜头不需要动别的文件，删掉某个模块也不会让其它镜头错位。

通用参数（工厂）：

- `duration`：局部动作的设计时长（秒），默认沿用该场景原设计时长。
- `subject: { x, y }`：主体的取景中心，默认使用场景预设位置。它是**愿望值**：由它反推的摄像机会被夹取到
  `CAMERA_LIMITS`（x 120–264、y 70–146、zoom 0.75–1.25，见 [../frame-core.mjs](../frame-core.mjs)）之内，
  越界时静默夹取并 `console.warn` 一次实际使用的值，不再抛错。
- `palette`：按颜色名覆盖 RGB/RGBA 数组，例如 `{ neon: [255, 86, 132] }`。未知颜色名、非法时长和无效颜色会报错。
  调色板在工厂闭包里解析成定值后显式传给画法函数（`draw(fb, t, seed, palette)`），不存在模块级可变状态，
  同一进程里交错渲染不同 palette 的资产不会互相污染。

渲染参数（`render` / `renderSix`）：

- `render(local, { width, height, seed, camera })`：生成局部时间 `local` 的纯 RGBA 帧；改时长会按比例调整原动作速度。
  显式传入 `camera` 时按硬契约校验，越界立即报错。
- `renderSix(local, ...)`：按 6 秒设计空间渲染，不叠加 `subject` 偏置；12 镜成片与
  `SCENE_RENDERERS` 走这一条，与合并前的 `renderScene(index, local)` 逐像素等价。

```js
import { createNeonScene } from './neon.mjs';

const neon = createNeonScene({
  duration: 8,
  subject: { x: 204, y: 104 },
  palette: { neon: [255, 120, 160] },
});
const frame = neon.render(2.5, { seed: 'my-film', width: 384, height: 216 });
```

模块名对应这些演出：`window` 隔窗、`leave` 离开、`empty` 空房、`turn` 转身、`neon` 霓虹、`street` 长街、
`shatter` 碎裂、`lesson` 教训、`night` 夜色、`dawn` 黎明、`path` 远路、`lookback` 回望。

## 目录职责

- 引擎只有一份：[../frame-core.mjs](../frame-core.mjs)（`FB` 含 `glow`/`layer`、5 种转场、时间线求值、`seeded` 与数学工具）。
  starter 模板与这里的所有模块都从它 import，谁也不自带副本。
- [shared.mjs](shared.mjs)：调色板词表 `SCENE_PALETTE`、共用绘图原语（`fill`/`stars`/`skyline`/`figure`/`rain`）、
  以及把「画法 + 出厂参数」包成资产的 `defineScene`。
- [index.mjs](index.mjs)：薄索引，汇总 `SCENE_FACTORIES` / `SCENE_IDS` / `SCENE_ASSETS` / `SCENE_RENDERERS`，
  方便整体注册进 starter 或其它工程。
- [core.mjs](core.mjs)：本片（special / Get Up）的 90 秒时间线表、字幕与注册表，只 re-export 引擎能力，不含画法。
