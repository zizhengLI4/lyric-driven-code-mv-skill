#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pixel-font.py —— 从系统字体生成点阵字模（图集 PNG + 点阵 JSON）。

参考片的标题牌上大量是"点阵数字 + 点阵拉丁字母"，中文仍是清晰字。
与其每次手抠，不如把常用字符烘成一张图集/一份点阵表，渲染时直接查表。

用法：
  python pixel-font.py                                   # 默认 6×8，输出 work/pixel-font.png 与 .json
  python pixel-font.py --cell 6x8 -o work/font68.png --json work/font68.json
  python pixel-font.py --sample work/title-sample.png     # 顺便渲一张标题牌示例

注意：只覆盖 ASCII 与少量符号。中文标题请用系统字体直接画（本脚本的 --sample 就是这么做的）。

依赖：Pillow。
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont
from path_safety import assert_no_path_aliases

FONT_CANDIDATES = [
    "C:/Windows/Fonts/consola.ttf",
    "C:/Windows/Fonts/msyh.ttc",
    "/System/Library/Fonts/Menlo.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
]
CJK_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]
DEFAULT_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:.,!?-+/xX%()[]<>*#"


def first_existing(paths, what):
    for path in paths:
        if os.path.exists(path):
            return path
    raise SystemExit(f"找不到可用的{what}字体，请在脚本顶部候选列表里加一条本机路径。")


