# 依赖与交付

## 一种路线，最少依赖

从 Skill 安装目录运行：

```bash
node scripts/check-environment.mjs --missing-only
```

预检使用 Node.js 18+，无需 Python 或 npm 包。尚无 Node 时先用 `node --version` 检查。预检只读取本机工具和字体，输出 JSON。省略 `--missing-only` 可看全部结果。

| 状态 | 下一步 |
|---|---|
| `ready` | starter 所需工具可运行。用正式字幕单帧确认实际字形。 |
| `partial` | starter 可运行。按项目需要处理 Pillow 或中文字体提示。 |
| `needs_setup`（退出码 1） | 依据缺项的 `fix` 检查已有安装。可继续写分镜、查时间线或输出 Node 世界层静帧。 |

MP4 导出检查 ASS 滤镜、libx264、AAC 和 FFprobe。正式字幕单帧用 FFmpeg 的 ASS 滤镜。世界层静帧和内置演示的 `--frames-only` 可仅用 Node.js。帧目录模式在裁剪外部音轨时使用 FFmpeg 与 FFprobe，在混合提示音时使用 FFmpeg。未探测到中文字体时先实测目标字形。Pillow 走 Windows 的 `python` 或 macOS/Linux 的 `python3`，预检也支持用 `PYTHON` 指定解释器。Remotion 依赖依具体工程及锁文件检查。

| 路线 | 必需 | 按需要增加 |
|---|---|---|
| 内置 starter / 音频候选 | Node、FFmpeg，导出验收用 FFprobe | 无第三方包、API、模型或浏览器下载 |
| 分镜及确定性校验 | Node；RGBA 渲染适配模块 | 无 |
| HTML + Canvas/SVG + HyperFrames | Node/npm、hyperframes、受支持渲染浏览器、本地资源 | 确实使用的 GSAP 等库 |
| React + Remotion | React/React DOM、remotion、@remotion/cli、支持的浏览器，音轨按官方方案 | 类型、字幕、字体等需要的工具 |

Canvas/SVG 是浏览器原生能力；已有浏览器不代表框架要求的版本已配置。`npx`、脚手架或首次渲染可能下载包/浏览器，执行前说明。Remotion 相关包保持兼容版本、授权按官方说明核实。额外 Python 分析、模型、PixiJS/Three.js、真实游戏系统只在任务需要时选用，不为离线候选分析默认安装。

使用目标环境已有对应 skill：HTML 视频先读 hyperframes 路由，React 视频先读 remotion-best-practices，媒体检查可用 ffmpeg；这些个人 skill 缺失时沿用官方契约与已有工具，不要求整套安装。

## 从已有模板看到画面

无工程时从包内 [starter 说明](../assets/templates/starter/README.md) 开始，复制整个 `assets/templates/starter/` 后保留 `frame.mjs`、同目录的 `frame-core.mjs`、`timeline.mjs`、`png.mjs` 与预览/导出入口；复制后应能独立执行 `node export.mjs --help`。以下在视频工程根目录运行；脚本与模板从技能安装目录读取，所有新文件保存到视频工程的 `work/`：

```powershell
New-Item -ItemType Directory -Path 'work' -Force | Out-Null
Copy-Item -LiteralPath '<Skill 安装目录>/assets/templates/starter' -Destination 'work/my-mv' -Recurse
node work/my-mv/export.mjs --help
node work/my-mv/export.mjs --preview
```

预览地址由命令输出，静音查看首帧、跳播与转场。导出及单帧检查按 starter 当前说明执行；接歌曲时从自己的分镜 JSON 配置 `--storyboard`，音轨记录应描述实际使用的文件。已有工程沿用自己的渲染器与单帧入口，不为获得第一帧另建完整渲染系统。

需要正式画幅和字幕时给单帧命令加 --frame-final。实际歌曲的动态与批量写帧须有场景和人物定版记录。FFmpeg 与 FFprobe 可从本机 PATH 取用，也接受 FFMPEG_PATH、FFPROBE_PATH。参数 --ffmpeg、--ffprobe 和 --sfx-script 应指向本地可信程序或模块。使用项目工作目录或专门的交付目录承接导出。调用额外安装、下载或服务之前说明其用途与所需权限。

