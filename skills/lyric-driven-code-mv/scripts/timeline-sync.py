#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""timeline-sync.py —— 把音频、镜头、字幕画到同一条时间轴上。

用法：
  python timeline-sync.py song.wav -o work/timeline.png
  python timeline-sync.py final.mp4 --storyboard storyboard.json -o work/timeline.png --json work/timeline.json
  python timeline-sync.py final.mp4 --storyboard storyboard.json --align lyrics,sections

输出两样东西：
  1. 一张 PNG：能量包络 + 估出来的拍点 + 分镜的切点 + 字幕起止
  2. 一份 JSON：duration / bpm / beats / cuts / lyrics / 空隙统计 / 各口径对齐统计

**它不证明音画同步。** 拍点是从能量瞬变猜的，BPM 只在拍点够多时才给，
且永远标 speculative。真正的判断仍然是完整播放一遍。

--align 决定「切镜该跟谁对齐」：
  beats     跟着估出来的拍点（默认口径之一）
  lyrics    跟着歌词句头（storyboard.lyrics[].start）
  sections  跟着音乐段落起点（storyboard.music.sections[].start）
可以多选，例如 --align beats,lyrics；省略时：分镜有 music.sections 就用 sections，否则用 beats。
按歌词句头或段落切镜的片子本来就不该跟拍点对齐，用错口径只会让人误以为剪错了。

依赖：ffmpeg（必须）、Pillow（画图）。
"""
import argparse
import array
import json
import math
import os
import statistics
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont
from path_safety import assert_no_path_aliases

ALIGN_MODES = ("beats", "lyrics", "sections")
ALIGN_HELP = "切镜对齐口径：beats（估出来的拍点）/ lyrics（歌词句头）/ sections（音乐段落起点），逗号分隔可多选"

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


def decode(path, sr=8000):
    """用 ffmpeg 解成 8kHz 单声道 s16，足够画包络与找瞬变。"""
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(sr), "-"]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        message = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        hint = "（这个文件可能没有音轨）" if "Audio" in " ".join(message) or "Stream" in " ".join(message) else ""
        raise SystemExit(f"ffmpeg 解码失败{hint}：{message[-1] if message else '未知错误'}")
    samples = array.array("h")
    samples.frombytes(proc.stdout[: len(proc.stdout) // 2 * 2])
    return samples, sr


def envelope(samples, sr, win=0.02):
    step = max(1, int(sr * win))
    out = []
    for i in range(0, len(samples) - step + 1, step):
        chunk = samples[i:i + step]
        total = 0
        for value in chunk:
            total += value * value
        out.append(math.sqrt(total / step) / 32768.0)
    return out


def find_beats(env, win, sensitivity=1.0, min_gap=0.15):
    """能量瞬变 + 峰值挑选。返回（秒数列表, 阈值）。"""
    if len(env) < 3:
        return [], 0.0
    flux = [0.0] + [max(0.0, env[i] - env[i - 1]) for i in range(1, len(env))]
    mean = sum(flux) / len(flux)
    sd = statistics.pstdev(flux) if len(flux) > 1 else 0.0
    threshold = mean + sensitivity * sd
    picks = []
    for i, value in enumerate(flux):
        if value <= threshold or value <= 0:
            continue
        t = i * win
        if picks and t - picks[-1][0] < min_gap:
            if value > picks[-1][1]:
                picks[-1] = (t, value)
            continue
        picks.append((t, value))
    return [t for t, _ in picks], threshold


def estimate_bpm(beats, lo=60, hi=200):
    """只用拍点间隔的中位数估 BPM；样本不足或超范围就返回 None。"""
    if len(beats) < 5:
        return None
    diffs = [b - a for a, b in zip(beats, beats[1:]) if b - a > 0.08]
    if len(diffs) < 4:
        return None
    median = statistics.median(diffs)
    bpm = 60.0 / median
    while bpm < lo:
        bpm *= 2
    while bpm > hi:
        bpm /= 2
    return round(bpm, 1)


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
    for t in report["beats"]:
        x = x_of(t)
        d.line([(x, bottom + 4), (x, bottom + 26)], fill=BEAT)
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

    legend = [("拍点（估）", BEAT), ("切镜", CUT), ("字幕", LYRIC), ("能量包络", WAVE)]
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
    """从一段拍点数组（分镜里的 music.beats）用中位间隔估 BPM。

    与 estimate_bpm 的区别：那个吃的是本脚本自己挑的瞬变，这个吃的是分镜里
    已经定稿的拍点网格。后者才是权威——它多半来自 analyze-audio.mjs 的
    起音拟合。两个数摆在一起就能看出「脚本估的」和「分镜用的」是否打架。
    """
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

    注意这两个数都不是权威。真正有起音拟合验证的是 analyze-audio.mjs 的输出，
    分镜网格只是它某一次运行的快照——快照可能是旧的、错的。所以这里不写
    「信分镜」，而是把分歧摆出来并指向该复核的工具。
    """
    if not local_bpm or not grid_bpm:
        return None
    ratio = grid_bpm / local_bpm
    if abs(ratio - 1) <= 0.05:
        return {"status": "agree", "note": "脚本估计与分镜网格一致；仍以完整播放一遍为准。"}
    for label, factor in (("double", 2.0), ("half", 0.5)):
        if abs(ratio - factor) <= 0.05:
            return {"status": f"octave-{label}", "ratio": round(ratio, 3),
                    "note": f"分镜网格约为脚本估计的 {label}（{local_bpm} → {grid_bpm}）。"
                            f"半速/双速歧义在这类估计里最常见，改一个数之前先把两种网格都摆到波形上看。"}
    return {"status": "disagree", "ratio": round(ratio, 3),
            "note": f"脚本估出 {local_bpm} BPM，分镜网格是 {grid_bpm} BPM。两者都不是权威："
                    f"脚本只用能量瞬变的中位间隔，遇切分音会偏；分镜网格是某次离线分析的快照，可能已过时。"
                    f"以 analyze-audio.mjs 的起音拟合结果为准，并确认写进分镜的 music.beats 来自同一次运行。"}


