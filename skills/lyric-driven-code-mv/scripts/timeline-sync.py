#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""timeline-sync.py —— 把音频、镜头、字幕画到同一条时间轴上。

用法：
  python timeline-sync.py song.wav -o work/timeline.png
  python timeline-sync.py song.wav --analysis work/analysis.json -o work/timeline.png
  python timeline-sync.py final.mp4 --storyboard storyboard.json -o work/timeline.png --json work/timeline.json
  python timeline-sync.py final.mp4 --storyboard storyboard.json --align lyrics,sections

输出两样东西：
  1. 一张 PNG：能量包络 + 估出来的拍点 + 分镜的切点 + 字幕起止
  2. 一份 JSON：duration / bpm / beats / cuts / lyrics / 空隙统计 / 各口径对齐统计

默认调用 `analyze-audio.mjs` 生成局部速度和候选拍点；已保存报告时可通过 `--analysis` 复用。报告中的机器候选始终是 draft，真正的音画判断仍需播放核对。

--align 决定「切镜该跟谁对齐」：
  beats     跟着音频分析候选或分镜已有拍点
  lyrics    跟着歌词句头（storyboard.lyrics[].start）
  sections  跟着音乐段落起点（storyboard.music.sections[].start）
可以多选，例如 --align beats,lyrics；省略时：分镜有 music.sections 就用 sections，否则用 beats。
按歌词句头或段落切镜的片子本来就不该跟拍点对齐，用错口径只会让人误以为剪错了。

