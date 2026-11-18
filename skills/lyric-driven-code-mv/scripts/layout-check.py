#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""layout-check.py —— 用矩形声明做纯几何冲突检测，不读图片。

为什么要有这个：safe-area.py 只是把平台参考线画在图上给人看，它不知道**元素之间**
是否打架。真正翻车的是结算面板铺满画面（虚拟 y 34–198）压住字幕带（y 930–1020）、
两个 HUD 读数叠在一起、底栏掉进平台底边——这些要到抽帧才看得见，那时已经成片了。
把 HUD/日志/字幕带写成矩形，直接算相交与越界，一秒钟出结论。

用法：
  python layout-check.py storyboard.json \\
    --hud "档案:56,44,596,200" --hud "神选度:1256,44,1794,200" \\
    --log "56,700,640,880" --subtitle-band "360,930,1560,1020" \\
    --safe "right=124,bottom=92" --scenes "s09-ledger:full-ui"

  python layout-check.py storyboard.json --hud "结算面板:0,0,1920,1080" --json

矩形写法：x,y,x1,y1 —— 左上角与右下角，成片输出像素。

三类检查：
  1. 矩形之间重叠（HUD×HUD、HUD×日志、日志×日志），完全重合单独报；
  2. 任一矩形与字幕带重叠；
  3. 任一矩形越出安全区（左 ≥ 0、上 ≥ 0、右 ≤ width - safe.right、下 ≤ height - safe.bottom）。

规则：
  - 边界相接不算重叠：A.x2 == B.x1 合法，只有交集宽 > 0 且高 > 0 才报；
  - --scenes "id:full-ui" 表示这一镜 UI 允许铺满画面：涉及 HUD 的几何问题降为豁免提示，
    但字幕带自己的安全区检查照旧（字幕掉进平台底栏是真事故，不能豁免）；
  - 退出码：有 error 为 2，只有 warning 为 0。

依赖：只用标准库（argparse / json / math / sys / pathlib），不需要 Pillow。
"""
import argparse
import json
import math
import sys
from pathlib import Path

DEFAULT_CANVAS = (1920, 1080)
DEFAULT_SAFE = {"right": 124, "bottom": 92}  # 1080p 下 6.5% 与 8.5%，四舍五入
EPS = 1e-9

KIND_LABEL = {
    "overlap": "重叠",
    "coincide": "完全重合",
    "safe-area": "安全区",
    "malformed": "畸形",
    "config": "提示",
}


class SpecError(ValueError):
    """声明本身写错了（畸形输入），不是几何冲突。"""


# ---------------------------------------------------------------- 基础工具


def use_utf8_stdout():
    """Windows 控制台默认 GBK，中文报告会 UnicodeEncodeError；管道下也不吃亏。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError, ValueError):
            pass


def fmt(value):
    """整数去掉小数尾巴，其余保留最多三位。"""
    value = float(value)
    if abs(value - round(value)) < EPS:
        return str(int(round(value)))
    return f"{value:.3f}".rstrip("0").rstrip(".")


def clean(value):
    """写进 JSON 时把整数值还原成 int，便于程序消费。"""
    value = float(value)
    if abs(value - round(value)) < EPS:
        return int(round(value))
    return round(value, 3)


def box_of(rect):
    """对外统一的矩形快照：x,y,x1,y1 是声明值，w,h 是换算出来的。"""
    return {
        "x": clean(rect["x"]),
        "y": clean(rect["y"]),
        "x1": clean(rect["x1"]),
        "y1": clean(rect["y1"]),
        "w": clean(rect["w"]),
        "h": clean(rect["h"]),
    }


def to_number(token, what, source):
    text = token.strip()
    if not text:
        raise SpecError(f"{source} 里的 {what} 是空的")
    try:
        value = float(text)
    except ValueError:
        raise SpecError(f"{source} 里的 {what} 不是数字：{text}") from None
    if not math.isfinite(value):
        raise SpecError(f"{source} 里的 {what} 必须是有限数值：{text}")
    return value


