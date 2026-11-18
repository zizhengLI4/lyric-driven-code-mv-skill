# Lyric-Driven Code MV Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the 15 findings in `C:/Users/Administrator/WorkBuddy/2026-11-17-22-43-13/lyric-driven-code-mv-改进意见.md` to make the skill's dependencies, storyboard schema, geometry checks, timeline analysis, and rendering guidance consistent and actionable.

**Architecture:** Keep storyboard version 1 backward-compatible while adding structured HUD and lyric provenance guidance. Add a standalone Pillow-based rectangle checker, and extend the existing timeline-sync and HUD-density reports instead of introducing parallel analysis tools. Update reference documents and the example storyboard to match the implemented contracts.

**Tech Stack:** Node.js built-ins and `node:test`; Python 3 and Pillow for image/layout utilities; FFmpeg for the existing media tools. Declare Pillow in `requirements.txt`; do not install dependencies as part of this change.

**Spec:** `C:/Users/Administrator/WorkBuddy/2026-11-17-22-43-13/lyric-driven-code-mv-改进意见.md`

## Global Constraints

- Preserve `schemaVersion: 1` and accept existing string-valued `events[].hud` and singleton `device` values.
- Keep analysis advisory: warnings must not claim semantic correctness, actual synchronization, or valid rights.
- Use final-output-pixel coordinates for layout rectangles and derive canvas dimensions from the storyboard unless explicitly overridden.
- Only `safe-area.py` defines platform margin geometry; include the full subtitle band, including stroke/background, in layout checks.
- Dependency declaration is documentation/configuration only; do not install Pillow, packages, fonts, or services.
- Treat performance timings as machine-specific observations, not guarantees.

## 状态审计（2026-11-18 复核）

> 本节记录计划提出后逐项核实到的**真实状态**，不是自我评价。核对方法：在仓库里按关键词与文件存在性逐条查证，并用 `node --test` 对照。

**审计结果：17 个检查点中，2 个曾被我方检查脚本误判为「已通过」，实际都是关键词偶然命中；其余 15 个在代码里零命中。**

| 检查点 | 审计时状态 | 说明 |
|---|---|---|
| `requirements.txt` | 缺失 | 文件不存在 |
| render-pitfalls 补 `OSError` | 缺失 | 全仓库零命中。注意：该文件原本**连「出片链路」一节都不存在**，也没有任何 `BrokenPipeError` 字样（本节初稿曾误写为「第五节仍只有 BrokenPipeError」，已更正）|
| 安全区统一 92px | 缺失 | `hud-and-subtitles.md` 全文 21 行，关于安全区**一个字都没有** |
| 校验器支持 hud 对象 | **伪通过** | 第 432–436 行只做到 `isObject → validHud = true`，不校验 `delta`/`broken`/`value` 任何语义 |
| 校验器查 22 字上限 | 缺失 | 零命中 |
| 校验器支持 `lyricsMeta` | 缺失 | 零命中 |
| 校验器支持 `devices[]`/`deviceId` | 缺失 | 零命中 |
| 示例改 24 秒 1 镜 | 缺失 | 仍是 2×6 秒 |
| `layout-check.py` | 缺失 | 文件不存在 |
| `tests/layout-check.test.mjs` | 缺失 | 文件不存在 |
| `timeline-sync.py --align` | 缺失 | 零命中 |
| hud-density 规则覆盖表 | 缺失 | 零命中 |
| hud-density 空窗事件清单 | 缺失 | 零命中 |
| `tests/timeline-sync.test.mjs` | 缺失 | 文件不存在 |
| SKILL.md 改 minimal-renderer 描述 | **伪通过** | 第 84 行原文仍是「不用 starter 工程也能出画面的最小实现」，缺「占位与版式校验用」「不含场景绘制」 |
| dependencies 渲染量级表 | 缺失 | 零命中 |
| 系统字体路线 | 缺失 | 零命中 |

### 审计中发现的两个结构性问题（原 spec 未覆盖）

