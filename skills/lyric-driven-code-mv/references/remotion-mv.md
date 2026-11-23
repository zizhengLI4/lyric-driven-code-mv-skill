# Remotion 歌词 MV

## 工程与旧调用方

复制 assets/templates/starter 到歌曲工程。在副本里安装精确版本。已有 React 工程先核对 React / React DOM 的配对版本。新建的启动模板使用已验证的组合：

    npm install --save-exact remotion@4.0.546 @remotion/cli@4.0.546 react@19.2.0 react-dom@19.2.0

保留 npm 生成的 lockfile。依赖只装在选用此驱动的工程。浏览器可通过 REMOTION_BROWSER_EXECUTABLE 指向已有 Chrome 或 Edge；未指定时 Remotion 可能下载浏览器。无需云端渲染或 API Key。

继续调用 Node 的 export.mjs。优先级为显式 --renderer、调用进程的 LYRIC_MV_RENDERER 环境变量、默认 starter。不能拼接命令行的旧调用方可以只为本次子进程设 LYRIC_MV_RENDERER=remotion。--frames-dir、--frames-only 和 --resume 走原有 starter。旧项目副本需要先合并新版 export.mjs 的渲染分支，并把 remotion.jsx 与 remotion-runner.mjs 放在它旁边。保留项目自定义 frame.mjs、timeline.mjs 和绘制文件。依赖安装在能从该 runner 解析到的位置。

分析、LRC、校验、音效合成和 QA 使用原来的 scripts。CLI 用法示例（复制 starter 到外部后将 SKILL 换成技能目录绝对路径）：

    node SKILL/scripts/analyze-audio.mjs song.wav --out analysis.json
    node export.mjs --renderer remotion --storyboard storyboard.json --frame-time 3 --frame-out scene.png --frame-final
    node export.mjs --renderer remotion --storyboard storyboard.json --review visual-review.json --sfx-script SKILL/scripts/sfx.mjs --preview
    node export.mjs --renderer remotion --storyboard storyboard.json --review visual-review.json --sfx-script SKILL/scripts/sfx.mjs --out song-mv.mp4

## 按参考图制作 Remotion MV

### 01 定规格

根据本曲歌词确定主题、人物与动作分镜。默认 Remotion、1920×1080、30 fps、16:9 横屏。用用户文件夹里的歌曲作主音轨，保留演唱，以中文字幕呈现歌词，无旁白。核实录音版本和歌词时点，再按本技能原有流程准备人物及场景静帧。

### 02 卡点

分析同一录音，列出 BPM 与每个可辨认重拍所在的片段秒、源音轨秒、目标帧及判定依据。目标帧取 round(片段秒 × fps)，上限为最后一帧。结合局部速度、低频起音和听辨校正；弱起、变速或停顿处单独标记。将每次计划中的切镜、构图切换和关键动作的完成瞬间绑定到选定重拍。动作可以在拍前起势，在拍上接触或定格，拍后回弹。字幕仍跟演唱。按用户认可的击键范例复核动作触点。

### 03 配音效

为每个关键动作指定一个代码合成音，按画面重点和歌曲调性选择音色或乐器。记录动作、音色、起音 at 与冲击点 hitAt；提前蓄势的声音让 hitAt 对齐目标帧。沿用原有混音和电平检查，试听最终音轨，确认动作音可辨、原唱清楚。

## 预览与交付

1. Remotion 组件使用 useCurrentFrame 驱动现有 renderFrame。项目专属画法仍写入原来的 frame.mjs 和场景模块。审片用本驱动的 --frame-final；visual-review.json 的 sources 除项目原有绘制源和素材，还要包含 remotion.jsx、remotion-runner.mjs。确认后再启动动态预览与导出。
2. Studio 预览混合音轨与简化的中文字幕。最终字幕走原有 ASS 排版，逐词着色、安全区及双语效果以正式静帧与成片为准。使用上述导出入口完成混音、字幕及审片记录检查。交付前用 ffprobe 核流、时长和帧率，抽查动作前后帧及最终音轨里的音效窗口。

画面落点、起势和回弹沿用[动作卡点与成片复核](sfx-and-beat.md#动作卡点与成片复核)。
