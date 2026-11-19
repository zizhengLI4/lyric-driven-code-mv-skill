#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""minimal-renderer.py —— 让分镜真正变成画面的最小渲染器。

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
import math
import os
import random
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ------------------------------------------------------------------ 调色板
SKY_TOP = (10, 16, 42)
SKY_LOW = (52, 74, 118)
WATER_D = (26, 42, 74)
WATER_L = (58, 88, 138)
ICE = (196, 226, 244)
SNOW = (226, 236, 250)
BOAT = (232, 224, 208)
P1_COAT = (86, 124, 196)
P2_COAT = (214, 116, 104)
LAMP = (255, 206, 118)
HUD_OK = (128, 232, 164)
HUD_BAD = (238, 116, 116)
TEXT = (236, 244, 255)

_rng = random.Random("paper-boat-01")  # 固定种子：同一条命令永远同一片星空
STARS = []
RIPPLES = []


def seed_assets(seed):
    """用分镜里的 project.seed 重新生成粒子初值，换 seed 就换一片星空。"""
    global STARS, RIPPLES
    rng = random.Random(seed)
    STARS = [(rng.random(), rng.random(), rng.random() * 6.28) for _ in range(90)]
    RIPPLES = [(rng.random(), rng.random(), rng.random() * 6.28) for _ in range(60)]


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


# ------------------------------------------------------------------ 画世界
def draw_sky(img, W, H, t):
    d = ImageDraw.Draw(img)
    horizon = int(H * 0.56)
    for y in range(horizon):
        d.line([(0, y), (W, y)], fill=mix(SKY_TOP, SKY_LOW, y / horizon))
    for (x, y, ph) in STARS:
        if y * horizon > horizon - 2:
            continue
        a = 0.5 + 0.5 * math.sin(t * 1.8 + ph)
        xi, yi = int(x * W), int(y * horizon)
        d.point((xi, yi), fill=mix((30, 42, 70), SNOW, a))


def draw_water(img, W, H, t):
    d = ImageDraw.Draw(img)
    horizon = int(H * 0.56)
    d.rectangle([0, horizon, W, H], fill=WATER_D)
    for (rx, ry, ph) in RIPPLES:
        y = horizon + 4 + int(ry * (H - horizon - 8))
        x0 = int((rx * W + math.sin(t * 1.6 + ph) * 6 + t * 6) % W)
        d.line([(x0, y), (x0 + 6, y)], fill=WATER_L)


def draw_boat(img, W, H, x, y, tilt=0.0):
    d = ImageDraw.Draw(img)
    x, y = int(x), int(y)
    d.polygon([(x - 6, y), (x + 6, y), (x + 4, y + 3), (x - 4, y + 3)], fill=BOAT)
    d.polygon([(x, y - 8), (x + 5, y - 1), (x - 1, y - 1)], fill=(246, 242, 232))
    if abs(tilt) > 0.01:
        d.line([(x - 2, y + 3), (x + 2, y + 3)], fill=(180, 200, 226))


def draw_actor(img, x, y, coat, facing=1, scale=1.0, arm=0.0):
    d = ImageDraw.Draw(img)
    x, y, s = int(round(x)), int(round(y)), scale
    d.ellipse([x - 5 * s, y - 1, x + 5 * s, y + 1], fill=(18, 28, 50))
    d.rectangle([x - 2.4 * s, y - 5 * s, x - 0.4 * s, y], fill=(30, 34, 50))
    d.rectangle([x + 0.4 * s, y - 5 * s, x + 2.4 * s, y], fill=(30, 34, 50))
    d.rectangle([x - 3 * s, y - 13 * s, x + 3 * s, y - 5 * s], fill=coat)
    d.ellipse([x - 2.2 * s, y - 18 * s, x + 2.2 * s, y - 13 * s], fill=(238, 198, 168))
    d.rectangle([x - 2.4 * s, y - 18.6 * s, x + 2.4 * s, y - 16.6 * s], fill=(46, 40, 58))
    if arm > 0.05:
        d.rectangle([x + 2.4 * s, y - 13 * s - 7 * s * arm, x + 4 * s, y - 8 * s], fill=coat)


