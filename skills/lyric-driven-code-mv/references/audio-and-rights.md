# 音频候选与素材授权

## 离线音频分析

在 skill 目录使用已有 Node 和 FFmpeg，不安装包或模型：

```sh
node scripts/analyze-audio.mjs "path with spaces/song.mp3" --start 37.2 --duration 12 --out work/analysis.json
# 已知 BPM：固定速度，只拟合当前片段相位
node scripts/analyze-audio.mjs "song.mp3" --bpm 110 --out work/analysis.json
# 曲目页/元数据标注：同时保存可复核的来源依据
node scripts/analyze-audio.mjs "song.mp3" --bpm 110 --bpm-source metadata --bpm-evidence "实际曲目页URL；页面标注110 BPM" --out work/analysis.json
```

默认解码为 8 kHz 单声道 float PCM，可用 `--sample-rate 16000`。FFmpeg 路径按 `--ffmpeg`、`FFMPEG_PATH` 环境变量、PATH 的顺序选择；显式路径无效会报错。单次最多 600 秒，超长输入拒绝，整曲较长时分段分析并保留各段偏移。16 kHz 解码 PCM 最多约 38.4 MB，拼接峰值两份约 76.8 MB，另有分析/JSON 内存。

报告 `status:"draft"`、`timebase:"clip"`；`sourceOffset` 保存 `--start`，所有输出时间已是片段秒。

| 输出 | 用途与限制 |
|---|---|
| `energy.envelope` 的 at/rms/normalized | 找强弱与留白；不能断言某个峰值就是某个词 |
| `pauses` 的 start/end/maxRms | 候选低能量区；伴奏可能让人声停顿不明显 |
| `onsets` 的 at/strength | 能量上升候选，可能来自鼓点或其他伴奏 |
| `tempo` 的 bpm/status/source/confidence/phaseSeconds/evidence | 选出的候选、来源依据与机器拟合状态；置信度为未校准启发式评分 |
| `tempo.candidates` / `tempo.clusters` | 原始投票前八名 / ±3% 邻近候选簇前八名；簇保留 `range`、`members`、拟合相位和周期证据 |
| `beats[]` | 从选出 BPM 和相位生成的片段网格，可用于 draft 分镜试排 |
| `warnings`、`limits` | 证据不足及资源上限 |

网格为 `phaseSeconds + n*60/bpm`，仅取 `[0,duration)` 内候选。`tempo.status` 为 `estimated`、`low-confidence` 或 `unavailable`；前两者可以提供网格，报告始终为 `draft`。低置信网格需把相位、自相关偏弱等限制写进 `music.evidence.limitations`，并保留待试听核对的落点，不能据此声称 `verified`。

自动模式将固定锚点 ±3% 内的投票候选归为一个簇，避免把 109/111 BPM 当成互斥答案；在簇范围内重新拟合相位，减少半 BPM 量化导致的长片段漂移。`range` 是簇成员范围，不是统计置信区间；簇的 `intervalVotes` 汇总相关投票，不代表同样数量的独立拍点。筛选同时要求起音覆盖、投票和周期证据，去均值自相关用于排除随机噪声的正值基线；相位集中度偏低不再单独否决已有周期证据的候选。

`--bpm` 接受大于 0 且不超过 400 的已知速度；自动搜索仍为 45–200 BPM。默认记录 `tempo.source:"user-provided"`；`--bpm-source metadata` 还必须提供 `--bpm-evidence`，保存实际曲目页或元数据记录。外部 BPM 固定后只拟合相位，来源可信与音频相位置信度是两件事。纯函数 `analyzePcm(samples, {bpm:110,bpmSource:"metadata",bpmEvidence:"实际依据"})` 使用相同选项。

静音、恒定音、极弱、过短或非周期噪声可返回 `bpm:null`，此时 `beats` 留空。即使提供 BPM，没有可用相位证据也不会填造零秒网格；所提供数值保存在 `requestedBpm` 和 `evidence` 中。复杂歌曲可能变速，单一 BPM 不能覆盖所有段落。

脚本不识别人声文本、不提供逐词对齐，也不证明试听完成。将选择的方法、误差来源与待核对重音写进分镜 `music.evidence`；实际人工核对后才改 `verified` 并记录人和时间。

仓库音频集成测试通过 `tests/media-tools.mjs` 探测本机工具：默认 PATH 缺 FFmpeg 时有原因地跳过实际解码测试，纯 PCM、参数及错误路径测试仍运行；显式无效的 `FFMPEG_PATH` / `FFPROBE_PATH` 会失败，避免配置错误被隐藏。

## 获取与记录

先确认用途（内部预览、公开发布、商用、改编），再搜索逐曲授权清楚的来源。保存曲目页、许可页、版本/作者及下载日期；下载本地资源后复核文件与版本。作品、录音和含采样/混音的材料可能有不同权利，不能仅凭可下载就认定可发布。