def resolve_align(requested, sections):
    """省略 --align 时：分镜有 music.sections 就优先 sections，否则 beats。显式选择永远优先。"""
    if requested:
        return requested, "explicit"
    if sections:
        return ["sections"], "auto:sections-present"
    return ["beats"], "auto:no-sections"


def reference_points(mode, beats, lyrics, sections, grid_beats=None):
    """返回（参考点列表, 来源说明, 是否可用）。参考数据缺失时明确 unavailable。

    beats 口径优先用分镜自带的 music.beats，而不是本脚本从头估的拍点。
    理由：分镜网格来自 analyze-audio.mjs 的起音拟合（含强起音验证），
    本脚本只用能量瞬变的中位间隔。拿更差的估计去判断切点对错，
    会在已经精确吸附的分镜上得出"只有 4/12 卡在 80ms 内"的假结论。
    """
    if mode == "beats":
        if grid_beats:
            return ([{"at": float(at), "id": f"beat-{index + 1}"} for index, at in enumerate(grid_beats)],
                    "storyboard-music-beats", True)
        if not beats:
            return [], "no-beat-candidates", False
        return [{"at": float(at), "id": f"beat-{index + 1}"} for index, at in enumerate(beats)], "estimated-beats", True
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
    parser.add_argument("-o", "--out", default="work/timeline.png", help="输出 PNG")
    parser.add_argument("--json", dest="json_path", help="另存一份 JSON 报告")
    parser.add_argument("--window", type=float, default=0.02, help="包络窗长（秒），默认 0.02")
    parser.add_argument("--sensitivity", type=float, default=1.0, help="拍点阈值灵敏度，越大越挑")
    parser.add_argument("--sr", type=int, default=8000, help="解码采样率，默认 8000")
    parser.add_argument("--align", default=None, help=ALIGN_HELP)
    args = parser.parse_args(argv)
    try:
        assert_no_path_aliases(
            inputs=[args.source, args.storyboard],
            outputs=[args.out, args.json_path],
        )
    except ValueError as exc:
        raise SystemExit(str(exc))

    align_requested = parse_align(args.align) if args.align is not None else None

    samples, sr = decode(args.source, args.sr)
    env = envelope(samples, sr, args.window)
    beats, threshold = find_beats(env, args.window, args.sensitivity)
    duration = len(samples) / float(sr)
    cuts, lyrics, sections, grid_beats = load_storyboard(args.storyboard) if args.storyboard else ([], [], [], [])
    align_modes, align_source = resolve_align(align_requested, sections)
    bpm = estimate_bpm(beats)
    grid_bpm = estimate_bpm_from_grid(grid_beats)
    bpm_agreement = bpm_reconciliation(bpm, grid_bpm)

    report = {
        "source": args.source,
        "duration": round(duration, 3),
        "window": args.window,
        "sr": sr,
        "beats": [round(b, 3) for b in beats],
        "bpm": bpm,
        "bpm_status": "speculative" if bpm else None,
        "bpm_grid": grid_bpm,
        "bpm_grid_status": "storyboard-grid" if grid_bpm else None,
        "bpm_reconciliation": bpm_agreement,
        "beat_threshold": round(threshold, 6),
        "cuts": cuts,
        "lyrics": lyrics,
        "envelope": [round(v, 5) for v in env],
        "note": "拍点与 BPM 由能量瞬变估计，未经人工核对；不能据此宣称音画同步。",
        "align": {
            "modes": align_modes,
            "source": align_source,
            "requested": align_requested,
            "note": "切镜按哪个口径对齐由 --align 决定；按歌词或段落剪的片子不应以拍点口径判断对错。",
        },
        "alignment": {},
    }

    beats_per_cut = []
    for cut in cuts:
        nearest = min(beats, key=lambda b: abs(b - cut["at"])) if beats else None
        if nearest is not None:
            beats_per_cut.append({"cut": cut["at"], "nearest_beat": round(nearest, 3),
                                  "offset": round(cut["at"] - nearest, 3)})
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

    bpm_line = f"{bpm:.0f} BPM (speculative)" if bpm else "BPM: n/a"
    print(f"duration {duration:.2f}s | beats {len(beats)} | {bpm_line} | cuts {len(cuts)} | lyrics {len(lyrics)} | align {','.join(align_modes)} ({align_source})")
    # 分镜自带拍点网格时，把「脚本估的」和「分镜用的」并排摆出来。
    # 不并排就会出事：这一版脚本对同一首歌估 125 BPM，而离线分析给出 144.1，
    # 谁照着错的那个数排拍点，就会重演「大部分没卡上」。
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