def parse_coords(text, source):
    """把 "x,y,x1,y1"（左上角 + 右下角）解析成四个有限数，并要求 x1>x、y1>y。"""
    parts = [part for part in text.split(",")]
    if any(not part.strip() for part in parts):
        raise SpecError(f"{source} 的坐标里有空位：{text}")
    if len(parts) != 4:
        raise SpecError(f"{source} 需要 x,y,x1,y1 四个数，收到 {len(parts)} 个：{text}")
    x, y, x1, y1 = (
        to_number(parts[0], "x", source),
        to_number(parts[1], "y", source),
        to_number(parts[2], "x1", source),
        to_number(parts[3], "y1", source),
    )
    if x1 <= x or y1 <= y:
        raise SpecError(
            f"{source} 要求 x1 > x 且 y1 > y："
            f"x={fmt(x)} y={fmt(y)} x1={fmt(x1)} y1={fmt(y1)}"
        )
    return x, y, x1, y1


def split_name(text, option):
    """把 "名称:x,y,x1,y1" 拆成 (名称, 坐标串)；没有名称时名称为空。"""
    if ":" not in text:
        return "", text
    head, _, tail = text.rpartition(":")
    if len(tail.split(",")) != 4:
        raise SpecError(f"{option} 需要「名称:x,y,x1,y1」或「x,y,x1,y1」四个数：{text!r}")
    return head.strip(), tail


def parse_rect(spec, role, option, index):
    """解析 "名称:x,y,x1,y1"；没写名称时按角色自动命名。

    声明值是左上角与右下角；内部一律换算成 x/y/w/h 再做几何运算。
    """
    text = spec.strip()
    if not text:
        raise SpecError(f"{option} 收到空声明")
    name, coords = split_name(text, option)
    x, y, x1, y1 = parse_coords(coords, f"{option} {spec!r}")
    if not name:
        name = {"hud": f"HUD{index}", "log": f"日志{index}", "subtitle": "字幕带"}[role]
    return {"name": name, "role": role, "x": x, "y": y, "x1": x1, "y1": y1,
            "w": x1 - x, "h": y1 - y}


def parse_safe(spec):
    """解析 --safe "right=124,bottom=92"。"""
    result = {}
    for chunk in spec.split(","):
        if not chunk.strip():
            continue
        if "=" not in chunk:
            raise SpecError(f"--safe 的片段缺少 =：{chunk.strip()}")
        key, _, raw = chunk.partition("=")
        key = key.strip().lower()
        if key in ("right", "r"):
            result["right"] = to_number(raw, "right", "--safe")
        elif key in ("bottom", "b"):
            result["bottom"] = to_number(raw, "bottom", "--safe")
        else:
            raise SpecError(f"--safe 只认 right/bottom，收到 {key!r}")
        if result.get(key, 0) < 0:
            raise SpecError(f"--safe 的 {key} 不能是负数：{fmt(result[key])}")
    return result


def parse_scene(spec):
    """解析 --scenes "id:full-ui"。"""
    text = spec.strip()
    if ":" not in text:
        raise SpecError(f"--scenes 需要 id:模式（例如 s09-ledger:full-ui）：{text}")
    scene_id, _, mode = text.rpartition(":")
    scene_id = scene_id.strip()
    mode = mode.strip()
    if not scene_id:
        raise SpecError(f"--scenes 的镜 id 是空的：{text}")
    if mode not in ("full-ui",):
        raise SpecError(f"--scenes 只认 full-ui，收到 {mode!r}：{text}")
    return {"id": scene_id, "mode": mode}


# ---------------------------------------------------------------- 分镜读取


def load_storyboard(raw_path):
    """只取 project.width/height 与可选安全边距，别的一概不看。"""
    path = Path(raw_path)
    try:
        # utf-8-sig：Windows 编辑器存的 BOM 也照读，不因此报畸形
        text = path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise SpecError(f"读不到分镜：{path}（{exc.strerror or exc}）") from None
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SpecError(f"分镜不是合法 JSON：{path} 第 {exc.lineno} 行 {exc.msg}") from None
    if not isinstance(data, dict):
        raise SpecError(f"分镜顶层必须是对象：{path}")
    return data


def stored_margins(storyboard):
    """分镜里若有安全边距就沿用：project.safeArea / project.safe / 顶层同名字段。"""
    found = {}
    holders = [storyboard.get("project"), storyboard]
    for holder in holders:
        if not isinstance(holder, dict):
            continue
        for key in ("safeArea", "safe", "safeZone", "safezone"):
            block = holder.get(key)
            if not isinstance(block, dict):
                continue
            for edge in ("right", "bottom"):
                value = block.get(edge)
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    continue
                if math.isfinite(float(value)) and float(value) >= 0:
                    found.setdefault(edge, float(value))
    return found