依赖：Node、ffmpeg、Pillow。未提供 `--analysis` 时会调用同目录的 `analyze-audio.mjs`；PNG 需要 Pillow。
"""
import argparse
import json
import os
import statistics
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont
from path_safety import assert_no_path_aliases

ALIGN_MODES = ("beats", "lyrics", "sections")
ALIGN_HELP = "切镜对齐口径：beats（分析候选或分镜网格）/ lyrics（歌词句头）/ sections（音乐段落起点），逗号分隔可多选"

# Windows 控制台默认可能是 GBK；报告里有中文，显式转成 UTF-8 免得写崩或出现乱码。
for _stream in (sys.stdout, sys.stderr):
    _reconfigure = getattr(_stream, "reconfigure", None)
    if _reconfigure is not None:
        try:
            _reconfigure(encoding="utf-8")
        except (ValueError, OSError):
            pass

FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
]
BG = (18, 22, 34)
GRID = (44, 52, 72)
WAVE = (108, 196, 236)
WAVE_DIM = (52, 84, 108)
BEAT = (120, 200, 150)
CUT = (255, 168, 96)
LYRIC = (198, 160, 255)
TEXT = (226, 234, 246)


def font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    raise SystemExit("找不到中文字体，请在 FONT_CANDIDATES 里加一条本机字体路径。")


def load_audio_analysis(source, analysis_path=None, sample_rate=8000):
    """Read a shared analyzer report or run the Node analyzer once for this source."""
    if analysis_path:
        try:
            with open(analysis_path, encoding="utf-8") as handle:
                report = json.load(handle)
        except (OSError, json.JSONDecodeError) as exc:
            raise SystemExit(f"无法读取分析报告：{exc}")
    else:
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "analyze-audio.mjs")
        result = subprocess.run(
            ["node", script, source, "--sample-rate", str(sample_rate)],
            capture_output=True, text=True, encoding="utf-8",
        )
        if result.returncode != 0:
            raise SystemExit(result.stderr.strip() or "analyze-audio.mjs 分析失败")
        try:
            report = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"analyze-audio.mjs 未返回有效 JSON：{exc}")

    if not isinstance(report, dict) or report.get("schemaVersion") != 1 or report.get("status") != "draft" or report.get("timebase") != "clip":
        raise SystemExit("分析报告须为 schemaVersion=1、status=draft、timebase=clip")
    duration = report.get("duration")
    beats = report.get("beats")
    if not isinstance(duration, (int, float)) or not 0 < duration <= 600:
        raise SystemExit("分析报告 duration 须在 0–600 秒内")
    if not isinstance(beats, list) or any(not isinstance(at, (int, float)) or not 0 <= at < duration for at in beats):
        raise SystemExit("分析报告 beats 须为成片时钟内的数值数组")
    if beats != sorted(set(beats)):
        raise SystemExit("分析报告 beats 须严格递增且唯一")
    details = report.get("beatDetails", [])
    if not isinstance(details, list) or (details and len(details) != len(beats)):
        raise SystemExit("分析报告 beatDetails 须与 beats 一一对应")
    if not isinstance(report.get("energy"), dict) or not isinstance(report["energy"].get("envelope"), list):
        raise SystemExit("分析报告缺少 energy.envelope")
    return report


def chart_envelope(analysis, window):
    """Downsample the shared normalized envelope for the PNG without detecting beats again."""
    if not isinstance(window, (int, float)) or window <= 0:
        raise SystemExit("--window 须为正数")
    envelope = analysis["energy"]["envelope"]
    source_step = analysis["energy"].get("hopSeconds", 0.01)
    stride = max(1, round(window / source_step))
    values = []
    for point in envelope[::stride]:
        if isinstance(point, dict) and isinstance(point.get("normalized"), (int, float)):
            values.append(point["normalized"])
    return values, source_step * stride


def draw(report, out_path, width=1600, height=560):
    duration = max(report["duration"], 0.01)
    pad_l, pad_r = 56, 24
    plot_w = width - pad_l - pad_r
    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    f_title = font(22)
    f_small = font(14)
    f_tiny = font(12)

    def x_of(t):
        return pad_l + int(plot_w * min(max(t / duration, 0.0), 1.0))

    bpm = report["bpm"]
    bpm_text = f"{bpm:.0f} BPM（estim., 未核对）" if bpm else "BPM 未估（拍点不足或超出 60–200）"
    d.text((pad_l, 16), f"时间轴 · {os.path.basename(report['source'])}", font=f_title, fill=TEXT)
    d.text((pad_l, 46), f"{duration:.1f}s · {bpm_text} · 拍点 {len(report['beats'])} · 切镜 {len(report['cuts'])}",
           font=f_small, fill=(168, 182, 206))

    top, bottom = 84, 260
    d.line([(pad_l, bottom), (width - pad_r, bottom)], fill=GRID)
    env = report["envelope"]
    peak = max(env) if env else 1.0
    for i, value in enumerate(env):
        x = x_of(i * report["window"])
        h = int((bottom - top) * min(value / peak, 1.0))
        d.line([(x, bottom), (x, bottom - h)], fill=WAVE if i % 2 == 0 else WAVE_DIM)

    # 拍点
    for index, t in enumerate(report["beats"]):
        x = x_of(t)
        detail = report["beatDetails"][index] if index < len(report["beatDetails"]) else None
        color = BEAT if detail and detail.get("confidence", 0) >= 0.65 and detail.get("evidence") == "observed" else LYRIC if detail and detail.get("confidence", 0) >= 0.65 else (105, 115, 132)
        d.line([(x, bottom + 4), (x, bottom + 26)], fill=color)
    # 切镜
    for index, cut in enumerate(report["cuts"], 1):
        x = x_of(cut["at"])
        d.line([(x, top - 12), (x, height - 60)], fill=CUT, width=2)
        d.text((x + 3, top - 26), f"{index}", font=f_tiny, fill=CUT)
    # 字幕
    for line in report["lyrics"]:
        x0, x1 = x_of(line["start"]), x_of(line["end"])
        d.line([(x0, bottom + 34), (max(x1, x0 + 2), bottom + 34)], fill=LYRIC, width=3)

    # 时间刻度
    step = 5 if duration <= 120 else (15 if duration <= 300 else 30)
    t = 0.0
    while t <= duration + 1e-6:
        x = x_of(t)
        d.line([(x, height - 58), (x, height - 50)], fill=GRID)
        d.text((x - 8, height - 44), f"{t:.0f}s", font=f_tiny, fill=(140, 154, 178))
        t += step

    legend = [("实测支持候选", BEAT), ("网格预测/低置信", LYRIC), ("切镜", CUT), ("字幕", LYRIC), ("能量包络", WAVE)]
    x = pad_l
    for label, color in legend:
        d.rectangle([x, height - 24, x + 12, height - 12], fill=color)
        d.text((x + 18, height - 26), label, font=f_tiny, fill=(168, 182, 206))
        x += 150
    img.save(out_path)
    return out_path


def load_storyboard(path):
    """读切点、歌词句头、音乐段落起点与分镜自带的拍点网格。缺失的字段返回空列表，绝不编造。"""
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    cuts = []
    for index, scene in enumerate(data.get("scenes", []), 1):
        if isinstance(scene, dict) and isinstance(scene.get("start"), (int, float)):
            cuts.append({"at": float(scene["start"]), "index": index, "id": scene.get("id")})
    lyrics = []
    for line in data.get("lyrics", []):
        if isinstance(line, dict) and isinstance(line.get("start"), (int, float)):
            lyrics.append({
                "start": float(line["start"]),
                "end": float(line.get("end", line["start"])),
                "text": line.get("text", ""),
            })
    sections = []
    grid_beats = []
    music = data.get("music")
    if isinstance(music, dict):
        if isinstance(music.get("sections"), list):
            for index, section in enumerate(music["sections"], 1):
                if isinstance(section, dict) and isinstance(section.get("start"), (int, float)):
                    sections.append({
                        "start": float(section["start"]),
                        "end": float(section.get("end", section["start"])),
                        "id": section.get("id") or f"section-{index}",
                        "label": section.get("label", ""),
                    })
        if isinstance(music.get("beats"), list):
            grid_beats = sorted(float(b) for b in music["beats"] if isinstance(b, (int, float)))
    return cuts, lyrics, sections, grid_beats


def parse_align(value):
    """解析 --align；返回按固定顺序去重后的口径列表，未知口径直接报错。"""
    modes = []
    for raw in str(value).split(","):
        mode = raw.strip().lower()
        if not mode:
            continue
        if mode not in ALIGN_MODES:
            raise SystemExit(f"--align 只接受 {'/'.join(ALIGN_MODES)}，收到：{raw.strip()!r}")
        if mode not in modes:
            modes.append(mode)
    if not modes:
        raise SystemExit(f"--align 不能为空；可选项：{'/'.join(ALIGN_MODES)}")
    return [mode for mode in ALIGN_MODES if mode in modes]


def estimate_bpm_from_grid(beats, lo=60, hi=200):
    """从分镜的局部候选拍点估计中位间隔速度，用于和音频报告并排复核。"""
    if not beats or len(beats) < 5:
        return None
    diffs = [b - a for a, b in zip(beats, beats[1:]) if b - a > 0.08]
    if len(diffs) < 4:
        return None
    bpm = 60.0 / statistics.median(diffs)
    while bpm < lo:
        bpm *= 2
    while bpm > hi:
        bpm /= 2
    return round(bpm, 1)


def bpm_reconciliation(local_bpm, grid_bpm):
    """对照「脚本估计」与「分镜网格」。两者都缺席时返回 None。

    只做提示，不自动改数：判断权留给人。

    两个数都只是候选；分镜拍点可能是旧快照，音频报告也可能低置信或选到半速网格。这里并排显示分歧，保留复核决定给人。
    """
    if not local_bpm or not grid_bpm:
        return None
    ratio = grid_bpm / local_bpm
    if abs(ratio - 1) <= 0.05:
        return {"status": "agree", "note": "脚本估计与分镜网格一致；仍以完整播放一遍为准。"}
    for label, factor in (("double", 2.0), ("half", 0.5)):
        if abs(ratio - factor) <= 0.05:
            return {"status": f"octave-{label}", "ratio": round(ratio, 3),
            "note": f"分镜网格约为音频候选的 {label}（{local_bpm} → {grid_bpm}）。"
                            f"半速/双速歧义常见，改时间之前先听实际片段并检查两种网格。"}
    return {"status": "disagree", "ratio": round(ratio, 3),
            "note": f"音频候选为 {local_bpm} BPM，分镜网格为 {grid_bpm} BPM。两者都不是核听结论："
                    f"局部速度变化、切分音、弱拍、裁切偏移或过时网格都可能造成分歧。试听并确认对应报告与分镜使用同一音频区间。"}


def resolve_align(requested, sections):
    """省略 --align 时：分镜有 music.sections 就优先 sections，否则 beats。显式选择永远优先。"""
    if requested:
        return requested, "explicit"
    if sections:
        return ["sections"], "auto:sections-present"
    return ["beats"], "auto:no-sections"


def reference_points(mode, beats, lyrics, sections, grid_beats=None):
    """返回（参考点列表, 来源说明, 是否可用）。参考数据缺失时明确 unavailable。

    beats 口径优先用分镜自带的 music.beats；没有时才使用当前 audio-analysis 报告。
    """
    if mode == "beats":
        if grid_beats:
            return ([{"at": float(at), "id": f"beat-{index + 1}"} for index, at in enumerate(grid_beats)],
                    "storyboard-music-beats", True)
        if not beats:
            return [], "no-beat-candidates", False
        return [{"at": float(at), "id": f"beat-{index + 1}"} for index, at in enumerate(beats)], "audio-analysis-beats", True
    if mode == "lyrics":
        if not lyrics:
            return [], "storyboard-lyrics-missing", False
        return [{"at": float(line["start"]), "id": line.get("id") or f"line-{index + 1}", "text": line.get("text", "")}
                for index, line in enumerate(lyrics)], "storyboard-lyrics", True
    if mode == "sections":
        if not sections:
            return [], "storyboard-music-sections-missing", False
        return [{"at": float(section["start"]), "id": section.get("id"), "label": section.get("label", "")}
                for section in sections], "storyboard-music-sections", True
    raise SystemExit(f"未知对齐口径：{mode}")


def alignment_stats(mode, cuts, points, source, available):
    """每个切镜的带符号偏移 + 绝对偏差中位数/最大值 + 落在 80ms 内的计数。"""
    report = {
        "mode": mode,
        "source": source,
        "status": "ok" if available else "unavailable",
        "reference_count": len(points),
        "cut_count": len(cuts),
        "samples": [],
        "offset_median_signed": None,
        "abs_offset_median": None,
        "abs_offset_max": None,
        "within_80ms": None,
        "within_80ms_total": None,
    }
    if not available:
        report["reason"] = "参考点缺失，无法计算偏移；不伪造匹配。"
        return report
    if not cuts:
        report["reason"] = "分镜没有切点，无法计算偏移。"
        return report
    for cut in cuts:
        nearest = min(points, key=lambda point: abs(point["at"] - cut["at"]))
        offset = cut["at"] - nearest["at"]
        report["samples"].append({
            "cut": round(cut["at"], 3),
            "cut_index": cut.get("index"),
            "cut_id": cut.get("id"),
            "nearest_reference": round(nearest["at"], 3),
            "nearest_reference_id": nearest.get("id"),
            "offset": round(offset, 3),
        })
    signed = [item["offset"] for item in report["samples"]]
    absolute = [abs(value) for value in signed]
    report["offset_median_signed"] = round(statistics.median(signed), 3)
    report["abs_offset_median"] = round(statistics.median(absolute), 3)
    report["abs_offset_max"] = round(max(absolute), 3)
    report["within_80ms"] = sum(1 for value in absolute if value <= 0.08)
    report["within_80ms_total"] = len(absolute)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="把音频、镜头、字幕画到同一条时间轴上")
    parser.add_argument("source", help="音频或视频文件（视频会自动取音轨）")
    parser.add_argument("--storyboard", help="可选：分镜 JSON，用来画切点与字幕")
    parser.add_argument("--analysis", help="可选：复用 analyze-audio.mjs JSON 报告，避免重复分析")
    parser.add_argument("-o", "--out", default="work/timeline.png", help="输出 PNG")
    parser.add_argument("--json", dest="json_path", help="另存一份 JSON 报告")
    parser.add_argument("--window", type=float, default=0.02, help="PNG 能量包络采样间隔（秒），默认 0.02")
    parser.add_argument("--sr", type=int, choices=(8000, 16000), default=8000, help="默认分析采样率，默认 8000")
    parser.add_argument("--align", default=None, help=ALIGN_HELP)
    args = parser.parse_args(argv)
    try:
        assert_no_path_aliases(
            inputs=[args.source, args.storyboard, args.analysis],
            outputs=[args.out, args.json_path],
        )
    except ValueError as exc:
        raise SystemExit(str(exc))

    align_requested = parse_align(args.align) if args.align is not None else None

    if not os.path.isfile(args.source) or not os.access(args.source, os.R_OK):
        raise SystemExit(f"无法读取音频/视频文件：{args.source}")

    analysis = load_audio_analysis(args.source, args.analysis, args.sr)
    env, window = chart_envelope(analysis, args.window)
    beats = analysis["beats"]
    beat_details = analysis.get("beatDetails", [])
    sr = analysis.get("sampleRate", args.sr)
    duration = analysis["duration"]
    cuts, lyrics, sections, grid_beats = load_storyboard(args.storyboard) if args.storyboard else ([], [], [], [])
    if args.storyboard:
        with open(args.storyboard, encoding="utf-8") as handle:
            storyboard_data = json.load(handle)
        project = storyboard_data.get("project", {})
        if isinstance(project.get("duration"), (int, float)) and abs(project["duration"] - duration) > max(1e-6, 1 / sr):
            raise SystemExit("分析与分镜时长错配；请分析同一成片区间")
        source_offset = project.get("sourceOffset")
        if isinstance(source_offset, (int, float)) and abs(source_offset - analysis.get("sourceOffset", 0)) > 1e-6:
            raise SystemExit("分析与分镜 sourceOffset 错配；请使用同一音频裁切范围")
    align_modes, align_source = resolve_align(align_requested, sections)
    bpm = analysis.get("tempo", {}).get("bpm")
    grid_bpm = estimate_bpm_from_grid(grid_beats)
    bpm_agreement = bpm_reconciliation(bpm, grid_bpm)

    report = {
        "source": args.source,
        "duration": round(duration, 3),
        "window": window,
        "sr": sr,
        "beats": [round(b, 3) for b in beats],
        "beat_source": "analyze-audio",
        "beatDetails": beat_details,
        "tempo_windows": analysis.get("tempo", {}).get("windows", []),
        "bpm": bpm,
        "bpm_status": "speculative" if bpm else None,
        "tempo_status": analysis.get("tempo", {}).get("status"),
        "bpm_grid": grid_bpm,
        "bpm_grid_status": "storyboard-grid" if grid_bpm else None,
        "bpm_reconciliation": bpm_agreement,
        "beat_threshold": None,
        "cuts": cuts,
        "lyrics": lyrics,
        "envelope": [round(v, 5) for v in env],
        "note": "拍点来自 analyze-audio.mjs 的局部窗口候选，并附观测/预测来源与启发式置信值；未经人工核对，不能据此宣称音画同步。",
        "align": {
            "modes": align_modes,
            "source": align_source,
            "requested": align_requested,
            "note": "切镜按哪个口径对齐由 --align 决定；按歌词或段落剪的片子不应以拍点口径判断对错。",
        },
        "alignment": {},
    }

    beats_per_cut = []
    beat_confidence = {round(item.get("at", -1), 6): item for item in beat_details if isinstance(item, dict)}
    for cut in cuts:
        nearest = min(beats, key=lambda b: abs(b - cut["at"])) if beats else None
        detail = beat_confidence.get(round(nearest, 6)) if nearest is not None else None
        if nearest is not None:
            beats_per_cut.append({"cut": cut["at"], "nearest_beat": round(nearest, 3),
                                  "offset": round(cut["at"] - nearest, 3),
                                  "confidence": detail.get("confidence") if detail else None,
                                  "evidence": detail.get("evidence") if detail else None})
    if beats_per_cut:
        offsets = [abs(item["offset"]) for item in beats_per_cut]
        report["cut_to_beat"] = {
            "offset_median": round(statistics.median(offsets), 3),
            "offset_max": round(max(offsets), 3),
            "within_80ms": sum(1 for o in offsets if o <= 0.08),
            "samples": beats_per_cut,
        }

    for mode in align_modes:
        points, point_source, available = reference_points(mode, beats, lyrics, sections, grid_beats)
        report["alignment"][mode] = alignment_stats(mode, cuts, points, point_source, available)

    folder = os.path.dirname(os.path.abspath(args.out))
    if folder:
        os.makedirs(folder, exist_ok=True)
    draw(report, args.out)
    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as handle:
            json.dump({k: v for k, v in report.items() if k != "envelope"}, handle, ensure_ascii=False, indent=2)

    bpm_line = f"{bpm:.0f} BPM ({analysis.get('tempo', {}).get('status', 'candidate')})" if bpm else "BPM: n/a"
    print(f"duration {duration:.2f}s | beats {len(beats)} | {bpm_line} | cuts {len(cuts)} | lyrics {len(lyrics)} | align {','.join(align_modes)} ({align_source})")
    # 分镜网格和分析报告不一致时，只呈现差异，不替人选择网格。
    if grid_bpm:
        print(f"bpm from storyboard grid: {grid_bpm:.0f}（{len(grid_beats)} 个拍点）")
    if bpm_agreement:
        tag = bpm_agreement["status"]
        if tag == "agree":
            print(f"bpm 对照: 一致（{bpm_agreement['note']}）")
        else:
            print(f"bpm 对照: {tag} —— {bpm_agreement['note']}")
    # 老输出保持不变：只要拍点口径在本次口径里，就照旧打印那一行。
    if "beats" in align_modes and "cut_to_beat" in report:
        stats = report["cut_to_beat"]
        print(f"cut-to-beat offset median {stats['offset_median']*1000:.0f}ms, max {stats['offset_max']*1000:.0f}ms, "
              f"within 80ms: {stats['within_80ms']}/{len(stats['samples'])}")
    for mode in align_modes:
        stats = report["alignment"][mode]
        if stats["status"] != "ok":
            print(f"cut-to-{mode}: unavailable（{stats['source']}）；{stats['reason']}")
            continue
        print(f"cut-to-{mode} offset median {stats['offset_median_signed']*1000:+.0f}ms (signed), "
              f"abs median {stats['abs_offset_median']*1000:.0f}ms, abs max {stats['abs_offset_max']*1000:.0f}ms, "
              f"within 80ms: {stats['within_80ms']}/{stats['within_80ms_total']}（参考点 {stats['reference_count']}）")
    print(f"png -> {args.out}")
    if args.json_path:
        print(f"json -> {args.json_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