| 来源 | 如何获取和核实 |
|---|---|
| [ccMixter](https://ccmixter.org/) / [dig.ccMixter](https://dig.ccmixter.org/) | 从曲目页选文件，逐曲查看许可和署名；参考其 [署名说明](https://ccmixter.org/how-to-attribute-ccmixter-tracks) |
| [Free Music Archive](https://freemusicarchive.org/) | 曲目页核对作者、许可与下载；先读 [License guide](https://freemusicarchive.org/License_Guide/) |
| [Internet Archive](https://archive.org/) | 核对上传者、曲目页和来源证据；上传站点本身不证明权利。可按其 [Metadata API](https://blog.archive.org/2013/07/04/metadata-api/) 获取条目元数据与文件列表，再核对许可 |
| 原创或用户授权文件 | 记录作者、具体使用范围和授权依据；用户拥有文件不自动表示拥有全部发布权利 |

### 直链下载、格式转换与分镜记录

仅在曲目页明确提供可下载文件或许可授权直接下载时，使用页面给出的文件 URL；不要从播放器地址猜隐藏 CDN 链接。保留原始下载文件、曲目页、许可页及下载日期，核对版本和时长。若站点只提供网页下载按钮，使用该官方入口，并遵守站点条款。

```sh
# URL 必须来自实际曲目页，保存为原始下载件并复核文件名/内容
curl -fL --output work/source-track.flac "https://example.org/path/from-the-track-page.flac"
# 转成 starter 可稳定处理的 WAV；原件仍保留作为来源记录
ffmpeg -v error -i work/source-track.flac -vn -ar 48000 -ac 2 -c:a pcm_s16le work/track.wav
```

`example.org` 是占位域名，必须替换为已核对的实际 URL。Internet Archive 可先从 `https://archive.org/metadata/{identifier}` 读取 `files[].name`，再 URL 编码文件名并下载；不要猜文件名、忽略访问限制或绕过登录/付费墙。检查 `ffprobe -v error -show_format -show_streams work/track.wav`，确认时长与音频流。

在分镜 `project.audio` 中记录素材路径、时间基准、许可名称、作者署名、曲目来源页、许可原文链接和实际用途：

```json
{
  "path": "assets/track.wav",
  "timebase": "source",
  "provenance": "licensed-download",
  "license": "以实际曲目许可名称为准",
  "credit": "曲目标题 — 作者",
  "url": "https://实际曲目页面",
  "licenseUrl": "https://实际许可正文",
  "use": "internal-preview"
}
```

`credit` 写足实际许可要求的标题、作者及链接/修改说明；`license` 使用曲目页面列出的具体许可，不写泛化的“免版权”或“免费”。将内部预览改为公开/商业用途前，复核该用途是否获准，并更新 `use`。starter 会把这些声明写入 `.assets.json`，但不会自动验证许可有效性。

不要维护未经验证的固定音频直链或假设整站统一许可。Internet Archive 公开元数据入口为 `https://archive.org/metadata/{identifier}`，文件入口为 `https://archive.org/download/{identifier}/{filename}`；用实际元数据提供的文件名并做 URL 编码，不能猜测文件。其他站点优先使用当前官方页面的下载入口，不臆造 API。

截至 2026-11-17，[FreePD 原站](https://freepd.com/)显示已关闭，不能再当作稳定音源推荐。寻找其旧曲目的替代页面时仍要核对具体文件与许可。

## 许可阅读起点

下表仅帮助筛选，发布仍以实际许可、权利与用途为准；优先读 [Creative Commons 官方说明](https://creativecommons.org/share-your-work/) 及具体许可正文。

| 许可要素 | 制作 MV 时关注 |
|---|---|
| BY | 保留标题/作者、来源、许可链接及修改说明；不要暗示原作者背书 |
| NC | 限制商业用途，按实际使用场景核对；不能把“免费上传”直接视为非商业 |
| ND | 音乐与动态影像同步涉及改编；不能直接依赖 ND 发布 MV，需另获许可 |
| SA | 改编的分享条件需沿具体许可核对，保留适用许可 |
| CC0 / 公有领域 | 核对适用材料、来源与可能仍存在的其他权利；不写“任何用途都无条件” |

CC BY-ND 4.0 [许可正文](https://creativecommons.org/licenses/by-nd/4.0/legalcode.en)把音乐与动态影像同步列入 Adapted Material；不要把“歌没有剪辑”作为排除改编的理由。未知、冲突或未满足条件的许可写成待解决项，先交付有明确限制的预览，不作为公开成片发布。

```json
{
  "audio": {
    "path": "assets/track.wav",
    "timebase": "source",
    "license": "CC BY 4.0",
    "credit": "曲目标题 — 作者；本片截取并同步至画面",
    "url": "https://example.org/the-actual-track-page",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "use": "publish"
  }
}
```

上面的 example.org 是待替换示例，不能作为真实授权依据。原创素材可写 `provenance:"original"`，保留 `license,credit,use` 并说明作者和范围，不强制外部链接。普通校验缺项提示；`--delivery` 或 publish/public/commercial 用途缺必要记录会失败。静态校验只能验证记录完整性，不能认定授权有效。

## 绑定实际导出音轨

换歌时同步更新 `project.audio.path`、来源、许可、署名、用途与音乐证据。starter 的 `--audio` 仅重定位同一素材；不同路径要么与原声明文件内容相同，要么匹配可选的64位十六进制 `project.audio.sha256`。原路径丢失且没有哈希时不会沿用旧记录导出另一份文件。哈希应在核对曲目版本时记录，不能为绕过错误把未知文件哈希填入旧歌曲记录。

starter 每次MP4导出保存 `.mp4.assets.json`，包括原始音轨/裁剪WAV/输出文件的SHA-256、声明来源、音乐状态与裁切范围；帧目录另存 `asset-manifest.json`。外部非原创音轨已有 `credit` 时，在最后最多4秒生成短署名。它没有自动读取网页、核实授权或确定署名足够；完整标题、作者、来源、许可链接与修改说明仍按具体许可落实到成片或发布说明，并检查文字可读性。未知许可可以是带明确限制的内部草稿，不应自动称为公开发布验收通过。

片尾或发布说明可使用：`音乐：《标题》— 作者｜来源：曲目页｜许可：名称 + 链接｜修改：截取/淡入淡出/同步画面`。保存本地资源清单，署名位置与方式按具体许可核对；仓库不打包未经允许的歌曲或参考片。