def resolve_canvas(storyboard, width, height, issues):
    project = storyboard.get("project")
    project = project if isinstance(project, dict) else {}
    result = {}
    for key, override, fallback in (("width", width, DEFAULT_CANVAS[0]),
                                    ("height", height, DEFAULT_CANVAS[1])):
        if override is not None:
            if not math.isfinite(override) or override <= 0:
                raise SpecError(f"--{key} 必须是正数：{fmt(override)}")
            result[key] = float(override)
            continue
        raw = project.get(key)
        valid = (not isinstance(raw, bool)
                 and isinstance(raw, (int, float))
                 and math.isfinite(float(raw))
                 and float(raw) > 0)
        if valid:
            result[key] = float(raw)
        else:
            result[key] = float(fallback)
            issues.append(make_issue(
                "config", "warning",
                f"分镜缺有效的 project.{key}，按 {fallback} 处理（可用 --{key} 覆盖）",
            ))
    return result["width"], result["height"]


def resolve_safe(storyboard, cli_safe, issues):
    safe = dict(DEFAULT_SAFE)
    safe.update(stored_margins(storyboard))
    if cli_safe:
        safe.update(cli_safe)
    for key in ("right", "bottom"):
        if safe[key] < 0:
            raise SpecError(f"安全边距 {key} 不能是负数：{fmt(safe[key])}")
    return safe


# ---------------------------------------------------------------- 几何判定


def make_issue(kind, severity, detail, **extra):
    item = {"kind": kind, "severity": severity, "detail": detail}
    item.update(extra)
    return item


def same_rect(a, b):
    return (abs(a["x"] - b["x"]) < EPS and abs(a["y"] - b["y"]) < EPS
            and abs(a["w"] - b["w"]) < EPS and abs(a["h"] - b["h"]) < EPS)


def intersect(a, b):
    """返回交集 (x0, y0, x1, y1)；只相接（交集宽或高为 0）返回 None。"""
    x0, x1 = max(a["x"], b["x"]), min(a["x1"], b["x1"])
    y0, y1 = max(a["y"], b["y"]), min(a["y1"], b["y1"])
    if x1 - x0 > EPS and y1 - y0 > EPS:
        return x0, y0, x1, y1
    return None


def covers_other(a, b, box):
    """交集是否正好等于 b 的整块（用于"包住"提示）。"""
    x0, y0, x1, y1 = box
    return (abs(x0 - b["x"]) < EPS and abs(y0 - b["y"]) < EPS
            and abs(x1 - b["x1"]) < EPS and abs(y1 - b["y1"]) < EPS)


def describe_overlap(a, b, box):
    x0, y0, x1, y1 = box
    iw, ih = x1 - x0, y1 - y0
    detail = (f"{a['name']} 与 {b['name']} 重叠 {fmt(iw)}x{fmt(ih)}px"
              f"（交集 x {fmt(x0)}–{fmt(x1)} / y {fmt(y0)}–{fmt(y1)}）")
    if covers_other(a, b, box):
        detail += f"；{a['name']} 完全包住 {b['name']}"
    elif covers_other(b, a, box):
        detail += f"；{b['name']} 完全包住 {a['name']}"
    return detail


def safe_violations(rect, limit_x, limit_y, canvas, safe):
    """逐条给出越界描述：(edge, overflow, detail)。"""
    out = []
    x, y, x1, y1 = rect["x"], rect["y"], rect["x1"], rect["y1"]
    if x < -EPS:
        out.append(("left", -x, f"{rect['name']} 越出左边界 {fmt(-x)}px（x {fmt(x)} < 0）"))
    if y < -EPS:
        out.append(("top", -y, f"{rect['name']} 越出上边界 {fmt(-y)}px（y {fmt(y)} < 0）"))
    if x1 > limit_x + EPS:
        out.append(("right", x1 - limit_x,
                    f"{rect['name']} 越出右边界 {fmt(x1 - limit_x)}px"
                    f"（x1 {fmt(x1)} > {fmt(limit_x)} = 画布 {fmt(canvas[0])} - 安全边距 {fmt(safe['right'])}）"))
    if y1 > limit_y + EPS:
        out.append(("bottom", y1 - limit_y,
                    f"{rect['name']} 越出下边界 {fmt(y1 - limit_y)}px"
                    f"（y1 {fmt(y1)} > {fmt(limit_y)} = 画布 {fmt(canvas[1])} - 安全边距 {fmt(safe['bottom'])}）"))
    return out