def draw_ice_barrier(img, W, H, x):
    d = ImageDraw.Draw(img)
    horizon = int(H * 0.56)
    x = int(x)
    d.polygon([(x - 5, horizon + 2), (x + 6, horizon - 1), (x + 11, horizon + 8),
               (x + 9, H - 2), (x - 2, H)], fill=ICE)
    d.polygon([(x + 6, horizon - 1), (x + 11, horizon + 8), (x + 9, H - 2), (x + 4, H - 3)],
              fill=(152, 188, 218))
    d.polygon([(x - 5, horizon + 2), (x - 1, horizon - 6), (x + 3, horizon), (x + 6, horizon - 1)],
              fill=(238, 248, 255))
    d.line([(x + 1, horizon + 8), (x + 2, H - 6)], fill=(210, 232, 250))


# ------------------------------------------------------------------ 两个场景
def scene_near_bank(t, sc, sbc, W, H):
    """放纸船 → 漂向冰障 → 撞上 → 停住。"""
    img = Image.new("RGB", (W, H), SKY_TOP)
    draw_sky(img, W, H, t)
    draw_water(img, W, H, t)

    ice_x = W * 0.78
    draw_ice_barrier(img, W, H, ice_x)

    launch = sc["start"] + 1.0
    hit = sc["start"] + 3.5
    p = ramp(t, launch, hit - 0.4)
    boat_x = W * 0.22 + (ice_x - W * 0.22 - 8) * p
    bob = math.sin(t * 3.2) * 1.5
    draw_boat(img, W, H, boat_x, H * 0.78 + bob)
    if t >= hit:  # 撞上以后停住，并出现一圈涟漪：这就是"未抵达"的可见证据
        k = clamp01((t - hit) / 1.2)
        d = ImageDraw.Draw(img, "RGBA")
        r = 4 + 14 * k
        d.ellipse([boat_x - r, H * 0.78 - r * 0.4, boat_x + r, H * 0.78 + r * 0.4],
                  outline=(200, 220, 240, int(160 * (1 - k))), width=1)

    draw_actor(img, W * 0.14, H * 0.80, P1_COAT, facing=1, scale=1.6)
    return img


def scene_far_bank(t, sc, sbc, W, H):
    """远岸：另一个人走来、看见灯、灯亮起。"""
    img = Image.new("RGB", (W, H), SKY_TOP)
    draw_sky(img, W, H, t)
    draw_water(img, W, H, t)

    walk = ramp(t, sc["start"], sc["start"] + 1.6)
    px = W * 0.80 - W * 0.22 * walk
    draw_actor(img, px, H * 0.80, P2_COAT, facing=-1, scale=1.6, arm=walk)

    lit = ramp(t, sc["start"] + 3.5, sc["start"] + 4.2)
    if lit > 0.02:  # 远处那盏灯：用几层同心圆叠出光晕，不要用高斯模糊
        d = ImageDraw.Draw(img, "RGBA")
        cx, cy = W * 0.20, H * 0.66
        for i in range(6, 0, -1):
            r = 3 + i * 2.4 * lit
            d.ellipse([cx - r, cy - r, cx + r, cy + r],
                      fill=(LAMP[0], LAMP[1], LAMP[2], int(48 * lit * (1 - i / 7))))
        d.rectangle([cx - 1, cy - 1, cx + 1, cy + 1], fill=(255, 244, 216))
        draw_actor(img, W * 0.13, H * 0.80, P1_COAT, facing=1, scale=1.6, arm=1.0)

    if t >= sc["start"] + 3.8:  # 望远镜圆窗：圆外压暗、圆内保留，才读得出"在看"
        k = ramp(t, sc["start"] + 3.8, sc["start"] + 4.6)
        if k > 0.02:
            cx, cy, r = W * 0.26, H * 0.44, W * 0.16 * k
            box = [cx - r, cy - r, cx + r, cy + r]
            hole = Image.new("L", (W, H), 0)
            ImageDraw.Draw(hole).ellipse(box, fill=255)
            veil = Image.new("RGBA", (W, H), (6, 10, 22, 255))
            veil.putalpha(hole.point(lambda v: int(150 * k * (1 - v / 255))))
            canvas = img.convert("RGBA")
            canvas.alpha_composite(veil)
            ImageDraw.Draw(canvas, "RGBA").ellipse(box, outline=(226, 238, 252, 210), width=3)
            img = canvas.convert("RGB")
    return img


SCENES = {
    "send-and-stop": scene_near_bank,
    "other-bank-sees-light": scene_far_bank,
    # 示例分镜使用的一对 id，见 assets/storyboard-example.json
    "send": scene_near_bank,
    "receive": scene_far_bank,
}
DEFAULT_SCENE = scene_near_bank


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
    seed_assets(p.get("seed") or "default-seed")
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
