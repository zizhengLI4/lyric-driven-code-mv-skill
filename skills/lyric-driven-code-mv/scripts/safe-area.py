#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""safe-area.py —— 平台安全区参考线，可叠加到帧或视频上检查。

用法：
  python safe-area.py --width 1920 --height 1080 -o work/safe-area.png      # 只出参考图
  python safe-area.py --overlay work/frame_00090.png -o work/checked.png    # 叠加到某一帧
  python safe-area.py --video work/silent.mp4 --at 1 6 11 -o work/vcheck.png # 从视频抽几帧叠

为什么要有这个：参考片被平台压过一道，底部进度条、右侧点赞/评论、顶部搜索都会盖住画面。
字幕、HUD 关键读数如果放进去，观众就是看不见。

依赖：Pillow；--video 需要 ffmpeg。
"""
import argparse
import math
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
]
TITLE = (128, 232, 164)
SUB = (255, 168, 96)
RIGHT = (238, 116, 116)
SAFE = (108, 196, 236)
TEXT = (236, 244, 255)


def font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    raise SystemExit("找不到中文字体，请在 FONT_CANDIDATES 里加一条本机路径。")


def zones(w, h):
    # 边距口径必须与 layout-check.py 的 DEFAULT_SAFE 和文档「底边 ≥92px / 右侧 ≥124px」
    # 完全一致，否则两个工具会互相判对方越界：
    #   底部 0.085*1080 = 91.8 → 向上取整 92（宁严勿松，线画在 y=988）
    #   右侧 0.065*1920 = 124.8 → 截断 124（线画在 x=1796）
    # 别换成同一个取整函数：ceil 会把右侧推到 125、int 会把底部压到 91，两种都会打架。
    return {
        "title": (0, 0, w, int(h * 0.11)),
        "subtitle": (0, h - math.ceil(h * 0.085), w, h),
        "right": (w - int(w * 0.065), 0, w, h),
        "center43": (
            int(w * 0.075), int(h * 0.09),
            int(w * 0.925), int(h * 0.91),
        ),
        "vertical": (
            (w - int(h * 9 / 16)) // 2, 0,
            (w + int(h * 9 / 16)) // 2, h,
        ),
    }


def hatch(layer, box, color, step=14, width=1):
    """斜线填充，只画在 box 内：先在小块上画，再贴回去，避免斜线横穿全屏。"""
    x0, y0, x1, y1 = (int(v) for v in box)
    w, h = x1 - x0, y1 - y0
    if w <= 0 or h <= 0:
        return
    patch = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pen = ImageDraw.Draw(patch)
    for x in range(-h, w + h, step):
        pen.line([(x, h), (x + h, 0)], fill=color, width=width)
    layer.alpha_composite(patch, (x0, y0))


def build_overlay(size, labels=True):
    w, h = size
    z = zones(w, h)
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    scale = max(1, w // 1920)
    f = font(15 * scale) if labels else None

    # 顶部标题/搜索区
    draw.rectangle(z["title"], outline=TITLE + (200,), width=2 * scale)
    hatch(layer, z["title"], TITLE + (26,), step=18 * scale, width=1)
    # 底部字幕/进度条区
    draw.rectangle(z["subtitle"], outline=SUB + (220,), width=2 * scale)
    hatch(layer, z["subtitle"], SUB + (30,), step=18 * scale, width=1)
    # 右侧动作条
    draw.rectangle(z["right"], outline=RIGHT + (220,), width=2 * scale)
    hatch(layer, z["right"], RIGHT + (26,), step=18 * scale, width=1)
    # 4:3 安全框
    draw.rectangle(z["center43"], outline=SAFE + (180,), width=1 * scale)
    # 竖屏裁切示意
    draw.rectangle(z["vertical"], outline=(198, 160, 255, 150), width=1 * scale)

    if labels:
        def tag(box, text, color, anchor="tl"):
            x0, y0, x1, y1 = box
            if anchor == "bl":
                draw.text((x0 + 8 * scale, y1 - 24 * scale), text, font=f, fill=color + (255,))
            elif anchor == "tr":
                draw.text((x1 - 8 * scale - f.getbbox(text)[2], y0 + 8 * scale), text, font=f, fill=color + (255,))
            else:
                draw.text((x0 + 8 * scale, y0 + 8 * scale), text, font=f, fill=color + (255,))

        tag(z["title"], "顶部：标题/搜索，别放关键读数", TITLE)
        tag(z["subtitle"], "底部 92px：字幕与 HUD 都别压线", SUB, anchor="bl")
        tag(z["right"], "右侧 120px", RIGHT, anchor="tr")
        tag(z["center43"], "4:3 安全框（老设备/裁切）", SAFE)
    return layer


def apply_to(image_path, out_path, labels=True, size=None):
    base = Image.open(image_path).convert("RGBA")
    if size:
        base = base.resize(size, Image.NEAREST)
    overlay = build_overlay(base.size, labels=labels)
    out = Image.alpha_composite(base, overlay)
    folder = os.path.dirname(os.path.abspath(out_path))
    if folder:
        os.makedirs(folder, exist_ok=True)
    out.convert("RGB").save(out_path)
    return out_path


def grab_frame(video_path, at_seconds):
    handle = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    handle.close()
    cmd = ["ffmpeg", "-y", "-v", "error", "-ss", str(at_seconds), "-i", video_path,
           "-frames:v", "1", handle.name]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not os.path.getsize(handle.name):
        os.unlink(handle.name)
        raise SystemExit(f"抽帧失败：{proc.stderr.decode('utf-8', 'replace').strip()[-200:]}")
    return handle.name


def main(argv=None):
    parser = argparse.ArgumentParser(description="平台安全区参考线")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--overlay", help="叠加到这张图")
    parser.add_argument("--video", help="从这段视频抽帧后叠加")
    parser.add_argument("--at", nargs="*", type=float, default=[1.0], help="抽帧时间点（秒）")
    parser.add_argument("-o", "--out", default="work/safe-area.png")
    parser.add_argument("--no-labels", action="store_true", help="不画文字标注")
    args = parser.parse_args(argv)

    labels = not args.no_labels

    if args.video:
        base, ext = os.path.splitext(args.out)
        os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
        for index, at in enumerate(args.at, 1):
            frame = grab_frame(args.video, at)
            out = f"{base}_{index}{ext or '.png'}"
            apply_to(frame, out, labels)
            os.unlink(frame)
            print(f"t={at}s -> {out}")
        return 0

    if args.overlay:
        print(f"overlay -> {apply_to(args.overlay, args.out, labels)}")
        return 0

    size = (args.width, args.height)
    canvas = Image.new("RGBA", size, (16, 20, 32, 255))
    out = Image.alpha_composite(canvas, build_overlay(size, labels))
    folder = os.path.dirname(os.path.abspath(args.out))
    if folder:
        os.makedirs(folder, exist_ok=True)
    out.convert("RGB").save(args.out)
    print(f"{args.width}x{args.height} safe-area -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
