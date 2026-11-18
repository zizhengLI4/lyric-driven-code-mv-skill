#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""检查 lyric-driven-code-mv 的最小可运行环境。

此脚本只使用 Python 标准库，不会安装依赖或修改用户环境。
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

MIN_NODE_RUNTIME = (17, 0, 0)
MIN_NODE_TEST_RUNNER = (18, 1, 0)
PILLOW_MINIMUM = (10, 0, 0)
GENERIC_FONTS = {"serif", "sans-serif", "monospace", "system-ui", "cursive", "fantasy"}
FONT_SUFFIXES = {".otf", ".ttf", ".ttc", ".otc"}

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass


def parse_version(value):
    """解析 v24.16.0、24.16.0 或带前缀的版本输出。"""
    match = re.search(r"(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:\b|$)", value)
    return tuple(int(part) for part in match.groups()) if match else None


def version_text(version):
    return ".".join(str(part) for part in version)


def run_command(command, arguments, timeout=8, cwd=None, output_limit=4000):
    """运行一个不经过 shell 的探测命令，并截断诊断文本。"""
    try:
        completed = subprocess.run(
            [str(command), *arguments],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            cwd=cwd,
            shell=False,
        )
    except FileNotFoundError:
        return {"started": False, "returncode": None, "stdout": "", "stderr": "找不到可执行文件"}
    except OSError as error:
        return {"started": False, "returncode": None, "stdout": "", "stderr": str(error)}
    except subprocess.TimeoutExpired:
        return {"started": False, "timed_out": True, "returncode": None, "stdout": "", "stderr": f"命令超过 {timeout} 秒未返回"}
    return {
        "started": True,
        "returncode": completed.returncode,
        "stdout": completed.stdout[-output_limit:],
        "stderr": completed.stderr[-output_limit:],
    }


def command_path(command):
    """返回尽可能明确的可执行路径，不要求命令已经存在。"""
    return shutil.which(str(command)) or str(command)


def selected_command(argument, environment_name, default):
    return argument or os.environ.get(environment_name) or default


def check_node(command):
    probe = run_command(command, ["--version"])
    if not probe["started"]:
        reason = "探测超时" if probe.get("timed_out") else "无法启动"
        return {
            "status": "fail",
            "path": command_path(command),
            "message": f"{reason} Node.js：{probe['stderr']}",
        }
    version = parse_version(probe["stdout"] + "\n" + probe["stderr"])
    if version is None:
        return {
            "status": "fail",
            "path": command_path(command),
            "message": "Node.js 没有返回可识别的三段式版本号。",
        }
    result = {
        "status": "pass" if version >= MIN_NODE_RUNTIME else "fail",
        "path": command_path(command),
        "version": version_text(version),
        "minimum": version_text(MIN_NODE_RUNTIME),
    }
    if result["status"] == "pass":
        result["message"] = f"Node.js {result['version']}，满足脚本最低版本 {result['minimum']}。"
    else:
        result["message"] = f"Node.js {result['version']} 低于脚本最低版本 {result['minimum']}。"
    return result


def check_node_test_runner(node_check):
    version = parse_version(node_check.get("version", ""))
    if version is None:
        return {"status": "skipped", "minimum": version_text(MIN_NODE_TEST_RUNNER), "message": "Node.js 不可用，无法检查内置测试运行器。"}
    status = "pass" if version >= MIN_NODE_TEST_RUNNER else "fail"
    return {
        "status": status,
        "minimum": version_text(MIN_NODE_TEST_RUNNER),
        "message": (
            f"Node.js {version_text(version)} 支持 node --test。"
            if status == "pass"
            else f"随包测试需要 Node.js >= {version_text(MIN_NODE_TEST_RUNNER)} 的 node --test。"
        ),
    }


def check_binary(label, command):
    probe = run_command(command, ["-version"])
    if not probe["started"]:
        reason = "探测超时" if probe.get("timed_out") else "无法启动"
        return {
            "status": "fail",
            "path": command_path(command),
            "message": f"{reason} {label}：{probe['stderr']}",
        }
    if probe["returncode"] != 0:
        return {
            "status": "fail",
            "path": command_path(command),
            "message": f"{label} 返回退出码 {probe['returncode']}。",
        }
    version = parse_version(probe["stdout"] + "\n" + probe["stderr"])
    return {
        "status": "pass",
        "path": command_path(command),
        "version": version_text(version) if version else None,
        "message": f"{label} 可执行" + (f"（{version_text(version)}）。" if version else "。"),
    }