def bake(ch, font_path, cell_w, cell_h, supersample=12, threshold=80):
    """渲染 -> 按字形紧贴裁切 -> 等比缩进格子 -> 阈值，得到 cell 大小的 0/1 点阵。

    早期版本直接缩整块画布，字被上下裁掉；现在先裁 bbox 再等比缩，字形完整。
    """
    handle = ImageFont.truetype(font_path, cell_h * supersample)
    bbox = handle.getbbox(ch)
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    if width <= 0 or height <= 0:
        return [[0] * cell_w for _ in range(cell_h)]
    glyph = Image.new("L", (width, height), 0)
    ImageDraw.Draw(glyph).text((-bbox[0], -bbox[1]), ch, font=handle, fill=255)
    scale = min(cell_w / width, (cell_h - 1) / height)
    small = glyph.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.BOX)
    canvas = Image.new("L", (cell_w, cell_h), 0)
    canvas.paste(small, ((cell_w - small.width) // 2, (cell_h - small.height) // 2))
    return [[1 if canvas.getpixel((i, j)) >= threshold else 0 for i in range(cell_w)] for j in range(cell_h)]


def build(charset, font_path, cell_w, cell_h):
    glyphs = {}
    for ch in charset:
        glyphs[ch] = bake(ch, font_path, cell_w, cell_h)
    return glyphs


def write_atlas(glyphs, cell_w, cell_h, out_path, pixel=6, gap=1, cols=None):
    """把点阵拼成一张图集，pixel 是每格放大倍数，方便肉眼检查。"""
    chars = list(glyphs)
    per_row = cols or max(1, min(len(chars), 18))
    rows = (len(chars) + per_row - 1) // per_row
    cw = cell_w * pixel + gap * 2
    chh = cell_h * pixel + gap * 2
    img = Image.new("RGBA", (per_row * cw, rows * chh), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for index, ch in enumerate(chars):
        gx = (index % per_row) * cw + gap
        gy = (index // per_row) * chh + gap
        for j, row in enumerate(glyphs[ch]):
            for i, bit in enumerate(row):
                if bit:
                    draw.rectangle(
                        [gx + i * pixel, gy + j * pixel, gx + i * pixel + pixel - 1, gy + j * pixel + pixel - 1],
                        fill=(236, 244, 255, 255),
                    )
    folder = os.path.dirname(os.path.abspath(out_path))
    if folder:
        os.makedirs(folder, exist_ok=True)
    img.save(out_path)
    return out_path


def draw_pixel_text(img, text, glyphs, x, y, scale, color=(236, 244, 255)):
    """按点阵查表画字，用于验证图集真的能用。"""
    draw = ImageDraw.Draw(img)
    cell_h = len(next(iter(glyphs.values())))
    cell_w = len(next(iter(glyphs.values()))[0])
    cursor = x
    for ch in text:
        glyph = glyphs.get(ch) or glyphs.get(ch.upper())
        if glyph is None:
            cursor += (cell_w + 1) * scale
            continue
        for j, row in enumerate(glyph):
            for i, bit in enumerate(row):
                if bit:
                    draw.rectangle(
                        [cursor + i * scale, y + j * scale,
                         cursor + i * scale + scale - 1, y + j * scale + scale - 1],
                        fill=color,
                    )
        cursor += (cell_w + 1) * scale
    return cursor


def sample(glyphs, out_path, cell_w, cell_h):
    """一张标题牌：中文用系统字体，编号与英文用刚烘的点阵。"""
    width, height = 1280, 360
    img = Image.new("RGB", (width, height), (14, 18, 32))
    draw = ImageDraw.Draw(img)
    cjk = ImageFont.truetype(first_existing(CJK_CANDIDATES, "中文"), 64)
    small = ImageFont.truetype(first_existing(CJK_CANDIDATES, "中文"), 22)
    draw.text((72, 96), "河面舞台", font=cjk, fill=(236, 244, 255))
    draw.text((72, 180), "同一夜 · 两岸", font=small, fill=(170, 190, 220))
    draw_pixel_text(img, "SIGNAL 3", glyphs, 72, 236, 3, (128, 232, 164))
    draw_pixel_text(img, "CHAPTER 02 / 12", glyphs, 72, 292, 2, (198, 160, 255))
    folder = os.path.dirname(os.path.abspath(out_path))
    if folder:
        os.makedirs(folder, exist_ok=True)
    img.save(out_path)
    return out_path


def main(argv=None):
    parser = argparse.ArgumentParser(description="生成点阵字模图集与点阵 JSON")
    parser.add_argument("--cell", default="6x8", help="字格尺寸，默认 6x8")
    parser.add_argument("--charset", default=DEFAULT_CHARSET, help="要烘的字符集")
    parser.add_argument("--font", help="指定字体文件路径")
    parser.add_argument("--pixel", type=int, default=6, help="图集放大倍数，默认 6")
    parser.add_argument("-o", "--out", default="work/pixel-font.png", help="输出图集 PNG")
    parser.add_argument("--json", dest="json_path", default="work/pixel-font.json", help="输出点阵 JSON")
    parser.add_argument("--sample", help="另存一张使用点阵的标题牌示例")
    parser.add_argument("--threshold", type=int, default=80, help="二值化阈值 0–255，默认 80")
    args = parser.parse_args(argv)

    try:
        cell_w, cell_h = (int(v) for v in args.cell.lower().split("x"))
    except ValueError:
        raise SystemExit("--cell 需要写成 5x7 这种形式")
    font_path = args.font or first_existing(FONT_CANDIDATES, "英文点阵")
    try:
        assert_no_path_aliases(
            inputs=[font_path],
            outputs=[args.out, args.json_path, args.sample],
        )
    except ValueError as exc:
        raise SystemExit(str(exc))

    glyphs = build(args.charset, font_path, cell_w, cell_h)
    write_atlas(glyphs, cell_w, cell_h, args.out, pixel=args.pixel)
    payload = {
        "cell": [cell_w, cell_h],
        "font": os.path.basename(font_path),
        "threshold": args.threshold,
        "note": "每行一个字符串，'1' 为实心像素。中文不在表内，请用系统字体绘制。",
        "glyphs": {ch: ["".join(str(b) for b in row) for row in grid] for ch, grid in glyphs.items()},
    }
    folder = os.path.dirname(os.path.abspath(args.json_path))
    if folder:
        os.makedirs(folder, exist_ok=True)
    with open(args.json_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1)

    print(f"glyphs {len(glyphs)} | cell {cell_w}x{cell_h} | atlas -> {args.out} | json -> {args.json_path}")
    if args.sample:
        sample(glyphs, args.sample, cell_w, cell_h)
        print(f"sample -> {args.sample}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