1. **安全区在脚本内部就自相矛盾**：`safe-area.py` 第 47 行 `h - int(h * 0.085)` 在 1080p 下是 92px，第 106 行的标注文字却写「底部 90px」。文档里连这句都没有——下一个使用者必然复现 spec#3 那次返工。
2. **选 BPM 的算法不问「网格能否解释音乐」**：`analyze-audio.mjs` 第 154–157 行按 `0.55*vote + 0.25*autocorrelation + 0.2*alignment` 排序后 `find` 第一个。实测同一首歌，工具选中 98.8 BPM（强 onset 误差中位 128.7ms、<40ms 仅 18.6%），而 144.1 BPM 误差中位 27.0ms、<40ms 达 60.5%。这是「成片大部分没卡上」的直接原因，也是本计划所有踩拍编排的前置依赖。

   **已修复并实测验收**（2026-11-18）：`analyze-audio.mjs` 新增 `onsetGridFit` / `onsetFitScore` / `hasStrongFit`，用强起音（strength 前 40%）做网格拟合验证后选优。同一份音频改后输出：

   | 指标 | 改前 | 改后 |
   |---|---|---|
   | 选中 BPM | 98.8 | **144.1** |
   | phaseSeconds | 0.590428 | **0.373255** |
   | 该网格 onset 误差中位 | 128.69 ms | **27.03 ms** |
   | <40 ms 占比 | 18.6% | **60.5%** |

   输出新增 `onsetFit: {medianMs, p90Ms, within40ms, within80ms, samples}`、`fitScore`、`rivalGrids`（半速/双速对手）。144.1 与独立手工实测的 phaseSeconds、中位误差、占比三项完全吻合。

### 执行顺序（按依赖关系，不按 spec 编号）

`requirements.txt` + 文档三条（可并行，零风险）→ 校验器结构化（#4，是 #5/#10 的数据基础）→ `layout-check.py`（#5）→ `analyze-audio` onset 拟合 + `timeline-sync --align`（#12，必须先修网格，否则对齐数字无意义）→ `hud-density` 证据（#10/#13）→ 渲染核心合并（本计划外，见下）

### 计划外的架构修复

`assets/scenes/core.mjs`（646 行）与 `assets/templates/starter/frame.mjs`（281 行）各自实现了一整套 `FB`/`blendFrames`/`resolveTimeline`，且能力不对等：`fb.layer()`/`fb.glow()` 只存在于 starter（SKILL.md 第 31–46 行却把它写成了强制画法规范），12 个可复用场景只存在于 core。合并为单一 `assets/frame-core.mjs` 是 SKILL.md 那条规范能成立的前提。

---

## Review Focus

- Existing schema-v1 storyboards with string HUD or one `device` still validate; tests cover compatibility in `tests/storyboard.test.mjs`.
- Malformed optional `lyricsMeta`, HUD numeric values, or chapter device references produce located diagnostics rather than crashes; tests cover these in `tests/storyboard.test.mjs`.
- Rectangles touching edges, exactly overlapping, or assigned to full-UI scenes behave consistently; CLI tests cover geometry boundaries in `tests/layout-check.test.mjs`.
- Alignment sources may be absent or sparse; sync output reports null/unavailable metrics without fabricating a match in `tests/timeline-sync.test.mjs`.
- Device rules and long-scene event evidence are literal, inspectable diagnostics rather than claims of semantic understanding; tests cover them in `tests/hud-density.test.mjs`.

---

### Task 1: Fix dependency, pipeline, and safe-area guidance

**Files:**
- Create: `requirements.txt`
- Modify: `skills/lyric-driven-code-mv/SKILL.md`
- Modify: `skills/lyric-driven-code-mv/references/render-pitfalls.md`
- Modify: `skills/lyric-driven-code-mv/references/hud-and-subtitles.md`
- Modify: `skills/lyric-driven-code-mv/references/dependencies-and-delivery.md`

**Interfaces:**
- `requirements.txt` declares `Pillow>=10.0` for the five Python scripts that import Pillow.
- `SKILL.md` preflight checks Pillow before Pillow-dependent commands and states that `validate-storyboard.mjs` and `hud-density.mjs` need only Node built-ins.

- [x] Add the Pillow requirement and concise install/check instructions without running pip.
- [x] Document Windows pipe writes failing as `OSError` as well as `BrokenPipeError`; recommend checking audio input and output parent before frame rendering.
- [x] Replace the conflicting subtitle margin with `bottom >= 92 px at 1080p`, refer to `safe-area.py` as the source of truth, and count the full band/stroke.
- [x] Add a focused test or validation of documented CLI behavior only where a runnable command boundary exists; prose itself needs no source-text test.
- [x] Run existing Python and Node tests that cover touched utilities.

### Task 2: Extend storyboard metadata and validation compatibly

**Files:**
- Modify: `skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs`
- Modify: `skills/lyric-driven-code-mv/assets/storyboard-example.json`
- Modify: `skills/lyric-driven-code-mv/references/storyboard-and-timing.md`
- Modify: `skills/lyric-driven-code-mv/references/hud-and-subtitles.md`
- Modify: `skills/lyric-driven-code-mv/references/story-devices.md`
- Modify: `skills/lyric-driven-code-mv/references/device-templates.md`
- Test: `tests/storyboard.test.mjs`