def check_ass_filter(ffmpeg_command, ffmpeg_check):
    if ffmpeg_check["status"] != "pass":
        return {"status": "skipped", "message": "FFmpeg 不可用，无法检查 ass/libass 滤镜。"}
    probe = run_command(ffmpeg_command, ["-hide_banner", "-h", "filter=ass"])
    output = probe["stdout"] + "\n" + probe["stderr"]
    ass_lines = [line.strip() for line in output.splitlines() if re.match(r"^Filter\s+ass\s*$", line.strip(), re.IGNORECASE)]
    if not probe["started"] or probe["returncode"] != 0:
        return {"status": "fail", "message": f"无法读取 FFmpeg 滤镜列表：{probe['stderr']}"}
    if not ass_lines:
        return {"status": "fail", "message": "FFmpeg 没有 ass 视频滤镜；导出时会出现 No such filter。"}
    line = ass_lines[0]
    if "libass library" not in output.casefold():
        return {"status": "fail", "message": "找到 ass 滤镜帮助，但输出没有确认 libass 支持。"}
    return {"status": "pass", "filter": "ass", "message": f"已发现 libass 的 ass 滤镜：{line}"}


def normalize_font_name(value):
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


def family_in_text(family, text):
    wanted = normalize_font_name(family)
    if not wanted:
        return False
    return wanted in normalize_font_name(text)


def windows_font_exists(family):
    try:
        import winreg
    except ImportError:
        return None
    roots = [
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows NT\CurrentVersion\Fonts"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"),
    ]
    saw_registry = False
    for root, key_path in roots:
        try:
            with winreg.OpenKey(root, key_path) as key:
                saw_registry = True
                count = winreg.QueryInfoKey(key)[1]
                for index in range(count):
                    name, _, _ = winreg.EnumValue(key, index)
                    if family_in_text(family, name):
                        return True
        except OSError:
            continue
    return False if saw_registry else None


def fontconfig_exists(family):
    fc_match = shutil.which("fc-match")
    if fc_match:
        probe = run_command(fc_match, [f"--format=%{{family}}", family])
        if probe["started"] and probe["returncode"] == 0:
            matched = probe["stdout"].strip()
            if family.casefold().strip() in GENERIC_FONTS:
                return (bool(matched), "fc-match default-family resolution")
            return (family_in_text(family, matched), "fc-match")
    fc_list = shutil.which("fc-list")
    if fc_list:
        probe = run_command(fc_list, [":", "family"], output_limit=1000000)
        if probe["started"] and probe["returncode"] == 0:
            return (any(family_in_text(family, line) for line in probe["stdout"].splitlines()), "fc-list")
    return (None, None)


def looks_like_font_path(value):
    path = Path(value).expanduser()
    return path.is_absolute() or any(separator in value for separator in ("/", "\\")) or path.suffix.casefold() in FONT_SUFFIXES


def check_font(font):
    requested = str(font)
    normalized = requested.casefold().strip()
    if normalized in GENERIC_FONTS:
        exists, source = fontconfig_exists(requested)
        if exists is True:
            return {"status": "pass", "requested": requested, "source": source, "message": f"通用字体族 {requested} 已解析到系统字体。"}
        return {
            "status": "unknown",
            "requested": requested,
            "message": f"{requested} 是通用字体族，当前无法确认其最终解析的字体；请用 --font 指定已安装字体族。",
        }
    if looks_like_font_path(requested):
        path = Path(requested).expanduser()
        if path.suffix.casefold() not in FONT_SUFFIXES:
            return {"status": "fail", "requested": requested, "message": f"不支持的字体文件类型：{path.suffix or '无扩展名'}"}
        if path.is_file():
            return {"status": "pass", "requested": requested, "path": str(path), "message": f"字体文件存在：{path}"}
        return {"status": "fail", "requested": requested, "message": f"找不到字体文件：{path}"}

    if os.name == "nt":
        windows_result = windows_font_exists(requested)
        if windows_result is True:
            return {"status": "pass", "requested": requested, "source": "Windows 字体注册表", "message": f"已找到字体族：{requested}"}
        if windows_result is False:
            return {"status": "fail", "requested": requested, "source": "Windows 字体注册表", "message": f"Windows 字体注册表中没有字体族：{requested}"}

    config_result, source = fontconfig_exists(requested)
    if config_result is True:
        return {"status": "pass", "requested": requested, "source": source, "message": f"已找到字体族：{requested}"}
    if config_result is False:
        return {"status": "fail", "requested": requested, "source": source, "message": f"字体配置中没有字体族：{requested}"}
    return {
        "status": "unknown",
        "requested": requested,
        "message": "无法验证字体族；请传入实际字体文件路径，或安装 fontconfig 后重试。",
    }


def check_pillow():
    try:
        import PIL
    except ImportError:
        return {
            "status": "fail",
            "minimum": version_text(PILLOW_MINIMUM),
            "message": "当前 Python 没有安装 Pillow；依赖清单为 requirements.txt。",
        }
    version = parse_version(getattr(PIL, "__version__", ""))
    if version is None:
        return {"status": "unknown", "minimum": version_text(PILLOW_MINIMUM), "message": "Pillow 已导入，但版本号无法识别。"}
    result = {
        "status": "pass" if version >= PILLOW_MINIMUM else "fail",
        "version": version_text(version),
        "minimum": version_text(PILLOW_MINIMUM),
    }
    result["message"] = (
        f"Pillow {result['version']}，满足最低版本 {result['minimum']}。"
        if result["status"] == "pass"
        else f"Pillow {result['version']} 低于最低版本 {result['minimum']}。"
    )
    return result


