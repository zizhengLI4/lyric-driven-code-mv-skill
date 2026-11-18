#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""sync-audit.py —— 出片前一次性核对「时间对不对、字幕在哪」。

为什么要有这个：2026-11 那支 90 秒 MV 被判「大部分都没卡上」，事后查出来是三处
独立的错位同时存在——
  · 12 个切点按错误网格排布，最大偏 373ms；
  · 13 行歌词直接用 LRC 行首，相对真实人声起音最大偏 930ms（于是"唱出来了字幕没出来"）；
  · 37 个标记 sync:"beat" 的场景事件没人复核，最大偏 192ms（于是"一堆意义不明的画面"）。
再加一处：渲染器字幕底边距写 0.07（1080p = 76px），文档写 92px，成片实测距底只有 79px。
这些问题各自都能单独查，但散在四个脚本里，出片时没人全跑一遍。这个脚本把它们
合成一条命令，让每种错位在成片之前就报出来。

用法：
  # 只有分镜：查切点/事件/章节边界是否吸附到分镜网格
  python sync-audit.py storyboard.json

  # 有离线分析：先用它当权威网格，反过来检查分镜网格本身对不对
  python sync-audit.py storyboard.json --analysis audio.json

  # 有初版成片：实测字幕离画布底/右有多远（这是唯一能证明安全区的办法）
  python sync-audit.py storyboard.json --video draft.mp4

  # 全部一起，并写机器可读报告
  python sync-audit.py storyboard.json --analysis audio.json --video draft.mp4 --json report.json

为什么 --analysis 重要：只看「切点 vs 分镜网格」会得出 0ms 的完美结论——因为切点
就是从那个网格上吸附来的。网格本身错了，切点再齐也没用。旧分镜的 evidence 字段
写的是"98.8（144.1 为另一强候选，未采纳）"，正是这种自证循环。--analysis 传入
analyze-audio.mjs 的输出，才能打破循环。

检查项：
  1. 网格一致性：分镜 music.beats 的 BPM vs 离线分析的 BPM；
  2. 切点：每个场景 start 到最近拍点的偏离（默认容差 80ms）；
  3. 歌词：每行起点到最近强起音的偏离（需 --analysis）；无 --analysis 时退回拍点口径；
  4. 场景事件：sync:"beat" 的事件到最近拍点的偏离；
  5. 章节/段落：chapters 与 music.sections 的边界必须一致，且都落在切点上；
  6. 字幕安全区（需 --video）：实测字幕像素最下沿/最右沿到画布边的距离。

退出码：有 error 为 2，只有 warning 为 0，全通过为 0。