## 渲染与恢复

每帧由时间求值。HyperFrames 时间线可 seek；Remotion 用当前帧与固定种子；starter 的 `renderFrame(t)` 输出低分辨率 RGBA，Node zlib 编码 PNG，FFmpeg 整数放大后烧入高分辨率 ASS 字幕。`--storyboard` 统一项目参数、时点和音乐状态；仅 `illustrative` 且没有指定音频时合成原创演示节奏，其他状态使用真实音频。

浏览器捕获前等待 `document.fonts.ready` 及实际使用的图片、音频和其他资产完成加载/解码，随后渲染 2–3 帧预热，再开始像素比较或导出。预热解决字体懒加载和首次光栅初始化，页面时钟与上一帧状态仍须排除。验收和导出固定同一浏览器版本、启动参数、视口、设备缩放与字体/资源，记录这一 profile。

**2D Canvas 的逐像素验收与导出**采用固定的软件光栅 profile，例如 Chromium 启动参数：

```js
args: ['--disable-accelerated-2d-canvas', '--disable-gpu']
```

部分 2D 操作首次出现会切换光栅路径，GPU 与软件舍入可让相同画面像素不同；固定 profile 后再判断是否为渲染状态漂移。WebGL、Three.js 等需要 GPU 的路线按框架支持配置并固定实际 profile，不把这组 2D 参数作为所有浏览器工程的要求。

QA CLI 默认每个抽样时间 `--warmup-frames 3`；API `runDeterminismQA` 默认 `warmupFrames:0` 保持兼容，需要预热时设为 2 或 3，0 禁用。预热差异在 `warmupMismatch/warmupStatus` 中保留并提示，正式四种顺序仍一致可通过；正式测量持续不一致仍失败。持有浏览器、连接或管道的适配模块导出 `async cleanup()`，CLI 在成功和失败结束时均调用；直接使用 API 时传 `teardown` 释放自己持有的资源。

| 产线 | 适用与取舍 |
|---|---|
| PNG/截图落盘 | 长片可恢复，占磁盘。starter `--frames-dir work/frames` 保存每帧；`--resume` 核对配置、JSON/音频内容与 PNG，继续缺失帧。改变输入或渲染代码时用新目录 |
| PNG 管道直出 | 减少文件读写，适合短片；中断需重来。starter 默认 `image2pipe`，有背压，不承诺固定吞吐速度 |

浏览器工程可沿用受支持截图入口落盘或将编码帧送 FFmpeg stdin，不要逐帧重载资源。恢复不能只看文件名存在；检查编码/尺寸和渲染配置。不要把截图工具绑定的固定耗时当性能保证。

**逐帧耗时量级（单次观测，非保证）。** 一次 Windows 11 / Python 3.13 / Pillow 逐帧绘制 / ffmpeg 9.0.2 的实录：

| 虚拟分辨率 | 逐帧耗时 | 整片规模 | 整片耗时 |
|---|---|---|---|
| 384×216 纯 Pillow | ≈30 ms | 1920×1080 / 30 fps / 6093 帧 | 185–204 s（含 x264 CRF17） |

30 ms × 6093 帧 ≈ 183 s，与实测 185–204 s 同量级，其余是编码与磁盘 IO。机器、Pillow/FFmpeg 版本、编码参数一变就不可比，按本机实测值重算，不引用这张表做承诺。

按耗时调优的顺序：**逐帧 > 150 ms 时，先把帧率降到 24 或虚拟分辨率降到 320×180**（帧数和单帧时延同时下降），仍不够再考虑分片/多进程渲染。浏览器逐帧截图通常比这条路线差一个数量级，按截图工具实测值重估，不要套用这张表。

## 可执行验收

先运行分镜校验与 QA，之后导出。以下在视频工程根目录运行，路径、关键时间按实际工程改；`work/check` 是中间目录。