def capability(checks, required):
    return "available" if all(checks[name]["status"] == "pass" for name in required) else "blocked"


def build_report(args):
    node = args.node or "node"
    ffmpeg = selected_command(args.ffmpeg, "FFMPEG_PATH", "ffmpeg")
    ffprobe = selected_command(args.ffprobe, "FFPROBE_PATH", "ffprobe")
    font = args.font or ("Microsoft YaHei" if os.name == "nt" else "sans-serif")

    checks = {
        "node": check_node(node),
        "node_test_runner": None,
        "ffmpeg": check_binary("FFmpeg", ffmpeg),
        "ffprobe": check_binary("FFprobe", ffprobe),
        "ffmpeg_ass": None,
        "font": check_font(font),
        "pillow": check_pillow(),
    }
    checks["node_test_runner"] = check_node_test_runner(checks["node"])
    checks["ffmpeg_ass"] = check_ass_filter(ffmpeg, checks["ffmpeg"])

    if checks["node"]["status"] != "pass":
        status = "needs_setup"
    elif all(check["status"] == "pass" for check in checks.values()):
        status = "ready"
    else:
        status = "partial"

    capabilities = {
        "storyboard_validation": capability(checks, ["node"]),
        "bundled_tests": capability(checks, ["node", "node_test_runner"]),
        "audio_analysis": capability(checks, ["node", "ffmpeg"]),
        "subtitle_export": capability(checks, ["node", "ffmpeg", "ffmpeg_ass", "ffprobe", "font"]),
        "export_verification": capability(checks, ["node", "ffprobe"]),
        "python_image_tools": capability(checks, ["pillow"]),
    }
    next_steps = []
    if checks["node"]["status"] != "pass":
        next_steps.append("安装或切换到 Node.js >= 17.0.0，然后重新运行预检。")
    if checks["node_test_runner"]["status"] == "fail":
        next_steps.append("运行随包测试需要 Node.js >= 18.1.0；当前仍可继续使用支持的 Node 核心脚本。")
    if checks["ffmpeg"]["status"] != "pass":
        next_steps.append("安装 FFmpeg，或用 --ffmpeg / FFMPEG_PATH 指向真实可执行文件。")
    if checks["ffmpeg_ass"]["status"] == "fail":
        next_steps.append("使用带 libass 的 FFmpeg；无 ass 滤镜时不能导出带字幕的成片。")
    if checks["ffprobe"]["status"] != "pass":
        next_steps.append("安装 FFprobe，或用 --ffprobe / FFPROBE_PATH 指向真实可执行文件。")
    if checks["font"]["status"] != "pass":
        next_steps.append("安装目标字体，或用 --font 传入已存在的字体族名称/字体文件路径。")
    if checks["pillow"]["status"] != "pass":
        next_steps.append("需要 Python 图像工具时，在 skill 根目录运行 python -m pip install -r requirements.txt。")
    if status == "partial":
        next_steps.insert(0, "仍可继续：分镜结构校验和不依赖缺失环境的 Node 工具。")

    return {
        "status": status,
        "node_minimum": version_text(MIN_NODE_RUNTIME),
        "node_test_minimum": version_text(MIN_NODE_TEST_RUNNER),
        "font_requested": font,
        "checks": checks,
        "capabilities": capabilities,
        "next_steps": next_steps,
    }


def print_human(report):
    labels = {
        "node": "Node.js",
        "node_test_runner": "Node.js node --test",
        "ffmpeg": "FFmpeg",
        "ffmpeg_ass": "FFmpeg ass/libass",
        "ffprobe": "FFprobe",
        "font": "字体",
        "pillow": "Pillow",
    }
    status_label = {"pass": "通过", "fail": "失败", "unknown": "未知", "skipped": "跳过"}
    print(f"环境状态: {report['status']}")
    for name, check in report["checks"].items():
        print(f"- {labels[name]}: {status_label[check['status']]} — {check['message']}")
    print("可用能力:")
    for name, state in report["capabilities"].items():
        print(f"- {name}: {state}")
    if report["next_steps"]:
        print("下一步:")
        for step in report["next_steps"]:
            print(f"- {step}")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="检查 Node、FFmpeg/FFprobe、libass、字体和 Pillow。只诊断，不安装依赖。")
    parser.add_argument("--json", action="store_true", help="只输出机器可读 JSON")
    parser.add_argument("--node", help="Node.js 可执行文件；默认从 PATH 查找")
    parser.add_argument("--ffmpeg", help="FFmpeg 可执行文件；默认使用 FFMPEG_PATH 或 PATH")
    parser.add_argument("--ffprobe", help="FFprobe 可执行文件；默认使用 FFPROBE_PATH 或 PATH")
    parser.add_argument("--font", help="字体族名称或 .ttf/.ttc/.otf/.otc 文件路径；默认按平台选择")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    report = build_report(args)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_human(report)
    return 1 if report["status"] == "needs_setup" else 0


if __name__ == "__main__":
    raise SystemExit(main())
