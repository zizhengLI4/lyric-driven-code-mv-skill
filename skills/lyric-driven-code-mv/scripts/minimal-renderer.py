#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""minimal-renderer.py —— 为分镜提供中性的布局与导出检查画面。

它绘制色块、网格和时间标记，用于检查版式、HUD、字幕和媒体编码。
这里没有项目场景或角色画法，不应作为 MV 样片或美术方向参考。

用法：
  python minimal-renderer.py storyboard.json --probe 0 120 240   # 抽 3 帧 PNG，秒级
  python minimal-renderer.py storyboard.json                     # 渲全片到 work/silent.mp4

只依赖 Pillow 和 ffmpeg（在 PATH 里）。

三条硬规则（为什么这样写，见 ../references/render-pitfalls.md）：
  1. 先画在虚拟分辨率上，最后一次 NEAREST 整数倍放大。任何非整数缩放都会糊。
  2. 每个像素只由成片秒 t 决定。不许读上一帧、不许累加。粒子用固定种子。
  3. 文字直接画在放大后的画面上。画在虚拟层再放大，34px 的字会变成 5x5 的砖块。
"""
import argparse
import json
import os
import shutil
import subprocess
from path_safety import assert_no_path_aliases
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ------------------------------------------------------------------ 技术检查色板
SKY_TOP = (28, 35, 48)
SKY_LOW = (48, 56, 72)
SNOW = (226, 230, 236)
HUD_OK = (128, 232, 164)
HUD_BAD = (238, 116, 116)
TEXT = (236, 244, 255)

def clamp01(x):
    return 0.0 if x < 0 else (1.0 if x > 1 else x)


def smooth(p):
    p = clamp01(p)
    return p * p * (3 - 2 * p)


def ramp(t, a, b):
    """t 在 [a,b] 内从 0 平滑过渡到 1。这就是所有动画的唯一来源。"""
    return 1.0 if b <= a and t >= b else smooth((t - a) / (b - a))


def mix(c1, c2, p):
    p = clamp01(p)
    return tuple(int(round(c1[i] + (c2[i] - c1[i]) * p)) for i in range(3))


# ------------------------------------------------------------------ 字体
FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
]
_font_cache = {}


def font(size):
    if size in _font_cache:
        return _font_cache[size]
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            _font_cache[size] = ImageFont.truetype(path, size)
            return _font_cache[size]
    raise SystemExit("找不到中文字体，请在 FONT_CANDIDATES 里加一条本机字体路径。")


# ------------------------------------------------------------------ 技术检查画面
COLOR_BARS = [
    (226, 90, 72), (241, 173, 67), (230, 215, 102), (105, 176, 121),
    (82, 157, 194), (113, 122, 196), (172, 112, 174), (220, 219, 203),
]


# ------------------------------------------------------------------ 两个技术检查场景
def scene_palette_check(t, sc, sbc, W, H):
    """色卡和整数网格用于检查清晰度、色彩边界和文字版式。"""
    img = Image.new("RGB", (W, H), SKY_TOP)
    d = ImageDraw.Draw(img)
    for x in range(0, W, 8):
        d.line((x, 0, x, H), fill=SKY_LOW, width=1)
    for y in range(0, H, 8):
        d.line((0, y, W, y), fill=SKY_LOW, width=1)

    bar_width = max(4, W // (len(COLOR_BARS) + 4))
    gap = max(1, bar_width // 6)
    left = (W - (len(COLOR_BARS) * bar_width + (len(COLOR_BARS) - 1) * gap)) // 2
    top, bottom = int(H * 0.24), int(H * 0.62)
    for index, color in enumerate(COLOR_BARS):
        x = left + index * (bar_width + gap)
        d.rectangle((x, top, x + bar_width - 1, bottom), fill=color)

    marker_start, marker_end = int(W * 0.12), int(W * 0.88)
    progress = ramp(t, sc["start"], sc["end"])
    marker_x = int(marker_start + (marker_end - marker_start) * progress)
    marker_y = int(H * 0.79)
    marker_size = max(2, W // 96)
    d.rectangle((marker_start, marker_y, marker_end, marker_y), fill=SNOW)
    d.rectangle((marker_x - marker_size, marker_y - marker_size,
                 marker_x + marker_size, marker_y + marker_size), fill=HUD_OK)
    return img


def scene_time_check(t, sc, sbc, W, H):
    """第二色相与反向移动位置用于检查镜头边界和转场。"""
    img = scene_palette_check(t, sc, sbc, W, H)
    overlay = Image.new("RGB", (W, H), (26, 29, 43))
    img = Image.blend(img, overlay, 0.3)
    d = ImageDraw.Draw(img)
    marker_start, marker_end = int(W * 0.88), int(W * 0.12)
    progress = ramp(t, sc["start"], sc["end"])
    marker_x = int(marker_start + (marker_end - marker_start) * progress)
    marker_y = int(H * 0.79)
    marker_size = max(2, W // 96)
    d.rectangle((marker_x - marker_size, marker_y - marker_size,
                 marker_x + marker_size, marker_y + marker_size), fill=(145, 212, 240))
    return img


SCENES = {
    # 兼容现有示例 JSON 的 scene.id。画面仍是技术检查卡，不承载故事。
    "send": scene_palette_check,
    "receive": scene_time_check,
    "palette-check": scene_palette_check,
    "time-check": scene_time_check,
}
DEFAULT_SCENE = scene_palette_check


def scene_at(t, sbc):
    current = sbc["scenes"][0]
    for sc in sbc["scenes"]:
        if t >= sc["start"]:
            current = sc
    fn = SCENES.get(current["id"], DEFAULT_SCENE)
    if fn is None:
        raise SystemExit(f"还没给场景 {current['id']} 写画法，去 SCENES 里加一条。")
    return fn(t, current, sbc, sbc["_W"], sbc["_H"]), current


# ------------------------------------------------------------------ HUD 与字幕
def _numbers(value):
    """从 HUD 文本里抠出所有数字：'信号 3 → 1' -> [3, 1]。"""
    out, buf = [], ""
    for ch in str(value):
        if ch.isdigit() or (ch == "." and buf):
            buf += ch
        elif buf:
            out.append(float(buf))
            buf = ""
    if buf:
        out.append(float(buf))
    return out


def _hud_items(sc):
    items = sc.get("hud")
    if isinstance(items, dict):
        return [items]
    if isinstance(items, list):
        return [item for item in items if isinstance(item, dict)]
    return []


def hud_state(t, sc):
    """HUD 读数：本镜 scene.hud[] 给出基线，本镜已发生的 event.hud 覆盖它。

    scene.hud[] 是"这一镜的读数"（value/min/max），event.hud 是"这一刻变成了什么"。
    返回 (label, value, lo, hi)；两者都没有时全部为 None，不画。
    """
    items = _hud_items(sc)
    pick = None
    for item in items:
        if item.get("type") == "bar" and isinstance(item.get("value"), (int, float)):
            pick = item
            break
    if pick is None and items:
        pick = items[0]

    label = pick.get("label") if pick else None
    value = pick.get("value") if pick else None
    lo = pick.get("min") if pick else None
    hi = pick.get("max") if pick else None

    for ev in sc.get("events", []):
        if not isinstance(ev, dict) or ev.get("at", 0) > t:
            continue
        if ev.get("hud"):
            text = str(ev["hud"])
            nums = _numbers(text)
            if nums:
                value = nums[-1]
            if label is None:
                label = text
    if label is None and value is None:
        return None, None, None, None
    return label, value, lo, hi


def draw_hud(img, t, sc, W, H, scale):
    label, value, lo, hi = hud_state(t, sc)
    if label is None and value is None:
        return
    d = ImageDraw.Draw(img, "RGBA")
    x0, y0 = 16 * scale, max(16 * scale, int(H * 0.155))
    box_w = 150 * scale
    d.rectangle([x0 - 8 * scale, y0 - 8 * scale, x0 + box_w, y0 + 30 * scale],
                fill=(8, 12, 26, 130))

    numeric = isinstance(value, (int, float))
    bad = numeric and isinstance(lo, (int, float)) and value < lo
    col = HUD_BAD if bad else HUD_OK

    title = f"{label} {value:g}" if (label and numeric) else str(label or value or "")
    d.text((x0, y0 - 2 * scale), title, font=font(9 * scale), fill=TEXT)

    if numeric and isinstance(lo, (int, float)) and isinstance(hi, (int, float)) and hi > lo:
        p = clamp01((value - lo) / (hi - lo))
        bx0, by0 = x0, y0 + 13 * scale
        bw, bh = 120 * scale, 7 * scale
        d.rectangle([bx0, by0, bx0 + bw, by0 + bh], fill=(8, 12, 26, 200), outline=(90, 108, 140))
        filled = int(bw * p)
        if filled > 0:
            d.rectangle([bx0 + 1, by0 + 1, bx0 + filled, by0 + bh - 1], fill=col)
        d.text((x0 + bw + 6 * scale, by0 - 2 * scale), f"{value:g}", font=font(8 * scale), fill=col)


def draw_title_card(img, t, sbc, W, H, scale):
    """0–2.9 秒的标题牌：参考片的"封面帧"。device.name 或 project.title 有值才画。

    画在画面中部（不与左上 HUD 抢位置），居中，淡入淡出。
    """
    device = sbc.get("device") if isinstance(sbc.get("device"), dict) else {}
    name = device.get("name") or sbc.get("project", {}).get("title")
    if not name:
        return
    alpha = (0.15 + 0.85 * ramp(t, 0.0, 0.4)) * (1.0 - ramp(t, 2.4, 3.0))
    if alpha <= 0.02:
        return
    sub = device.get("purpose") or device.get("frame") or ""
    if len(sub) > 22:
        sub = sub[:21] + "…"
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    f1 = font(26 * scale)
    b1 = f1.getbbox(name)
    w1 = b1[2] - b1[0]
    f2 = font(12 * scale) if sub else None
    w2 = (f2.getbbox(sub)[2] - f2.getbbox(sub)[0]) if f2 else 0
    pad = 14 * scale
    block_w = max(w1, w2) + pad * 2
    block_h = 26 * scale + (20 * scale if f2 else 0) + pad * 2
    left = int((W - block_w) / 2)
    top = int(H * 0.30)
    d.rectangle([left, top, left + block_w, top + block_h], fill=(8, 12, 26, int(150 * alpha)))
    d.text((left + pad, top + pad), name, font=f1, fill=TEXT + (int(255 * alpha),))
    if f2:
        d.text((left + pad, top + pad + 30 * scale), sub, font=f2,
               fill=(178, 196, 226, int(230 * alpha)))
    if img.mode == "RGBA":
        img.alpha_composite(layer)
    else:
        img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0, 0))




def _blit_line(layer, s, f, center_x, baseline_y, alpha):
    """居中画一行带描边的字，按基线定位（anchor="ms"）。

    按基线而不是按 bbox 左上角，才能精确保证"最下面一行不压安全区"。
    """
    if not s:
        return
    d = ImageDraw.Draw(layer)
    for dx, dy in ((-2, 0), (2, 0), (0, -2), (0, 2), (-2, -2), (2, 2)):
        d.text((center_x + dx, baseline_y + dy), s, font=f, anchor="ms", fill=(8, 10, 20, int(220 * alpha)))
    d.text((center_x, baseline_y), s, font=f, anchor="ms", fill=TEXT + (int(255 * alpha),))


def draw_subtitles(img, t, sbc, W, H):
    """字幕画在放大后的画面上。

    layout：bar（默认单行）/ stacked（中文在上、译文在下）/ split（译文左、中文右）。
    """
    scale = W // sbc["project"]["virtualWidth"]
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # 底部 8.5% 是平台进度条/交互区，字幕基线必须留在它上面（用 safe-area.py 复核）
    safe_bottom = H - int(H * 0.085)
    drew = False
    for line in sbc["lyrics"]:
        if not (line["start"] <= t < line["end"]):
            continue
        alpha = min(clamp01((t - line["start"]) / 0.4), clamp01((line["end"] - t) / 0.4))
        if alpha <= 0.02:
            continue
        layout = line.get("layout", "stacked")
        f = font(13 * scale)
        pair = line.get("en") or line.get("translation")
        if pair and layout == "stacked":
            main_w = f.getbbox(line["text"])[2] - f.getbbox(line["text"])[0]
            sub_size = 9 * scale
            while sub_size > 6 * scale:
                fsub = font(sub_size)
                if (fsub.getbbox(pair)[2] - fsub.getbbox(pair)[0]) <= main_w:
                    break
                sub_size -= 1 * scale
            fsub = font(sub_size)
            base_sub = safe_bottom - 6 * scale
            base_main = base_sub - int(sub_size * 1.45) - 4 * scale
            _blit_line(layer, line["text"], f, W / 2, base_main, alpha)
            _blit_line(layer, pair, fsub, W / 2, base_sub, alpha * 0.9)
        elif pair and layout == "split":
            baseline = safe_bottom - 6 * scale
            _blit_line(layer, pair, font(10 * scale), W * 0.30, baseline, alpha * 0.9)
            _blit_line(layer, line["text"], f, W * 0.70, baseline, alpha)
        else:
            _blit_line(layer, line["text"], f, W / 2, safe_bottom - 6 * scale, alpha)
        drew = True
    if not drew:
        return
    if img.mode == "RGBA":
        img.alpha_composite(layer)
    else:
        img.paste(Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0, 0))


# ------------------------------------------------------------------ 出帧
def render_frame(index, sbc):
    p = sbc["project"]
    W, H = sbc["_W"], sbc["_H"]
    t = index / p["fps"]
    world, sc = scene_at(t, sbc)
    big = world.resize((p["width"], p["height"]), Image.NEAREST).convert("RGBA")
    draw_title_card(big, t, sbc, p["width"], p["height"], p["width"] // W)  # 0–2.9s 的封面帧
    draw_hud(big, t, sc, p["width"], p["height"], p["width"] // W)
    draw_subtitles(big, t, sbc, p["width"], p["height"])  # 注意：必须在 RGBA 图上原地合成
    return big.convert("RGB")


def load(path):
    sbc = json.load(open(path, encoding="utf-8"))
    p = sbc["project"]
    sbc["_W"] = p["virtualWidth"]
    sbc["_H"] = p["virtualHeight"]
    sbc["_SCALE"] = p["width"] // p["virtualWidth"]
    return sbc


def guard_output_path(path: Path) -> None:
    """Never create generated files inside the installed skill directory."""
    skill_root = Path(__file__).resolve().parent.parent
    destination = path.resolve()
    try:
        destination.relative_to(skill_root)
    except ValueError:
        return
    raise SystemExit(
        f"拒绝将生成文件写入技能安装目录：{destination}。请从视频工程根目录运行，"
        "并用 --out 指向工程内 work/ 下的输出路径。"
    )


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("storyboard", help="分镜 JSON 文件")
    parser.add_argument("--probe", nargs="+", type=int, metavar="FRAME", help="只输出指定帧序号的 PNG")
    parser.add_argument("--out", type=Path, help="视频输出路径；--probe 模式下为 PNG 输出目录")
    args = parser.parse_args(argv)
    if args.probe is not None:
        output_dir = args.out or Path("work/probe")
        outputs = [output_dir / f"frame_{index:05d}.png" for index in args.probe]
    else:
        outputs = [args.out or Path("work/silent.mp4")]
    try:
        assert_no_path_aliases(inputs=[args.storyboard], outputs=outputs)
    except ValueError as exc:
        raise SystemExit(str(exc))
    sbc = load(args.storyboard)
    p = sbc["project"]
    total = int(round(p["duration"] * p["fps"]))

    if args.probe is not None:
        if any(index < 0 or index >= total for index in args.probe):
            parser.error(f"--probe 帧序号必须位于 0–{total - 1}")
        directory = args.out or Path("work/probe")
        guard_output_path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        for index in args.probe:
            output = directory / f"frame_{index:05d}.png"
            render_frame(index, sbc).save(output)
            print(f"已保存 {output}")
        return

    out = args.out or Path("work/silent.mp4")
    guard_output_path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if not shutil.which("ffmpeg"):
        raise SystemExit("找不到 ffmpeg，请先安装并确认它在 PATH 上（本脚本靠它把裸帧编成 MP4）。")
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{p['width']}x{p['height']}", "-r", str(p["fps"]), "-i", "-",
           "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-pix_fmt", "yuv420p", out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for i in range(total):
            proc.stdin.write(render_frame(i, sbc).tobytes())
            if i % 60 == 0:
                print(f"  第 {i}/{total} 帧", flush=True)
        proc.stdin.close()
    except (BrokenPipeError, OSError) as exc:
        # 实测（Windows + Python 3.13）：编码器名错、输出目录不存在、输入缺失、
        # 参数非法、滤镜不存在这五种「ffmpeg 立刻退出」，往管道写抛的都是
        # BrokenPipeError([Errno 32])——它本身就是 OSError 的子类，所以这两个都接得住。
        # 真正的坑是「catch 了却不读 stderr」：只拿到一句没有上下文的 Broken pipe，
        # 看不出 ffmpeg 为什么退出，前面渲染的帧还全白费。
        try:
            proc.stdin.close()
        except OSError:
            pass
        code = proc.wait()
        detail = proc.stderr.read().decode("utf-8", "replace").strip()
        raise SystemExit(
            "写入 FFmpeg 管道失败（%s: %s）。FFmpeg 退出码 %s。\n%s\n"
            "常见原因是参数被拒、编码器缺失或输出路径不可写；已渲染的 %d 帧不保留，修好后重跑。"
            % (type(exc).__name__, exc, code, detail[-600:] or "(ffmpeg 没有输出报错)",
               total)
        )
    if proc.wait() != 0:
        detail = proc.stderr.read().decode("utf-8", "replace").strip()
        raise SystemExit("FFmpeg 异常退出（码 %s）：\n%s" % (proc.returncode, detail[-600:]))
    print(f"完成：{out}（{total} 帧）。下一步用 ffmpeg 把它和歌曲合成。")


if __name__ == "__main__":
    main(sys.argv[1:])
