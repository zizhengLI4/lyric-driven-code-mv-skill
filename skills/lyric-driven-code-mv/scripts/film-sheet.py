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
    if not shutil.which("ffprobe"):
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return float(out)
    except (subprocess.CalledProcessError, ValueError):
        return None


def extract_frames(video, count, workdir):
    """均匀抽 count 帧到 workdir，返回 [(path, t)]。"""
    if not shutil.which("ffmpeg"):
        raise SystemExit("抽视频帧需要 ffmpeg 在 PATH 里。")
    duration = probe_duration(video)
    if not duration:
        raise SystemExit("读不到视频时长，请改用已抽好的帧目录。")
    out = []
    for i in range(count):
        t = max(0.05, duration * (i + 0.5) / count)
        png = Path(workdir) / f"f{i:02d}.png"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(video),
             "-frames:v", "1", str(png)],
            check=True,
        )
        if png.exists():
            out.append((png, round(t, 2)))
    return out


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
    args = ap.parse_args(argv)

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
