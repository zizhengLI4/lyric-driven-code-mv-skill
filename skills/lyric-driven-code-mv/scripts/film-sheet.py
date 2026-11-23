#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""film-sheet.py —— 把一支片子的抽帧拼成接触表（contact sheet）。

为什么需要它：一帧一帧看会漏结构，顺序看 6–14 张会看到"段落"。
一张图看完，才能判断装置、章节、HUD 变化密度。

用法：
  # 1) 已经抽好帧（目录里是 png/jpg，按文件名排序）
  python film-sheet.py shots/7708xxx -o sheet.jpg
  python film-sheet.py shots/7708xxx -o sheet.jpg --cols 3 --width 460

  # 2) 直接给视频，自动均匀抽帧（需要 ffmpeg 在 PATH）
  python film-sheet.py output.mp4 -o sheet.jpg --frames 12

  # 3) 目录里有 meta.json（形如 {"duration":182.7,"frames":[{"t":19.6},...]}）
  #    会在每格左上角标出真实时间戳
  python film-sheet.py shots/7708xxx -o sheet.jpg

只依赖 Pillow；抽视频帧时额外调用 ffmpeg。
"""
import argparse
import hashlib
import math
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from path_safety import assert_no_path_aliases

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover
    raise SystemExit("需要 Pillow：python -m pip install pillow")

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
LABEL_H = 22


def probe_duration(path):
    """用 ffprobe 读时长；失败返回 None。"""
    ffprobe = os.environ.get("FFPROBE_PATH") or shutil.which("ffprobe")
    if not ffprobe:
        return None
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return float(out)
    except (subprocess.CalledProcessError, ValueError):
        return None


def extract_frames(video, count, workdir):
    """均匀抽 count 帧到 workdir，返回 [(path, t)]。"""
    ffmpeg = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("抽视频帧需要 FFmpeg。可设置 FFMPEG_PATH 或使用已有 PATH 配置。")
    duration = probe_duration(video)
    if not duration:
        raise SystemExit("读不到视频时长，请改用已抽好的帧目录。")
    out = []
    for i in range(count):
        t = max(0.05, duration * (i + 0.5) / count)
        png = Path(workdir) / f"f{i:02d}.png"
        subprocess.run(
            [ffmpeg, "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(video),
             "-frames:v", "1", str(png)],
            check=True,
        )
        if png.exists():
            out.append((png, round(t, 2)))
    return out


def extract_review_frames(video, index_path, destination, strip=None, crop=None):
    """按审片索引一次解码，保留每个唯一帧的正式尺寸 PNG。"""
    ffmpeg = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg")
    ffprobe = os.environ.get("FFPROBE_PATH") or shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise SystemExit("逐镜抽帧需要 FFmpeg 与 FFprobe。")
    if not video.is_file():
        raise SystemExit("逐镜抽帧的输入须为视频文件。")
    manifest = video.with_name(video.name + ".assets.json")
    assert_no_path_aliases(inputs=[video, index_path, *([manifest] if manifest.is_file() else [])], outputs=[destination])
    plan = json.loads(index_path.read_text(encoding="utf-8-sig"))
    frames = sorted({item["frame"] for scene in plan["scenes"] for item in scene["frames"]})
    if plan.get('schemaVersion') != 1 or not frames or any(type(frame) is not int or frame < 0 or frame >= plan["totalFrames"] for frame in frames):
        raise SystemExit("审片索引中的帧号无效。")
    probe = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=avg_frame_rate,nb_frames,width,height", "-of", "json", str(video)],
        capture_output=True, text=True, check=True,
    )
    streams = json.loads(probe.stdout)["streams"]
    if not streams:
        raise SystemExit("没有找到视频流。")
    stream = streams[0]
    if stream.get("nb_frames") is None:
        counted = subprocess.run(
            [ffprobe, "-v", "error", "-select_streams", "v:0", "-count_frames",
             "-show_entries", "stream=nb_read_frames", "-of", "json", str(video)],
            capture_output=True, text=True, check=True,
        )
        stream["nb_frames"] = json.loads(counted.stdout)["streams"][0].get("nb_read_frames")
    num, den = map(int, stream["avg_frame_rate"].split("/"))
    if den == 0 or not math.isclose(num / den, plan["fps"], abs_tol=0.000001) or str(plan["totalFrames"]) != stream.get("nb_frames"):
        raise SystemExit("视频帧率或帧数与分镜索引不一致。先检查是否用同一版分镜导出。")

    if strip:
        start, end = strip
        if not all(map(math.isfinite, strip)) or not 0 <= start < end <= plan["duration"]:
            raise SystemExit("--strip 须给出成片时段内的 start < end，单位为成片秒。")
        first, stop = (math.ceil(t * plan["fps"] - 1e-9) for t in strip)
        if first >= stop:
            raise SystemExit("--strip 范围内没有成片帧。")
        frames = list(range(first, stop))
    if crop:
        x, y, width, height = crop
        if min(x, y) < 0 or min(width, height) < 1 or x + width > stream["width"] or y + height > stream["height"]:
            raise SystemExit("--crop 的 X Y W H 须在成片画幅内。")
    digest = hashlib.sha256()
    with video.open("rb") as source:
        for block in iter(lambda: source.read(2 << 20), b""):
            digest.update(block)
    video_hash = digest.hexdigest()
    if manifest.is_file():
        bundle = json.loads(manifest.read_text(encoding="utf-8-sig"))
        if bundle.get("storyboardSha256") != plan.get("storyboardSha256") or bundle.get("output", {}).get("sha256") != video_hash:
            raise SystemExit("成片、素材清单和分镜索引的版本不一致。")
    plan["binding"] = "export-manifest" if manifest.is_file() else "timing-only"
    plan["videoSha256"] = video_hash
    destination = destination.resolve()
    if destination.exists():
        raise SystemExit("逐镜审片目录须使用新路径。")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mv-review-", dir=destination.parent) as tmp:
        scratch = Path(tmp)
        staging = scratch / "result"
        staging.mkdir()
        if strip:
            expression = f"between(n,{frames[0]},{frames[-1]})"
        else:
            expression = "+".join(f"eq(n,{frame})" for frame in frames)
        filters = "select='" + expression + "'"
        if crop:
            filters += f",crop={width}:{height}:{x}:{y}:exact=1"
        if len(filters) <= 18000:
            filter_args = ["-filter:v", filters]
        else:
            script = scratch / "select.filter"
            script.write_text(filters, encoding="ascii")
            filter_args = ["-/filter:v", str(script)]
        subprocess.run(
            [ffmpeg, "-v", "error", "-xerror", "-i", str(video), "-map", "0:v:0", "-an",
             *filter_args, "-fps_mode", "passthrough", "-start_number", "0",
             "-threads", "1", str(scratch / "pick-%06d.png")],
            check=True,
        )
        actual = sorted(scratch.glob("pick-*.png"))
        if len(actual) != len(frames):
            raise SystemExit("实际抽帧数与审片索引不符。")
        for frame, path in zip(frames, actual):
            path.replace(staging / f"frame-{frame:06d}.png")
        files = {frame: f"frame-{frame:06d}.png" for frame in frames}
        for scene in plan["scenes"]:
            for point in scene["frames"]:
                if point["frame"] in files:
                    point["file"] = files[point["frame"]]
        if strip:
            plan["strip"] = {
                "range": strip,
                "frames": [{"frame": frame, "time": frame / plan["fps"], "file": path}
                           for frame, path in files.items()],
            }
        if crop:
            plan["crop"] = crop
        (staging / "review-index.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        staging.rename(destination)
    print(f"已生成 {len(plan['scenes'])} 镜、{len(frames)} 张正式尺寸静帧及审片索引：{destination}")


def collect(target, frames, workdir):
    """返回 [(图片路径, 时间或 None)]。"""
    target = Path(target)
    if target.is_dir():
        files = sorted(p for p in target.iterdir() if p.suffix.lower() in IMAGE_EXTS)
        if not files:
            raise SystemExit(f"{target} 里没有图片。")
        times = []
        meta = target / "meta.json"
        if meta.exists():
            try:
                data = json.loads(meta.read_text(encoding="utf-8"))
                times = [f.get("t") for f in data.get("frames", [])]
            except (json.JSONDecodeError, OSError):
                times = []
        return [(p, times[i] if i < len(times) else None) for i, p in enumerate(files)]
    return extract_frames(target, frames, workdir)


def main(argv=None):
    ap = argparse.ArgumentParser(description="抽帧接触表")
    ap.add_argument("target", help="帧目录或视频文件")
    ap.add_argument("-o", "--out", default="sheet.jpg", help="输出图片（默认 sheet.jpg）")
    ap.add_argument("--cols", type=int, default=3, help="列数（默认 3）")
    ap.add_argument("--width", type=int, default=460, help="每格宽度（默认 460）")
    ap.add_argument("--frames", type=int, default=12, help="给视频时抽几帧（默认 12）")
    ap.add_argument("--title", default="", help="图头文字，默认取目录名")
    ap.add_argument("--review-index", type=Path, help="qa.mjs 生成的逐镜索引")
    ap.add_argument("--review-dir", type=Path, help="保存正式尺寸帧与复核索引的新目录")
    ap.add_argument("--strip", nargs=2, type=float, metavar=("START", "END"), help="取成片秒区间 [START,END) 的全部连续帧")
    ap.add_argument("--crop", nargs=4, type=int, metavar=("X", "Y", "W", "H"), help="按正式画幅像素坐标截取细节")
    args = ap.parse_args(argv)
    if args.review_index or args.review_dir or args.strip or args.crop:
        if not args.review_index or not args.review_dir:
            ap.error("--review-index 和 --review-dir 必须同时指定")
        extract_review_frames(Path(args.target), args.review_index, args.review_dir, args.strip, args.crop)
        return 0

    with tempfile.TemporaryDirectory(prefix="film-sheet-") as tmp:
        items = collect(args.target, max(1, args.frames), tmp)
        target = Path(args.target)
        inputs = [target]
        if target.is_dir():
            inputs.extend(path for path, _ in items)
            metadata = target / "meta.json"
            if metadata.exists():
                inputs.append(metadata)
        assert_no_path_aliases(inputs=inputs, outputs=[args.out])

        ims = []
        for path, t in items:
            try:
                im = Image.open(path).convert("RGB")
            except OSError:
                continue
            h = round(im.height * args.width / im.width)
            ims.append((im.resize((args.width, h), Image.LANCZOS), t))
        if not ims:
            raise SystemExit("没有可用图片。")

        cols = max(1, args.cols)
        rows = (len(ims) + cols - 1) // cols
        cell_h = max(im.height for im, _ in ims)
        pad = 6
        title = args.title or Path(args.target).name
        head = 30 if title else 0
        sheet = Image.new(
            "RGB",
            (cols * args.width + pad * (cols + 1), rows * (cell_h + LABEL_H) + pad * (rows + 1) + head),
            (18, 18, 22),
        )
        dr = ImageDraw.Draw(sheet)
        if head:
            dr.text((10, 8), f"{title}  ({len(ims)} frames)", fill=(235, 235, 240))

        for i, (im, t) in enumerate(ims):
            r, c = divmod(i, cols)
            x = pad + c * (args.width + pad)
            y = head + pad + r * (cell_h + LABEL_H + pad)
            sheet.paste(im, (x, y + LABEL_H))
            label = f"t={t}s" if isinstance(t, (int, float)) else f"#{i + 1}"
            dr.text((x + 4, y + 6), label, fill=(255, 214, 110))

        sheet.save(args.out, quality=88)
        print(f"已保存 {args.out}（{len(ims)} 帧，{cols} 列）")
        return 0


if __name__ == "__main__":
    sys.exit(main())
