#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkMediaTools } from '../assets/templates/starter/media-preflight.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('用法：node scripts/check-environment.mjs [--missing-only]\n只读检查 starter 依赖，输出 JSON。');
} else if (args.length > 1 || (args.length && args[0] !== '--missing-only')) {
  console.error('未知参数；请查看 --help。');
  process.exitCode = 2;
} else {
  const checks = [];
  const nodeOK = Number(process.versions.node.split('.')[0]) >= 18;
  checks.push({
    name: 'node', required: true, ok: nodeOK, detail: process.version,
    ...(nodeOK ? {} : { fix: '使用 Node.js 18 或更新版本。' }),
  });
  checks.push(...checkMediaTools(process.env.FFMPEG_PATH || 'ffmpeg', process.env.FFPROBE_PATH || 'ffprobe'));

  const run = (binary, argv) => spawnSync(binary, argv, { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  const pythonCommands = process.env.PYTHON
    ? [[process.env.PYTHON]]
    : process.platform === 'win32' ? [['python'], ['py', '-3']] : [['python3'], ['python']];
  const python = pythonCommands.find(([binary, ...flags]) => run(binary, [...flags, '--version']).status === 0);
  const pillow = python ? run(python[0], [...python.slice(1), '-c', 'import PIL; print(PIL.__version__)']) : null;
  const version = pillow?.status === 0 ? pillow.stdout.trim() : '';
  const pillowOK = Number(version.split('.')[0]) >= 10;
  checks.push({
    name: 'pillow', required: false, ok: pillowOK, detail: version || (python ? '未找到 Pillow' : '未找到 Python 3'),
    ...(pillowOK ? {} : { fix: '使用 Python 辅助工具时，按 Skill 目录内的 requirements.txt 配置 Pillow 10+。' }),
  });

  const fontDirs = process.platform === 'win32'
    ? [join(process.env.WINDIR || 'C:/Windows', 'Fonts'),
      ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Microsoft/Windows/Fonts')] : [])]
    : process.platform === 'darwin'
      ? ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', join(homedir(), 'Library/Fonts')]
      : [];
  const fontName = /msyh|simsun|simhei|deng|pingfang|heiti|songti|notosans(?:tc|sc|cjk)|notoserif(?:tc|sc|cjk)|sourcehan|wenquanyi/i;
  const systemFont = fontDirs.flatMap(dir => {
    try { return readdirSync(dir); } catch { return []; }
  }).find(file => fontName.test(file) && /\.(ttf|otf|ttc)$/i.test(file));
  const fontList = systemFont ? null : run('fc-list', [':lang=zh', 'family']);
  const font = systemFont || (fontList?.status === 0 && fontList.stdout.trim().split(/\r?\n/)[0]);
  checks.push({
    name: 'cjk-font', required: false, ok: Boolean(font), detail: font || '未探测到常见中文字体',
    ...(!font ? { fix: '用 --font 指定已有中文字体，并导出带字幕静帧检查实际字形。' } : {}),
  });

  const missing = checks.filter(check => !check.ok);
  const blocked = missing.some(check => check.required);
  const status = blocked ? 'needs_setup' : missing.length ? 'partial' : 'ready';
  console.log(JSON.stringify({ status, checks: args.length ? missing : checks }, null, 2));
  if (blocked) process.exitCode = 1;
}