```powershell
New-Item -ItemType Directory -Path 'work/check' -Force | Out-Null
ffprobe -v error -show_format -show_streams -of json 'outputs/final.mp4'

# 每5秒抽一帧，每张接触表20格；长片自动输出多张。
ffmpeg -i 'outputs/final.mp4' -vf 'fps=1/5,scale=384:-1,tile=5x4' -fps_mode vfr 'work/check/contact_%03d.png'

# 关键帧：每镜首/中/尾、动作峰值、转场开始/中点/结束前后。
ffmpeg -ss 5.55 -i 'outputs/final.mp4' -frames:v 1 'work/check/transition.png'
ffmpeg -i 'outputs/final.mp4' -vf 'select=eq(n\,0)' -frames:v 1 'work/check/first.png'
ffmpeg -i 'outputs/final.mp4' -update 1 'work/check/last.png'

# 完整音视频解码，不输出媒体文件。
ffmpeg -v error -i 'outputs/final.mp4' -f null -
```

很短的代表片段把接触表 fps 提高到 1；长片用 `fps=1/5,tile=5x4` 通看叙事，边界另外精查。准确关键帧可用 `select=eq(n\,帧号)`，避免只按秒估计。FFmpeg 新旧版本的输出帧同步选项可能不同，查看已有版本支持再用。

FFprobe 对照目标核对音视频流、时长、画幅、帧率、像素格式、采样率与声道；容器/编码器尾部小差异按帧率判断。完整解码查技术错误；接触表查叙事、首尾与转场关键帧查穿帮、字幕和摄像机边缘。

```sh
node path/to/skill/scripts/qa.mjs frame.mjs --duration 12 --fps 30 --storyboard storyboard.json --out work/qa.json
```

确定性报告覆盖所选时间的四种求值顺序。默认低分辨率帧检查世界层；高分辨率字幕/后处理另做重复导出或在适配模块中合成后比较。它不能替代播放和音画核对。

### 音画核对的正面方法

把音频分析的能量包络、候选拍点/段落、镜头切点、动作峰值和字幕起止整理到同一根**成片秒**时间轴，可先用表格逐项记录。对声明踩拍的动作计算 `offsetMs=(event.at-nearestBeat)*1000`，对按乐句安排的切镜记录所对应的段落变化；这样能复核设计与候选数据是否一致，不能把候选强拍附近的比例称为实际听感通过。

**估拍（estimated beats）是算法推测，不是音频真值。** 用它算出的 `offsetMs`、命中率和覆盖率只能自查编排是否自洽，不能据此宣称音画同步；`speculative` 标记的 BPM 连「整段有没有踩反」都只能当线索。同步结论只来自人工试听与抽帧核对。

具备播放条件时，逐个循环播放关键点前后的小段，再连续播放相关范围。记录歌曲版本、源偏移、目标动作与实际听到的重音/乐句变化，以及修正前后的成片秒；演唱字幕另核对句起止和真实逐词点，器乐叙事字幕核对阅读时长及它与画面行动的关系。完成相应范围的人工核对后记录 `reviewer/reviewedAt`，在交付记录中写清范围。

没有听觉通道时可交付上述结构比较、抽帧结果和具体 `pendingChecks`，保持 `draft`，把听感卡点列为未确认。检查去字幕叙事时先关闭字幕观看并记录能复述出的行动与结果；仅“字幕和画面相符”的抽帧结论不等于已做这项检查。

具备条件时完整播放，核对歌曲版本、源偏移、动作落点、逐字填充、异常静音/削波与留白；不能播放/试听时如实写检查范围，将待核对区间和内容记录为 `music.pendingChecks` 后交付 `draft`。交付记录包含实际目标、所查帧/落点、技术参数、许可/署名、状态及未解决项，不能用“FFprobe 正常”声称整片语义与音乐同步已通过。

### 核对当前版本、歌词、动作和提示音

记录录音与分镜版本、sourceOffset、歌词 ID、机器推定时点与置信度、人工实际听到的词头/拖音界线、画面动作峰值和预期触点、实际复查时段、待查原因。音乐每段至少核对开头、高潮、句尾和留白。需要检查转场的丝滑程度时记录输出 FPS 与实际重复帧或变化观察，测试关键动作及字幕在切点前后的连续性。

## 官方参考