def build_report(rects, canvas, safe, scenes):
    """产出 {ok, issues, rects, canvas, safe, scenes, fullUi, summary}。"""
    full_ui = any(scene["mode"] == "full-ui" for scene in scenes)
    limit_x = canvas[0] - safe["right"]
    limit_y = canvas[1] - safe["bottom"]
    issues = []

    # 1) 矩形之间：完全重合 / 重叠（含 HUD×日志）
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            a, b = rects[i], rects[j]
            if a["role"] == "subtitle" and b["role"] == "subtitle":
                continue
            exempt = full_ui and "hud" in (a["role"], b["role"])
            severity = "warning" if exempt else "error"
            if same_rect(a, b):
                issues.append(make_issue(
                    "coincide", severity,
                    f"{a['name']} 与 {b['name']} 完全重合"
                    f"（x {fmt(a['x'])}–{fmt(a['x1'])} / y {fmt(a['y'])}–{fmt(a['y1'])}）",
                    rects=[a["name"], b["name"]], bbox=box_of(a),
                ))
                continue
            box = intersect(a, b)
            if box:
                x0, y0, x1, y1 = box
                issues.append(make_issue(
                    "overlap", severity, describe_overlap(a, b, box),
                    rects=[a["name"], b["name"]],
                    overlap={"x": clean(x0), "y": clean(y0),
                             "w": clean(x1 - x0), "h": clean(y1 - y0)},
                ))

    # 2) 安全区：HUD 在 full-ui 镜可豁免；字幕带永不豁免
    for rect in rects:
        exempt = full_ui and rect["role"] == "hud"
        severity = "warning" if exempt else "error"
        for edge, overflow, detail in safe_violations(rect, limit_x, limit_y, canvas, safe):
            limit = {"left": 0.0, "top": 0.0, "right": limit_x, "bottom": limit_y}[edge]
            issues.append(make_issue(
                "safe-area", severity, detail,
                rects=[rect["name"]], role=rect["role"],
                edge=edge, overflow=clean(overflow), limit=clean(limit),
            ))

    errors = sum(1 for item in issues if item["severity"] == "error")
    warnings = len(issues) - errors
    return {
        "ok": errors == 0,
        "issues": issues,
        "rects": [
            dict(box_of(rect), name=rect["name"], role=rect["role"],
                 exempt=bool(full_ui and rect["role"] == "hud"))
            for rect in rects
        ],
        "canvas": {"width": clean(canvas[0]), "height": clean(canvas[1])},
        "safe": {
            "right": clean(safe["right"]),
            "bottom": clean(safe["bottom"]),
            "inner": {
                "x": 0, "y": 0,
                "x1": clean(limit_x), "y1": clean(limit_y),
                "w": clean(limit_x), "h": clean(limit_y),
            },
        },
        "scenes": [{"id": scene["id"], "mode": scene["mode"]} for scene in scenes],
        "fullUi": full_ui,
        "summary": {"errors": errors, "warnings": warnings},
    }


# ---------------------------------------------------------------- 输出


def render_text(report):
    lines = []
    for item in report["issues"]:
        label = KIND_LABEL.get(item["kind"], item["kind"])
        if item["severity"] == "warning" and item["kind"] != "config":
            label += "·豁免"  # 类别仍是原来的，只是不算错误
        lines.append(f"[{label}] {item['detail']}")
    errors = report["summary"]["errors"]
    warnings = report["summary"]["warnings"]
    if errors:
        tail = f"发现 {errors} 个问题"
        if warnings:
            tail += f"（另有 {warnings} 条豁免/提示）"
    else:
        tail = "无问题" + (f"（豁免/提示 {warnings} 条）" if warnings else "")
    lines.append(tail)
    return "\n".join(lines)


def render_json(report):
    return json.dumps(report, ensure_ascii=False, indent=2)


