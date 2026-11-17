#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""timeline-sync.py —— 把音频、镜头、字幕画到同一条时间轴上。

用法：
  python timeline-sync.py song.wav -o work/timeline.png
  python timeline-sync.py final.mp4 --storyboard storyboard.json -o work/timeline.png --json work/timeline.json

输出两样东西：
  1. 一张 PNG：能量包络 + 估出来的拍点 + 分镜的切点 + 字幕起止
  2. 一份 JSON：duration / bpm / beats / cuts / lyrics / 空隙统计

**它不证明音画同步。** 拍点是从能量瞬变猜的，BPM 只在拍点够多时才给，
且永远标 speculative。真正的判断仍然是完整播放一遍。

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
    return cuts, lyrics


def main(argv=None):
    parser = argparse.ArgumentParser(description="把音频、镜头、字幕画到同一条时间轴上")
    parser.add_argument("source", help="音频或视频文件（视频会自动取音轨）")
    parser.add_argument("--storyboard", help="可选：分镜 JSON，用来画切点与字幕")
    parser.add_argument("-o", "--out", default="work/timeline.png", help="输出 PNG")
    parser.add_argument("--json", dest="json_path", help="另存一份 JSON 报告")
    parser.add_argument("--window", type=float, default=0.02, help="包络窗长（秒），默认 0.02")
    parser.add_argument("--sensitivity", type=float, default=1.0, help="拍点阈值灵敏度，越大越挑")
    parser.add_argument("--sr", type=int, default=8000, help="解码采样率，默认 8000")
    args = parser.parse_args(argv)

    samples, sr = decode(args.source, args.sr)
    env = envelope(samples, sr, args.window)
    beats, threshold = find_beats(env, args.window, args.sensitivity)
    duration = len(samples) / float(sr)
    bpm = estimate_bpm(beats)

    cuts, lyrics = load_storyboard(args.storyboard) if args.storyboard else ([], [])
    report = {
        "source": args.source,
        "duration": round(duration, 3),
        "window": args.window,
        "sr": sr,
        "beats": [round(b, 3) for b in beats],
        "bpm": bpm,
        "bpm_status": "speculative" if bpm else None,
        "beat_threshold": round(threshold, 6),
        "cuts": cuts,
        "lyrics": lyrics,
        "envelope": [round(v, 5) for v in env],
        "note": "拍点与 BPM 由能量瞬变估计，未经人工核对；不能据此宣称音画同步。",
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

    folder = os.path.dirname(os.path.abspath(args.out))
    if folder:
        os.makedirs(folder, exist_ok=True)
    draw(report, args.out)
    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as handle:
            json.dump({k: v for k, v in report.items() if k != "envelope"}, handle, ensure_ascii=False, indent=2)

    bpm_line = f"{bpm:.0f} BPM (speculative)" if bpm else "BPM: n/a"
    print(f"duration {duration:.2f}s | beats {len(beats)} | {bpm_line} | cuts {len(cuts)} | lyrics {len(lyrics)}")
    if "cut_to_beat" in report:
        stats = report["cut_to_beat"]
        print(f"cut-to-beat offset median {stats['offset_median']*1000:.0f}ms, max {stats['offset_max']*1000:.0f}ms, "
              f"within 80ms: {stats['within_80ms']}/{len(stats['samples'])}")
    print(f"png -> {args.out}")
    if args.json_path:
        print(f"json -> {args.json_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