**Interfaces:**
- Structured event HUD: `{label, unit?, value, delta?, broken?}`; retain legacy strings and emit a migration warning for string-only HUD use.
- Top-level `devices[]` entries use the existing device fields plus stable `id`; legacy `device` remains accepted. `chapters[].deviceId` refers to an entry in the effective device collection.
- Optional `lyricsMeta` records lyric source, reference, fetch time, and proofreading status. `proofread: false` emits an advisory warning.
- Remove whitespace before counting subtitle text; warn above 22 characters and suggest semantic splitting.

- [x] Add failing tests for structured negative HUD (`delta < 0` or `broken: true`), legacy HUD compatibility, bad optional metadata, subtitle length warnings, device references, and repeated device references across a chapter transition.
- [x] Confirm each test fails for the intended diagnostic before changing the validator.
- [x] Implement validation and warnings while preserving ordinary schema-v1 inputs.
- [x] Change the example to a 24-second single scene with three readable changes (one HUD update and two subtitle changes); keep all required story fields and timing valid.
- [x] Document a structured HUD example and lyrics provenance; describe long-shot readability through changes rather than duration alone.
- [x] Run `node --test tests/storyboard.test.mjs tests/storyboard-export.test.mjs`.

### Task 3: Add a rectangle-based layout checker

**Files:**
- Create: `skills/lyric-driven-code-mv/scripts/layout-check.py`
- Modify: `skills/lyric-driven-code-mv/SKILL.md`
- Modify: `skills/lyric-driven-code-mv/references/hud-and-subtitles.md`
- Test: `tests/layout-check.test.mjs`

**Interfaces:**
- CLI accepts the storyboard plus repeated `--hud "name:x,y,x1,y1"`, `--log "x,y,x1,y1"`, one `--subtitle-band "x,y,x1,y1"`, `--safe "right=N,bottom=N"`, and `--scenes "scene-id:full-ui"` options.
  > **语义修正**：矩形四数是**左上角 + 右下角的绝对像素**，不是宽高。spec 自带的示例 `--log "56,700,640,880"` 按宽高解析会把 y 推到 1580、越过 1080 画布；按 x1,y1 才是合理的 584×180 日志框。实现内部一律换算成 `w=x1-x`、`h=y1-y`。
- Coordinates are output pixels; width/height default from `project.width` and `project.height`.
- Report HUD-to-HUD overlap, HUD-to-subtitle overlap, and regions extending past safe boundaries. A declared full-UI scene may suppress its HUD, but does not exempt the subtitle band from safety checks.

- [x] Add CLI tests for non-overlap, each overlap class, safe-edge inclusion, safe-edge overflow, malformed rectangles, and full-UI subtitle handling.
- [x] Verify the tests fail before implementation.
- [x] Implement all diagnostics in one run, with stable text/JSON output and a nonzero exit status when geometry errors exist.
- [x] Add the suggested sample command to `SKILL.md`.
- [x] Run the layout CLI tests and check Python syntax.

### Task 4: Make timeline alignment and density reports expose their evidence

**Files:**
- Modify: `skills/lyric-driven-code-mv/scripts/timeline-sync.py`
- Modify: `skills/lyric-driven-code-mv/scripts/hud-density.mjs`
- Modify: `skills/lyric-driven-code-mv/SKILL.md`
- Modify: `skills/lyric-driven-code-mv/references/dependencies-and-delivery.md`
- Modify: `skills/lyric-driven-code-mv/references/storyboard-and-timing.md`
- Test: `tests/timeline-sync.test.mjs`
- Test: `tests/hud-density.test.mjs`

**Interfaces:**
- `timeline-sync.py --align` accepts comma-separated `beats`, `lyrics`, and `sections`; when omitted, choose sections if the storyboard contains them, otherwise beats.
- Each selected alignment report includes the reference point, per-cut signed offset, absolute median/maximum, and within-80ms count. Missing references remain explicitly unavailable.
- `hud-density.mjs` includes the actions falling inside the longest per-scene gap and a device-rule coverage section based on literal, case-insensitive event-action matches; zero matches are labeled unrepresented.
- Chapter cards with a title count as readable changes at chapter start.

- [x] Add tests for explicit single/multiple alignment modes, default section preference, missing sources, empty action/rule cases, chapter-card marks, and gap event evidence.
- [x] Verify the tests fail before implementation.
- [x] Implement and expose the new report fields in both text and JSON paths.
- [x] Repeat in the documentation that estimated beats remain speculative and are not proof of sync.
- [x] Run sync and density tests, including CLI subprocess coverage.

### Task 5: Clarify renderer scope, font options, and performance expectations

**Files:**
- Modify: `skills/lyric-driven-code-mv/SKILL.md`
- Modify: `skills/lyric-driven-code-mv/references/pixel-game-visuals.md`
- Modify: `skills/lyric-driven-code-mv/references/dependencies-and-delivery.md`