def main(argv=None):
    use_utf8_stdout()
    parser = argparse.ArgumentParser(
        description="按矩形声明检查 HUD/日志/字幕带的重叠与安全区越界（纯几何，不读图片）",
        epilog='示例：python layout-check.py storyboard.json --hud "档案:56,44,596,200" '
               '--subtitle-band "360,930,1560,1020" --scenes "s09-ledger:full-ui"',
    )
    parser.add_argument("storyboard", help="分镜 JSON（只用 project.width/height 与可选安全边距）")
    parser.add_argument("--hud", action="append", default=[], metavar='"名称:x,y,x1,y1"',
                        help="HUD 矩形（左上角 + 右下角，成片输出像素），可重复")
    parser.add_argument("--log", action="append", default=[], metavar="x,y,x1,y1",
                        help="日志/对话框矩形，可重复")
    parser.add_argument("--subtitle-band", action="append", default=[], metavar="x,y,x1,y1",
                        help="字幕带矩形，最多一个")
    parser.add_argument("--safe", default=None, metavar='"right=124,bottom=92"',
                        help="安全边距像素；默认读分镜，读不到用 right=124,bottom=92")
    parser.add_argument("--scenes", action="append", default=[], metavar="id:full-ui",
                        help="声明哪一镜是全屏 UI，可重复")
    parser.add_argument("--width", type=float, default=None, help="覆盖画布宽")
    parser.add_argument("--height", type=float, default=None, help="覆盖画布高")
    parser.add_argument("--json", action="store_true", help="输出 JSON 报告")
    parser.add_argument("--out", default=None, help="把报告写到文件")
    args = parser.parse_args(argv)

    issues = []
    rects = []
    scenes = []

    storyboard = {}
    try:
        storyboard = load_storyboard(args.storyboard)
    except SpecError as exc:
        issues.append(make_issue("malformed", "error", str(exc), source="storyboard"))

    try:
        canvas = resolve_canvas(storyboard, args.width, args.height, issues)
    except SpecError as exc:
        issues.append(make_issue("malformed", "error", str(exc), source="canvas"))
        canvas = (float(DEFAULT_CANVAS[0]), float(DEFAULT_CANVAS[1]))

    cli_safe = None
    if args.safe is not None:
        try:
            cli_safe = parse_safe(args.safe)
        except SpecError as exc:
            issues.append(make_issue("malformed", "error", str(exc), source="--safe"))
    try:
        safe = resolve_safe(storyboard, cli_safe, issues)
    except SpecError as exc:
        issues.append(make_issue("malformed", "error", str(exc), source="--safe"))
        safe = dict(DEFAULT_SAFE)

    if len(args.subtitle_band) > 1:
        issues.append(make_issue(
            "malformed", "error",
            f"--subtitle-band 最多一个，收到 {len(args.subtitle_band)} 个", source="--subtitle-band",
        ))

    for role, specs, option in (("hud", args.hud, "--hud"),
                                ("log", args.log, "--log"),
                                ("subtitle", args.subtitle_band[:1], "--subtitle-band")):
        for index, spec in enumerate(specs, 1):
            try:
                rects.append(parse_rect(spec, role, option, index))
            except SpecError as exc:
                issues.append(make_issue("malformed", "error", str(exc), source=option, rect=None))

    for spec in args.scenes:
        try:
            scenes.append(parse_scene(spec))
        except SpecError as exc:
            issues.append(make_issue("malformed", "error", str(exc), source="--scenes"))

    # 重名会让报告读不出是哪一个框，补序号
    seen = {}
    for rect in rects:
        count = seen.get(rect["name"], 0) + 1
        seen[rect["name"]] = count
        if count > 1:
            rect["name"] = f"{rect['name']}#{count}"

    if scenes and storyboard:
        known = storyboard.get("scenes")
        if isinstance(known, list) and known:
            ids = {item.get("id") for item in known if isinstance(item, dict)}
            for scene in scenes:
                if scene["id"] not in ids:
                    issues.append(make_issue(
                        "config", "warning",
                        f"分镜里没有 id 为 {scene['id']} 的镜：full-ui 已照声明生效，"
                        f"确认不是手滑（现有镜：{'、'.join(sorted(str(i) for i in ids)) or '无'}）",
                        source="--scenes",
                    ))

    report = build_report(rects, canvas, safe, scenes)
    report["issues"] = issues + report["issues"]
    errors = sum(1 for item in report["issues"] if item["severity"] == "error")
    report["ok"] = errors == 0
    report["summary"] = {"errors": errors, "warnings": len(report["issues"]) - errors}

    text = render_json(report) if args.json else render_text(report)
    print(text)

    if args.out:
        out_path = Path(args.out)
        try:
            if out_path.parent and str(out_path.parent) not in ("", "."):
                out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(text + "\n", encoding="utf-8")
        except OSError as exc:
            sys.stderr.write(f"写报告失败：{out_path}（{exc.strerror or exc}）\n")
            return 2

    return 0 if report["ok"] else 2


if __name__ == "__main__":
    sys.exit(main())