依赖：标准库 + ffmpeg（仅在 --video 时用）。
"""
import argparse
import json
import statistics
import subprocess
import sys
from pathlib import Path

TOLERANCE_MS = 80.0      # 卡点容差：一拍 144BPM ≈ 417ms，80ms 是"看得出对得上"的上限
EPS = 1e-9
SAFE_BOTTOM = 92         # 1080p：画布高 8.5%
SAFE_RIGHT = 124         # 1080p：画布宽 6.5%

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass


class Report:
    """收集发现项。error 会改变退出码，warning 只提示。"""

    def __init__(self):
        self.items = []

    def add(self, severity, kind, message, **extra):
        self.items.append({"severity": severity, "kind": kind, "message": message, **extra})

    def error(self, kind, message, **extra):
        self.add("error", kind, message, **extra)

    def warn(self, kind, message, **extra):
        self.add("warning", kind, message, **extra)

    def info(self, kind, message, **extra):
        self.add("info", kind, message, **extra)

    @property
    def errors(self):
        return [i for i in self.items if i["severity"] == "error"]

    @property
    def warnings(self):
        return [i for i in self.items if i["severity"] == "warning"]


LABEL = {
    "grid": "网格",
    "cut": "切点",
    "lyric": "歌词",
    "event": "事件",
    "chapter": "章节",
    "safe-area": "安全区",
    "malformed": "畸形",
    "hint": "提示",
}


def load_json(path):
    """读 JSON。Windows 上编辑器常写 BOM，用 utf-8-sig 免得误判成畸形。"""
    with open(path, encoding="utf-8-sig") as handle:
        return json.load(handle)


def build_grid(period, phase, duration):
    """按 period/phase 铺满 [0, duration) 的拍点。"""
    if not period or period <= 0:
        return []
    grid = []
    index = 0
    while True:
        t = phase + index * period
        if t >= duration - EPS:
            break
        grid.append(round(t, 6))
        index += 1
    return grid


def bpm_from_points(points, lo=60.0, hi=200.0):
    """中位间隔估 BPM，并做八度折回。只用于判断"分镜网格和分析结论是否一致"。"""
    if len(points) < 5:
        return None
    diffs = [b - a for a, b in zip(points, points[1:]) if b - a > 0.08]
    if len(diffs) < 4:
        return None
    bpm = 60.0 / statistics.median(diffs)
    while bpm < lo:
        bpm *= 2
    while bpm > hi:
        bpm /= 2
    return round(bpm, 1)


def nearest(points, target):
    """最近的参考点与带符号偏离（秒）。points 必须已排序。"""
    best = min(points, key=lambda t: abs(t - target))
    return best, target - best


def check_grid(report, storyboard, analysis):
    """分镜网格 vs 离线分析的网格。这是所有其它检查的前提。"""
    beats = sorted(float(b) for b in (storyboard.get("music") or {}).get("beats") or []
                   if isinstance(b, (int, float)))
    storyboard_bpm = bpm_from_points(beats)

    if not analysis:
        if not beats:
            report.error("grid", "分镜没有 music.beats，无法判断切点该对齐到哪里。"
                                 "先跑 analyze-audio.mjs 生成网格再排分镜。")
        else:
            report.info("grid", f"分镜自带 {len(beats)} 个拍点，中位间隔折合 {storyboard_bpm} BPM；"
                                f"未提供 --analysis，无法验证这个网格本身对不对。"
                                f"切点检查只在这套网格内部自洽，可能自证循环。")
        return beats, None

    tempo = analysis.get("tempo") or {}
    analysis_bpm = tempo.get("bpm")
    period = tempo.get("periodSeconds")
    phase = tempo.get("phaseSeconds")
    duration = storyboard.get("project", {}).get("duration")
    if period is None or phase is None or duration is None:
        report.error("malformed", "--analysis 的方向键 tempo.periodSeconds / tempo.phaseSeconds 缺失，"
                                  "无法重建权威网格。")
        return beats, None

    authoritative = build_grid(float(period), float(phase), float(duration))
    fit = tempo.get("onsetFit") or {}
    evidence = ""
    if fit:
        evidence = (f"（该网格强起音误差中位 {fit.get('medianMs', 0):.1f}ms、"
                    f"{fit.get('within40ms', 0) * 100:.1f}% 落在 40ms 内）")

    if not beats:
        report.warn("grid", f"分镜没有 music.beats；离线分析给出 {analysis_bpm} BPM / "
                            f"{len(authoritative)} 个拍点{evidence}，建议直接采用。")
        return authoritative, authoritative

    if storyboard_bpm and analysis_bpm:
        ratio = analysis_bpm / storyboard_bpm
        if abs(ratio - 1) <= 0.05:
            report.info("grid", f"分镜网格 {storyboard_bpm} BPM 与离线分析 {analysis_bpm} BPM 一致{evidence}。")
        else:
            octave = ""
            for label, factor in (("双速", 2.0), ("半速", 0.5)):
                if abs(ratio - factor) <= 0.05:
                    octave = f"（两者正好是{label}关系，这种歧义在这类估计里最常见）"
                    break
            report.error("grid", f"分镜网格是 {storyboard_bpm} BPM，离线分析给出 {analysis_bpm} BPM"
                                 f"{evidence}{octave}。分镜按错的网格排，切点吸得再准也没用——"
                                 f"先换网格再谈对齐。")
    return beats, authoritative


def check_points(report, label, entries, points, tolerance_ms, kind, severity="error"):
    """把一组时刻逐个比到参考点上。entries 是 [(名字, 时刻, 上下文)]。

    severity 可以是 "error" 或 "warning"。用在判据本身不可靠的场合——
    比如没有起音数据时拿拍点去核对歌词：真有人声拖音时拍点就是错的参考，
    这种偏离是音乐的正常现象，不该让出片流程失败。
    """
    if not points:
        report.warn(kind, f"{label}：没有可用的参考点，跳过。")
        return
    offsets = []
    bad = []
    for name, at, context in entries:
        point, offset = nearest(points, at)
        offsets.append(abs(offset) * 1000.0)
        if abs(offset) * 1000.0 > tolerance_ms:
            bad.append((name, at, point, offset * 1000.0, context))

    median = statistics.median(offsets)
    within = sum(1 for o in offsets if o <= tolerance_ms)
    total = len(offsets)
    summary = (f"{label}：{total} 项，偏离中位 {median:.0f}ms、最大 {max(offsets):.0f}ms，"
               f"落在此 {tolerance_ms:.0f}ms 容差内 {within}/{total}")
    emit = report.error if severity == "error" else report.warn
    if bad:
        emit(kind, summary, details=[
            {"name": n, "at": round(a, 3), "nearest": round(p, 3),
             "offsetMs": round(o, 1), "context": c} for n, a, p, o, c in bad[:20]
        ], total_bad=len(bad))
        for n, a, p, o, c in bad[:8]:
            emit(kind, f"  · {n} at {a:.3f}s 偏离最近参考点 {o:+.0f}ms"
                       + (f"（{c}）" if c else ""))
    else:
        report.info(kind, summary)


def check_cuts(report, storyboard, points, tolerance_ms):
    scenes = storyboard.get("scenes") or []
    entries = []
    for index, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            continue
        start = scene.get("start")
        if not isinstance(start, (int, float)):
            report.error("malformed", f"scenes[{index}].start 缺失或非数值。")
            continue
        # 第一镜必须从 0 开始；若网格首点不是 0，这个偏离是设计使然，不算错
        if index == 0 and abs(start) < EPS:
            continue
        entries.append((scene.get("id") or f"scenes[{index}]", float(start), scene.get("id") or ""))
    if entries:
        check_points(report, "切点", entries, points, tolerance_ms, "cut")


def check_events(report, storyboard, points, tolerance_ms):
    """只查显式声明 sync:"beat" 的事件。没声明的按语义走，不该被拍点绑架。"""
    entries = []
    declared = 0
    for scene in storyboard.get("scenes") or []:
        if not isinstance(scene, dict):
            continue
        for index, event in enumerate(scene.get("events") or []):
            if not isinstance(event, dict):
                continue
            if event.get("sync") != "beat":
                continue
            declared += 1
            at = event.get("at")
            if not isinstance(at, (int, float)):
                report.error("malformed", f"{scene.get('id')}.events[{index}].at 声明 sync:beat 但时刻非数值。")
                continue
            action = str(event.get("action") or "")[:26]
            entries.append((f"{scene.get('id')}.events[{index}]", float(at), action))
    if declared == 0:
        report.info("event", '没有标记 sync:"beat" 的场景事件，跳过事件卡点检查。')
        return
    check_points(report, "事件（sync:beat）", entries, points, tolerance_ms, "event")


def check_lyrics(report, storyboard, points, strong_onsets, tolerance_ms):
    """歌词按人声起音核对，不是按拍点。

    一字一拍的音乐里两者重合，但只要有切分音或拖音，拍点就会把人声甩开——
    旧分镜正是这样，实测相对人声起音最大偏 930ms。

    对偏出容差的行，额外列出 ±1.2s 内的所有强起音候选。原因：这类偏离有两种，
    一种是"锚错了点"（旁边就有个更近的强起音，改过去即可），另一种是
    "这段根本没有可锚的人声"（附近唯一候选在反方向近 1 秒外）。后者只能试听定夺——
    2026-11 那支片子有一行 LRC 是 23.37，附近强起音在 22.43 和 24.30，
    朝任一侧吸附都是猜，猜错就是"字幕比人声早一拍"。
    """
    lyrics = [l for l in (storyboard.get("lyrics") or []) if isinstance(l, dict)
              and isinstance(l.get("start"), (int, float))]
    if not lyrics:
        report.info("lyric", "分镜没有歌词，跳过。")
        return
    if not strong_onsets:
        report.warn("lyric", "没有 --analysis，歌词只能按拍点核对。一字一拍时够用，"
                             "有切分音或拖音时拍点会把人声甩开（实测过 930ms 的偏差）——"
                             "想知道字幕会不会早出或晚出，必须提供 analyze-audio.mjs 的输出。")
        entries = [(l.get("id") or f"lyrics[{i}]", float(l["start"]),
                    str(l.get("text") or "").replace("\n", " ")[:22])
                   for i, l in enumerate(lyrics)]
        # 判据本身不可靠，所以只提示不判错：拖音让歌词合理地离开拍点，
        # 那是音乐而不是缺陷，不该让出片流程失败。
        check_points(report, "歌词 vs 拍点（仅供参考）", entries, points, tolerance_ms, "lyric",
                     severity="warning")
        return

    entries = [(l.get("id") or f"lyrics[{i}]", float(l["start"]),
                str(l.get("text") or "").replace("\n", " ")[:22])
               for i, l in enumerate(lyrics)]
    check_points(report, "歌词 vs 强起音", entries, strong_onsets, tolerance_ms, "lyric")

    # 对偏出容差的行，把候选摆出来
    unresolved = []
    for name, at, context in entries:
        _, offset = nearest(strong_onsets, at)
        if abs(offset) * 1000.0 <= tolerance_ms:
            continue
        candidates = sorted(
            ((o, (o - at) * 1000.0) for o in strong_onsets if abs(o - at) <= 1.2),
            key=lambda pair: abs(pair[1]))
        unresolved.append((name, at, context, offset * 1000.0, candidates))
    if not unresolved:
        return
    report.warn("lyric", f"{len(unresolved)} 行歌词附近没有足够近的强起音（>{tolerance_ms:.0f}ms），"
                         f"自动吸附无法定夺，需要试听确认：")
    for name, at, context, offset, candidates in unresolved:
        if candidates:
            listing = "、".join(f"{t:.3f}s({d:+.0f}ms)" for t, d in candidates[:4])
            report.warn("lyric", f"  · {name} 现在 {at:.3f}s「{context}」：候选 {listing}")
            spaced = len(candidates) >= 2 and abs(candidates[1][1] - candidates[0][1]) > 1200
            if spaced:
                report.warn("lyric", f"    两侧候选相距过远、方向相反，朝任何一侧吸附都是猜——"
                                     f"这一行必须听着人声定，不要按最近距离自动改。")
        else:
            report.warn("lyric", f"  · {name} 现在 {at:.3f}s「{context}」：±1.2s 内没有强起音，"
                                 f"可能这句是弱起或拖音，按拍点保留更安全。")


def check_chapters(report, storyboard):
    """chapters 与 music.sections 必须同界，且边界要落在切点上。

    实测踩过：切点和 sections 都重排了，chapters 还停在旧的 23.4/49/62，
    结果章节牌出现在段落中间。
    """
    chapters = [c for c in (storyboard.get("chapters") or []) if isinstance(c, dict)]
    sections = [s for s in ((storyboard.get("music") or {}).get("sections") or []) if isinstance(s, dict)]
    cuts = sorted(float(s["start"]) for s in (storyboard.get("scenes") or [])
                  if isinstance(s, dict) and isinstance(s.get("start"), (int, float)))
    duration = storyboard.get("project", {}).get("duration")

    def edge_hits_cut(value):
        if not cuts:
            return True
        if isinstance(duration, (int, float)) and abs(value - duration) < 1e-6:
            return True
        if abs(value) < EPS:
            return True
        return any(abs(value - c) < 1e-6 for c in cuts)

    if chapters and sections:
        if len(chapters) != len(sections):
            report.error("chapter", f"chapters 有 {len(chapters)} 块、music.sections 有 {len(sections)} 段，"
                                    f"数量不等就无法一一对应，章节牌会落在段落中间。")
        for index, (chapter, section) in enumerate(zip(chapters, sections)):
            for edge in ("start", "end"):
                c_val, s_val = chapter.get(edge), section.get(edge)
                if not isinstance(c_val, (int, float)) or not isinstance(s_val, (int, float)):
                    continue
                if abs(float(c_val) - float(s_val)) > 1e-6:
                    report.error("chapter", f"chapters[{index}].{edge}={c_val} 与 "
                                            f"music.sections[{index}].{edge}={s_val} 不一致；"
                                            f"章节牌与段落边界对不上，牌子会盖在段落中间。")
                    break

    for index, item in enumerate(chapters):
        for edge in ("start", "end"):
            value = item.get(edge)
            if isinstance(value, (int, float)) and not edge_hits_cut(float(value)):
                report.warn("chapter", f"chapters[{index}].{edge}={value} 不在任何切点上；"
                                       f"章节牌会在镜头中间弹出，看着像误帧。")
    for index, item in enumerate(sections):
        for edge in ("start", "end"):
            value = item.get(edge)
            if isinstance(value, (int, float)) and not edge_hits_cut(float(value)):
                report.warn("chapter", f"music.sections[{index}].{edge}={value} 不在任何切点上；"
                                       f"按段落口径对齐时这一项会拉偏统计。")
    if chapters or sections:
        report.info("chapter", f"章节 {len(chapters)} 块、段落 {len(sections)} 段，边界与切点已核对。")


def measure_subtitles(video, samples=12):
    """实测字幕像素最下沿/最右沿到画布边的距离。

    这是唯一能证明"字幕没掉出安全区"的办法。读代码不算——渲染器里
    margin=round(height*0.07) 与文档写的 92px 各说各话，只有量成片才看得见。
    """
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-show_entries", "format=duration",
         "-of", "json", video],
        capture_output=True, text=True)
    if probe.returncode != 0:
        raise RuntimeError(probe.stderr.strip()[:300] or "ffprobe 失败")
    meta = json.loads(probe.stdout or "{}")
    streams = meta.get("streams") or []
    if not streams:
        raise RuntimeError("找不到视频流")
    width = int(streams[0]["width"])
    height = int(streams[0]["height"])
    duration = float(meta.get("format", {}).get("duration") or 0)
    if duration <= 0:
        raise RuntimeError("读不到成片时长")

    results = []
    for index in range(samples):
        # 均匀取点，避开首尾各 2%，那两段常有淡入淡出和片头字
        t = duration * (0.02 + 0.96 * (index + 0.5) / samples)
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", video,
             "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            capture_output=True)
        if raw.returncode != 0 or len(raw.stdout) < width * height * 3:
            continue
        buf = raw.stdout
        # 只在下半部找近白像素：字幕是近白，片头草稿框偏黄不会命中
        floor = height // 2
        max_y = -1
        max_x = -1
        for y in range(floor, height):
            row = y * width * 3
            for x in range(width):
                i = row + x * 3
                if buf[i] > 200 and buf[i + 1] > 200 and buf[i + 2] > 200:
                    if y > max_y:
                        max_y = y
                    if x > max_x:
                        max_x = x
        if max_y < 0:
            continue
        results.append({
            "at": round(t, 3),
            "bottomY": max_y,
            "fromBottom": height - 1 - max_y,
            "rightX": max_x,
            "fromRight": width - 1 - max_x,
        })
    return {"width": width, "height": height, "duration": duration, "samples": results}


def check_safe_area(report, video):
    try:
        measured = measure_subtitles(video)
    except (RuntimeError, OSError) as exc:
        report.error("safe-area", f"读成片失败：{exc}")
        return
    samples = measured["samples"]
    if not samples:
        report.warn("safe-area", "抽到的帧里没找到近白字幕像素，无法测安全区；"
                                 "换几帧或确认字幕确实渲染出来了。")
        return
    worst_bottom = min(s["fromBottom"] for s in samples)
    worst_right = min(s["fromRight"] for s in samples)
    # 按画布高换算阈值：1080p 是 92px，其它分辨率按同比例
    need_bottom = round(measured["height"] * 0.085)
    need_right = round(measured["width"] * 0.065)
    if worst_bottom < need_bottom:
        report.error("safe-area", f"字幕距画布底只有 {worst_bottom}px，低于 {need_bottom}px"
                                  f"（{measured['height']}p 的 8.5%）。会掉进平台底栏。",
                     measured=worst_bottom, required=need_bottom)
        report.error("safe-area", "  修法：把字幕 margin 改成 ceil(height * 0.085)，"
                                  "并确认它和 safe-area.py 的 subtitle 带一致。")
    else:
        report.info("safe-area", f"字幕距底 {worst_bottom}px ≥ {need_bottom}px。")
    if worst_right < need_right:
        report.error("safe-area", f"字幕距画布右只有 {worst_right}px，低于 {need_right}px"
                                  f"（{measured['width']}p 的 6.5%）。长行会被裁。")
    else:
        report.info("safe-area", f"字幕距右 {worst_right}px ≥ {need_right}px。")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="出片前核对卡点与字幕安全区：切点、歌词、事件、章节、字幕像素")
    parser.add_argument("storyboard", help="分镜 JSON")
    parser.add_argument("--analysis", help="analyze-audio.mjs 的输出 JSON（权威网格与起音）")
    parser.add_argument("--video", help="初版成片；给了就实测字幕安全区")
    parser.add_argument("--tolerance", type=float, default=TOLERANCE_MS,
                        help=f"卡点容差毫秒，默认 {TOLERANCE_MS:.0f}")
    parser.add_argument("--json", dest="json_path", help="另存机器可读报告")
    parser.add_argument("--quiet", action="store_true", help="只输出汇总行")
    args = parser.parse_args(argv)

    try:
        storyboard = load_json(args.storyboard)
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"读不了分镜 {args.storyboard}：{exc}")
    if not isinstance(storyboard, dict):
        raise SystemExit(f"分镜 {args.storyboard} 顶层不是对象。")

    analysis = None
    strong_onsets = []
    if args.analysis:
        try:
            analysis = load_json(args.analysis)
        except (OSError, json.JSONDecodeError) as exc:
            raise SystemExit(f"读不了分析报告 {args.analysis}：{exc}")
        onsets = analysis.get("onsets") or []
        usable = [o for o in onsets if isinstance(o, dict) and isinstance(o.get("at"), (int, float))
                  and isinstance(o.get("strength"), (int, float))]
        if usable:
            # 只用前 40% 强度的起音：弱起音多半是伴奏碎响，不代表人声进来
            usable.sort(key=lambda o: o["strength"], reverse=True)
            cut = usable[max(0, int(len(usable) * 0.4) - 1)]["strength"]
            strong_onsets = sorted(float(o["at"]) for o in usable if o["strength"] >= cut)

    report = Report()
    beats, authoritative = check_grid(report, storyboard, analysis)
    points = authoritative if authoritative else beats
    tolerance = args.tolerance

    check_cuts(report, storyboard, points, tolerance)
    check_events(report, storyboard, points, tolerance)
    check_lyrics(report, storyboard, points, strong_onsets, tolerance)
    check_chapters(report, storyboard)
    if args.video:
        check_safe_area(report, args.video)

    if not args.quiet:
        for item in report.items:
            tag = f"[{LABEL.get(item['kind'], item['kind'])}]"
            mark = {"error": "✗", "warning": "⚠", "info": "·"}[item["severity"]]
            print(f"{mark} {tag} {item['message']}")

    errors = len(report.errors)
    warnings = len(report.warnings)
    print(f"\n网格 {len(points)} 点"
          + (f"（来自离线分析）" if authoritative else "（来自分镜）")
          + f"；error {errors}，warning {warnings}")
    if errors == 0 and warnings == 0:
        print("时间轴与安全区检查通过。")
    elif errors == 0:
        print("没有硬错误，但有提示项要人工确认。")
    else:
        print("有硬错误：先修掉再出片，否则成片会重复这些问题。")

    if args.json_path:
        payload = {
            "storyboard": args.storyboard,
            "analysis": args.analysis,
            "video": args.video,
            "toleranceMs": args.tolerance,
            "gridSource": "analysis" if authoritative else "storyboard",
            "gridPoints": len(points),
            "items": report.items,
            "summary": {"errors": errors, "warnings": warnings},
            "ok": errors == 0,
        }
        Path(args.json_path).parent.mkdir(parents=True, exist_ok=True)
        with open(args.json_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        print(f"json -> {args.json_path}")

    return 2 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
