# 文档索引

这个目录放两类完全不同的文档，用途别混：

| 文档 | 类型 | 来源 | 回答什么问题 |
|---|---|---|---|
| [CASE-STUDY-2026-11.md](CASE-STUDY-2026-11.md) | **上游取证** | 抖音号 75897053217「墨菲音乐MV」40 条作品，135.5 分钟，2026-11-17 取证 | 同类优秀作品长什么样？本 skill 应该在视觉与结构上改成什么样？ |
| [superpowers/plans/2026-11-17-lyric-driven-code-mv-feedback.md](superpowers/plans/2026-11-17-lyric-driven-code-mv-feedback.md) | **下游草稿** | 一次真实使用（《神选》SASIOVERLXRD，203.1 秒 MV）踩到的 15 条坑 | 实际用起来哪里会崩、哪里会误导、按什么顺序修？ |

## 两者的关系

`CASE-STUDY` 是从**别人的成片**反推「应该做成什么样」，是**正向目标**。
`feedback plan` 是从**自己的失败**归纳「现在哪里不对」，是**负向清单**。

两者没有覆盖关系，也不互相替代：一份告诉你画面该往哪走，一份告诉你脚下的坑在哪。改代码时两份都要看——只按 plan 修，会把坑填平但仍不知道好画面长什么样；只按 case study 做，会追求视觉而重复踩已被记录过的坑。

## 另有一条实测证据不在上述两份里

做《special》（Richie Kotzen）90 秒 MV 时发现的**选拍算法缺陷**，已写入 plan 的「状态审计」一节：

`analyze-audio.mjs` 按 `0.55*vote + 0.25*autocorrelation + 0.2*alignment` 排序取第一个，从不检验「这个网格能否解释音乐里的实际起音」。同一首歌实测：工具选中 98.8 BPM（强 onset 误差中位 128.7 ms，<40 ms 仅 18.6%），而 144.1 BPM 误差中位 27.0 ms、<40 ms 达 60.5%。这是「成片大部分没卡上」的直接原因。

结论：**任何踩拍编排都必须先确认网格选对，再谈画面与音效。**

## 已归档的外部参考

同类开源项目 [yongjip/song2mv](https://github.com/yongjip/song2mv)（MIT）踩过同一个坑并写进了 README：librosa 的 `beat_track` 会按比例报错（90 BPM 的歌报 123），因此它**不使用 `beat_track` 的输出**，改为用打击乐 onset 拟合网格。这条与上面那个实测缺陷指向同一个修法。