- [HyperFrames](https://github.com/heygen-com/hyperframes)
- [Remotion Sequence](https://www.remotion.dev/docs/sequence)、[音轨裁剪](https://www.remotion.dev/docs/media/audio)、[固定随机数](https://www.remotion.dev/docs/random)、[授权](https://www.remotion.dev/docs/license)
- [Canvas 像素缩放](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingEnabled)
- [FFmpeg / FFprobe](https://ffmpeg.org/documentation.html)

## 渲染与导出排障

### 时间与长镜头

所有分镜时间使用成片秒，区间为 `[start,end)`。长镜头不自动切成 4–8 秒；先检查 8–12 秒内是否有可读变化，再决定是否拆镜。starter 的 `designT` 是内置画法的适配时钟，不能误当成真实成片秒。

### 常见故障

- 装置或 HUD 写进 JSON，却没有为 `scene.id` 注册画法：校验通过不等于画面出现；先做代表帧。
- 章节牌跨越镜头边界时只改字幕，背景状态没有同步：在章节起点和结尾各抽帧。
- 长镜头的 HUD 数值只在首帧设置：用时间直接求值，避免上一帧状态漂移。
- 画面元素贴近四边：在最终分辨率检查安全区，不以低分辨率世界层的“看得见”为准。
- 负向值和损坏状态没有结果动作：补上触发原因、失败反馈或留白。
- 把均匀抽帧报告当成 BPM 或实现框架证据：在交付记录中保留“未知/推断”标记。

导出后仍需 FFprobe、完整解码和首尾/转场/动作峰值抽帧。只要没有实际试听，就不要把候选拍点写成已验证同步。

### 出片链路

直出管道（`-f rawvideo` / `image2pipe` 写 FFmpeg 的 stdin）比落盘快，代价是失败时没有中间产物可复用。子进程提前退出时，往它已关闭的管道写会抛异常，异常类型在 Windows + Python 3.13 上实测如下：

| ffmpeg 失败原因 | 实测抛出的异常 |
|---|---|
| 编码器名写错（`-c:v nonexistent`） | `BrokenPipeError: [Errno 32]` |
| 输出目录不存在 | `BrokenPipeError: [Errno 32]` |
| 输入文件不存在 | `BrokenPipeError: [Errno 32]` |
| 参数非法 | `BrokenPipeError: [Errno 32]` |
| 滤镜名不存在 | `BrokenPipeError: [Errno 32]` |

**关键事实：`BrokenPipeError` 是 `OSError` 的子类**（`issubclass(BrokenPipeError, OSError) is True`）。所以 `except BrokenPipeError` 足以接住上面全部五种；写成 `except (BrokenPipeError, OSError)` 并不会多接住什么，它只是让意图更明显。

真正的坑不在异常类型，而在**只 catch 却不读 stderr**：这样拿到的是一个没有上下文的 `Broken pipe`，看不出 ffmpeg 到底为什么退出。所以必须用 `stderr=subprocess.PIPE`，在异常分支里把 ffmpeg 自己的报错读出来：

```python
assert audio.exists(), f"音轨不存在：{audio}"
assert out.parent.exists(), f"输出目录不存在：{out.parent}"
proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
try:
    for i in range(total):
        proc.stdin.write(render_frame(i).tobytes())
    proc.stdin.close()
except (BrokenPipeError, OSError):
    try: proc.stdin.close()
    except OSError: pass
    code = proc.wait()
    raise SystemExit(f"FFmpeg 提前退出（码 {code}）：{proc.stderr.read().decode('utf-8', 'replace')[-400:]}")
```

FFmpeg 命令相应地用 `-v error` 限制 stderr 体积，避免管道写满阻塞。加 `stderr=subprocess.DEVNULL` 或写完再 `stdin.close()` 只处理正常收尾，不覆盖「子进程早退」这一种。渲染前的两条 `assert` 价值最高：参数写错时在第一帧就报出来，不用等渲染完几千帧。

长片优先落盘：直出中断要整片重来，`--frames-dir` 配 `--resume` 只补缺失帧，产线取舍见 依赖与交付 的产线表。
