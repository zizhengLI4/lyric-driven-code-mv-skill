# 12 个可复用像素场景

每个 `.mjs` 文件导出一个 `create<Name>Scene(options)` 工厂。通用参数为：

- `duration`：局部动作的设计时长（秒），默认沿用该场景原设计时长。
- `subject: { x, y }`：主体的取景中心，默认使用场景预设位置。
- `palette`：按颜色名覆盖 RGB/RGBA 数组，例如 `{ neon: [255, 86, 132] }`。未知颜色名、非法时长和无效颜色会报错。
- `render(local, { width, height, seed, camera })`：生成局部时间 `local` 的纯 RGBA 帧；改时长会按比例调整原动作速度。

```js
import { createNeonScene } from './neon.mjs';

const neon = createNeonScene({
  duration: 8,
  subject: { x: 204, y: 104 },
  palette: { neon: [255, 120, 160] },
});
const frame = neon.render(2.5, { seed: 'my-film', width: 384, height: 216 });
```

模块名对应这些演出：`window` 隔窗、`leave` 离开、`empty` 空房、`turn` 转身、`neon` 霓虹、`street` 长街、`shatter` 碎裂、`lesson` 教训、`night` 夜色、`dawn` 黎明、`path` 远路、`lookback` 回望。实现共用 [core.mjs](core.mjs) 的纯帧画法与 FB；单个资产只需选择一个场景并配置参数，可直接作为 starter 的自定义镜头渲染器使用。