**Interfaces:**
- Describe `minimal-renderer.py` as a layout/placeholder renderer without scene drawing, not as a production scene renderer.
- Document a system-font fallback using Pillow `ImageFont.truetype(path, 40)`, nearest-neighbor/block styling, and drawing text on the final-resolution layer after scaling.
- Add a clearly labeled, environment-specific performance example from the supplied report and the heuristic to lower virtual resolution/frame rate when per-frame work exceeds 150 ms.

- [x] Update the renderer capability table and matching prose.
- [x] Add system-font and pixel-style guidance without adding a font asset or a dependency beyond Pillow.
- [x] Add a performance scale table labeled as one observed Windows/Python/FFmpeg run and retain the non-guarantee caveat.
- [x] Cross-check every finding in the source feedback against one task above.
- [x] Run `node --test tests/*.mjs`, relevant Python script tests, `git diff --check`, and inspect the complete diff.

---

## 执行结果（2026-11-18）

25 项验收要求全部通过，`node --test` **343 项 / 343 通过 / 0 失败**。

### 关键验收：BPM 选格修复

这是「大部分都没卡上」的直接原因，改前改后用同一份音频实测：

| 指标 | 改前 | 改后 | 独立手工实测 |
|---|---|---|---|
| 选中 BPM | 98.8 | **144.1** | 144.1 |
| phaseSeconds | 0.590428 | **0.373255** | 0.373255 |
| 该网格 onset 误差中位 | 128.69 ms | **27.03 ms** | 27.0 ms |
| 落在 40 ms 内 | 18.6% | **60.5%** | 60.5% |

`analyze-audio.mjs` 新增 `onsetFit {medianMs, p90Ms, within40ms, within80ms, samples}`、`fitScore`、`rivalGrids`（半速/双速对手）。

### 三个执行中发现的真实缺陷（计划里没有）

1. **示例分镜的 12 秒假设污染了三个测试**。示例从 12 秒改成 24 秒后，`sfx.test.mjs` 里用 `at: 12` 测「越界」的断言静默失效（12 秒已合法）。三处依赖 `scenes[1]` 的测试改为从第一镜派生自己的 fixture，示例本身改成**严格单镜 24 秒**（`duration 24`、`chapters 0-12/12-24`、`beats` 48 个、`sections` 2 段），校验器 `errors=0 warnings=0`。

2. **`timeline-sync.py` 与 `analyze-audio.mjs` 对同一首歌给出不同 BPM**（125 vs 98.8 vs 正确的 144.1），而且没有任何交叉核对。现在脚本会把「自己估的」和「分镜网格里的」并排输出，分歧时明确说明两者都不是权威、以 `analyze-audio.mjs` 的起音拟合为准。实测真实 MV 分镜立即暴露：脚本 125 / 分镜网格 98.8 / 正确答案 144.1 —— 那份分镜跑在错网格上。

3. **`sync.test.mjs` 测的是 `visualize-sync.mjs`，`timeline-sync.py` 完全没有测试覆盖**。补了 `tests/timeline-sync.test.mjs` 12 条（`--align` 单口径/多口径/默认 sections 优先/未知口径报错/空值报错/参考点缺失不伪造/BPM 对照三态）。

### Task 4 的一处流程偏离（如实记录）

`--align` 的实现先于测试落地（由并行 agent 完成），所以「Verify the tests fail before implementation」这一步没能真正走一遍。补写的测试是对现成实现的**事后验收**，不是红→绿驱动。其余各项均为先红后绿。

### 同批完成的架构修复

| 项 | 改前 | 改后 |
|---|---|---|
| 渲染核心 | 两套且能力不等（`glow`/`layer` 只在 starter，12 场景只在 core） | 唯一 `assets/frame-core.mjs`（200 行 / 19 导出），两侧都 import |
| 12 个场景文件 | 2 行空壳，套 `DRAW[index]` | 28–62 行真实现，`core.mjs` 646 → 72 行 |
| `subject` 越界 | 抛 `摄像机超出模板范围`，`(100,100)`/`(120,146)`/`(264,146)` 全崩 | 夹取到可用范围并给出可读警告，`(0,0)`/`(-50,-50)`/`(9999,9999)` 都不崩 |
| 模块级 `let P` 调色板 | `renderSceneAsset` 里改全局、try/finally 还原 | 已消除 |
| 布局冲突检查 | 无 | `scripts/layout-check.py`（545 行纯标准库）+ 25 条测试 |
| 长空窗判据 | 只数事件，把整段压在字幕上的窗口误判成空窗 | 主动提示「字幕只在句头算一次变化点，不代表这段没有可读内容」 |
