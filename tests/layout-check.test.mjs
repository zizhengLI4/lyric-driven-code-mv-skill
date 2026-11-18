import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT = fileURLToPath(new URL('../skills/lyric-driven-code-mv/scripts/layout-check.py', import.meta.url));

// 找一个能跑的 Python 3；没有就跳过（不让整仓测试因为环境缺 Python 变红）。
function findPython() {
  const candidates = [process.env.PYTHON, 'python', 'python3', 'py'].filter(Boolean);
  for (const command of candidates) {
    const probe = spawnSync(command, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8', windowsHide: true });
    if (probe.status === 0 && probe.stdout.trim() === '3') return command;
  }
  return null;
}

const PYTHON = findPython();
const opts = PYTHON ? {} : { skip: '环境里没有可用的 Python 3 解释器' };

// 最小分镜：脚本只需要 project.width/height，别的字段一律不要求。
const STORYBOARD = { project: { width: 1920, height: 1080 } };

function fixture(t, storyboard = STORYBOARD) {
  const prefix = join(tmpdir(), 'layout-check-');
  const dir = mkdtempSync(prefix);
  t.after(() => {
    assert.ok(dir.startsWith(prefix), '只删除本测试创建的临时目录');
    rmSync(dir, { recursive: true, force: true });
  });
  const storyboardPath = join(dir, 'storyboard.json');
  writeFileSync(storyboardPath, typeof storyboard === 'string' ? storyboard : JSON.stringify(storyboard));
  return {
    dir,
    storyboardPath,
    run: (...args) => spawnSync(PYTHON, [SCRIPT, storyboardPath, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    }),
  };
}

const parseReport = child => JSON.parse(child.stdout);

test('矩形互不冲突时退出码 0 并输出「无问题」', opts, t => {
  const { run } = fixture(t);
  const child = run(
    '--hud', '档案:56,44,596,200',
    '--hud', '神选度:1256,44,1794,200',
    '--log', '56,700,640,880',
    '--subtitle-band', '360,902,1560,988',
  );
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /无问题/);
  assert.doesNotMatch(child.stdout, /发现 \d+ 个问题/);
});

test('第 3、4 个数按绝对坐标 x1,y1 解析（spec 的 --log 是 584x180 的框）', opts, t => {
  const { run } = fixture(t);
  const child = run('--log', '56,700,640,880', '--json');
  assert.equal(child.status, 0, child.stdout);
  const report = parseReport(child);
  assert.deepEqual(report.rects[0], {
    x: 56, y: 700, x1: 640, y1: 880, w: 584, h: 180, name: '日志1', role: 'log', exempt: false,
  });
  assert.deepEqual(report.summary, { errors: 0, warnings: 0 });
});

test('HUD 之间重叠报错并点名两个矩形', opts, t => {
  const { run } = fixture(t);
  const child = run('--hud', '档案:56,44,596,200', '--hud', '神选度:500,100,700,300');
  assert.equal(child.status, 2, child.stdout);
  assert.match(child.stdout, /\[重叠\]/);
  assert.match(child.stdout, /档案/);
  assert.match(child.stdout, /神选度/);
  assert.match(child.stdout, /重叠 96x100px/);
  assert.match(child.stdout, /发现 1 个问题/);
});

test('HUD 与字幕带重叠报错', opts, t => {
  const { run } = fixture(t);
  const child = run('--hud', '底栏:56,900,640,980', '--subtitle-band', '360,930,1560,980');
  assert.equal(child.status, 2, child.stdout);
  assert.match(child.stdout, /\[重叠\]/);
  assert.match(child.stdout, /底栏 与 字幕带 重叠/);
});

test('日志矩形与字幕带重叠同样报错', opts, t => {
  const { run } = fixture(t);
  const child = run('--log', '对话框:56,900,640,980', '--subtitle-band', '360,930,1560,980');
  assert.equal(child.status, 2, child.stdout);
  assert.match(child.stdout, /\[重叠\]/);
  assert.match(child.stdout, /对话框 与 字幕带/);
});

test('矩形越出安全区右边界报错', opts, t => {
  const { run } = fixture(t);
  const child = run('--hud', '面板:1500,44,1900,200');
  assert.equal(child.status, 2, child.stdout);
  assert.match(child.stdout, /\[安全区\]/);
  assert.match(child.stdout, /越出右边界 104px/);
  assert.match(child.stdout, /x1 1900 > 1796/);
});

test('矩形越出安全区下边界报错', opts, t => {
  const { run } = fixture(t);
  const child = run('--log', '56,900,456,1100');
  assert.equal(child.status, 2, child.stdout);
  assert.match(child.stdout, /\[安全区\]/);
  assert.match(child.stdout, /越出下边界 112px/);
  assert.match(child.stdout, /y1 1100 > 988/);
});

test('矩形越出左/上边界也报错', opts, t => {
  const { run } = fixture(t);
  const child = run('--hud', '出界:-20,-30,180,170');
  assert.equal(child.status, 2, child.stdout);
  assert.match(child.stdout, /越出左边界 20px/);
  assert.match(child.stdout, /越出上边界 30px/);
});

test('刚好贴边、边界相接不算重叠，正好等于安全界也不算越界', opts, t => {
  const { run } = fixture(t);
  // A 右边 300 = B 左边；A 下边 300 = C 上边；
  // B/C 与字幕带都只相接不交叠；D 的 x1=1796 正好等于安全区右界。
  const child = run(
    '--hud', 'A:100,100,300,300',
    '--hud', 'B:300,100,500,300',
    '--hud', 'C:100,300,300,500',
    '--hud', 'D:1296,100,1796,200',
    '--subtitle-band', '300,300,1560,500',
  );
  assert.equal(child.status, 0, child.stdout);
  assert.match(child.stdout, /无问题/);
});

test('完全重合单独报「完全重合」，JSON 里 kind 是 coincide', opts, t => {
  const { run } = fixture(t);
  const child = run('--hud', '档案:100,100,300,300', '--hud', '档案副本:100,100,300,300', '--json');
  assert.equal(child.status, 2, child.stdout);
  const report = parseReport(child);
  const coincide = report.issues.filter(issue => issue.kind === 'coincide');
  assert.equal(coincide.length, 1);
  assert.equal(coincide[0].severity, 'error');
  assert.match(coincide[0].detail, /完全重合/);
  assert.deepEqual(coincide[0].bbox, { x: 100, y: 100, x1: 300, y1: 300, w: 200, h: 200 });
  // 普通重叠不能混进 coincide
  assert.ok(report.issues.every(issue => issue.kind !== 'overlap'));
});

test('畸形输入（x1<=x、y1<=y、非数字、NaN）报错并以 2 退出', opts, t => {
  const cases = [
    ['A:100,100,100,300', 'x1 等于 x'],
    ['A:100,100,300,100', 'y1 等于 y'],
    ['A:100,300,300,100', 'x1 小于 x'],
    ['A:56,44,abc,200', '非数字'],
    ['A:56,44,nan,200', 'NaN'],
    ['A:56,44,inf,200', 'Infinity'],
  ];
  for (const [spec, why] of cases) {
    const { run } = fixture(t);
    const child = run('--hud', spec);
    assert.equal(child.status, 2, `${spec}（${why}）应报畸形：${child.stdout}`);
    assert.match(child.stdout, /\[畸形\]/, spec);
    assert.match(child.stdout, /发现 1 个问题/, spec);
  }
});

test('缺坐标字段、名称后无坐标、重复字幕带都算畸形', opts, t => {
  for (const args of [['56,44,596'], ['A:56,44'], ['A:']]) {
    const { run } = fixture(t);
    const child = run('--hud', ...args);
    assert.equal(child.status, 2, `${args} 应报畸形：${child.stdout}`);
    assert.match(child.stdout, /\[畸形\]/, args);
  }
  const { run } = fixture(t);
  const child = run('--subtitle-band', '0,860,1920,988', '--subtitle-band', '0,700,1920,880');
  assert.equal(child.status, 2, child.stdout);
  assert.match(child.stdout, /最多一个/);
});

test('--scenes id:full-ui 豁免该镜 HUD，但字幕带安全区仍被检查', opts, t => {
  const { run } = fixture(t);
  const child = run(
    '--hud', '结算面板:0,0,1920,1080',
    '--subtitle-band', '360,930,1560,1020',
    '--scenes', 's09-ledger:full-ui',
    '--json',
  );
  assert.equal(child.status, 2, child.stdout);
  const report = parseReport(child);
  assert.equal(report.fullUi, true);
  const errors = report.issues.filter(issue => issue.severity === 'error');
  assert.ok(errors.length >= 1);
  assert.ok(errors.every(issue => issue.rects.includes('字幕带')), '错误必须只指向字幕带');
  assert.ok(errors.every(issue => issue.kind === 'safe-area'));
  assert.equal(errors[0].edge, 'bottom');
  // HUD 自己的越界降为豁免提示，但信息仍然保留
  assert.ok(report.issues.some(issue => issue.severity === 'warning' && issue.rects.includes('结算面板')));
  assert.ok(report.issues.every(issue => !(issue.severity === 'error' && issue.rects.includes('结算面板'))));
});

test('--scenes id:full-ui 时满屏 HUD 在没有其他越界时退出码 0', opts, t => {
  const { run } = fixture(t);
  const child = run(
    '--hud', '结算面板:0,0,1920,1080',
    '--subtitle-band', '360,860,1560,988',
    '--scenes', 's09-ledger:full-ui',
  );
  assert.equal(child.status, 0, child.stdout);
  assert.match(child.stdout, /无问题/);
  assert.match(child.stdout, /豁免/);
});

test('没有 full-ui 声明时满屏 HUD 会因越界报错', opts, t => {
  const { run } = fixture(t);
  const child = run('--hud', '结算面板:0,0,1920,1080');
  assert.equal(child.status, 2, child.stdout);
  assert.match(child.stdout, /\[安全区\] 结算面板 越出右边界 124px/);
});

test('--json 输出可被 JSON.parse 且字段齐全', opts, t => {
  const { run } = fixture(t);
  const child = run('--hud', '档案:56,44,596,200', '--hud', '神选度:500,100,644,300', '--json');
  assert.equal(child.status, 2, child.stdout);
  const report = parseReport(child);
  assert.equal(report.ok, false);
  assert.ok(Array.isArray(report.issues) && report.issues.length === 1);
  const issue = report.issues[0];
  assert.equal(issue.kind, 'overlap');
  assert.equal(issue.severity, 'error');
  assert.equal(typeof issue.detail, 'string');
  assert.deepEqual(issue.rects, ['档案', '神选度']);
  assert.deepEqual(issue.overlap, { x: 500, y: 100, w: 96, h: 100 });
  assert.ok(Array.isArray(report.rects) && report.rects.length === 2);
  assert.deepEqual(report.rects[0], {
    x: 56, y: 44, x1: 596, y1: 200, w: 540, h: 156, name: '档案', role: 'hud', exempt: false,
  });
  assert.deepEqual(report.canvas, { width: 1920, height: 1080 });
  assert.equal(report.safe.right, 124);
  assert.equal(report.safe.bottom, 92);
  assert.deepEqual(report.safe.inner, { x: 0, y: 0, x1: 1796, y1: 988, w: 1796, h: 988 });
  assert.deepEqual(report.scenes, []);
  assert.equal(report.fullUi, false);
  assert.deepEqual(report.summary, { errors: 1, warnings: 0 });
});

test('只有最小 JSON、甚至空对象也不崩，不读任何图片', opts, t => {
  const minimal = fixture(t, { project: { width: 1920, height: 1080 } });
  const child = minimal.run('--hud', '档案:56,44,596,200');
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stdout, /无问题/);

  const empty = fixture(t, {});
  const warned = empty.run('--hud', '档案:56,44,596,200');
  assert.equal(warned.status, 0, warned.stdout + warned.stderr);
  assert.match(warned.stdout, /无问题/);
  assert.match(warned.stdout, /按 1920 处理/);
});

test('--width/--height 覆盖分镜画布尺寸', opts, t => {
  const { run } = fixture(t);
  const right = run('--hud', '面板:56,44,956,244', '--width', '800', '--height', '600');
  assert.equal(right.status, 2, right.stdout);
  assert.match(right.stdout, /右边界/);
  assert.match(right.stdout, /800 - 安全边距 124/);

  const bottom = run('--hud', '面板:56,300,300,520', '--width', '800', '--height', '600');
  assert.equal(bottom.status, 2, bottom.stdout);
  assert.match(bottom.stdout, /下边界/);
  assert.match(bottom.stdout, /600 - 安全边距 92/);
});

test('分镜里的 safeArea 会被采用，--safe 可以覆盖单边', opts, t => {
  const storyboard = { project: { width: 1920, height: 1080, safeArea: { right: 124, bottom: 92 } } };
  const { run } = fixture(t, storyboard);
  const bad = run('--subtitle-band', '360,930,1560,1020');
  assert.equal(bad.status, 2, bad.stdout);
  assert.match(bad.stdout, /字幕带 越出下边界 32px/);

  const loose = run('--subtitle-band', '360,930,1560,1020', '--safe', 'bottom=60');
  assert.equal(loose.status, 0, loose.stdout);
});

test('--safe 只认 right/bottom，写错也报畸形', opts, t => {
  const { run } = fixture(t);
  const child = run('--safe', 'left=10');
  assert.equal(child.status, 2, child.stdout);
  assert.match(child.stdout, /\[畸形\]/);
  assert.match(child.stdout, /只认 right\/bottom/);
});

test('--out 把同一份报告写进文件', opts, t => {
  const { run, dir } = fixture(t);
  const out = join(dir, 'report.json');
  const child = run('--hud', '面板:1500,44,1900,200', '--json', '--out', out);
  assert.equal(child.status, 2, child.stdout);
  const written = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(written, parseReport(child));
  assert.equal(written.issues[0].kind, 'safe-area');
});

test('--scenes 写了分镜里不存在的镜只出提示，不影响退出码', opts, t => {
  const storyboard = {
    project: { width: 1920, height: 1080 },
    scenes: [{ id: 's01-open' }, { id: 's09-ledger' }],
  };
  const { run } = fixture(t, storyboard);
  const ok = run('--hud', '档案:56,44,596,200', '--scenes', 's09-ledger:full-ui');
  assert.equal(ok.status, 0, ok.stdout);
  assert.doesNotMatch(ok.stdout, /\[提示\]/);

  const typo = run('--hud', '档案:56,44,596,200', '--scenes', 's9-ledger:full-ui');
  assert.equal(typo.status, 0, typo.stdout);
  assert.match(typo.stdout, /\[提示\]/);
  assert.match(typo.stdout, /没有 id 为 s9-ledger 的镜/);
});

test('回归：spec 那条原始命令只报字幕带下越界，不报任何虚假越界', opts, t => {
  const { run } = fixture(t);
  const child = run(
    '--hud', '档案:56,44,596,200',
    '--hud', '神选度:1256,44,1794,200',
    '--log', '56,700,640,880',
    '--subtitle-band', '360,930,1560,1020',
    '--safe', 'right=124,bottom=92',
    '--scenes', 's09-ledger:full-ui',
    '--json',
  );
  // 字幕带 y1=1020，底边距只剩 1080-1020=60 < 92 —— 这正是那次真实事故。
  assert.equal(child.status, 2, child.stdout);
  const report = parseReport(child);
  assert.deepEqual(report.summary, { errors: 1, warnings: 0 });
  assert.equal(report.issues.length, 1);
  const issue = report.issues[0];
  assert.equal(issue.kind, 'safe-area');
  assert.equal(issue.severity, 'error');
  assert.equal(issue.edge, 'bottom');
  assert.equal(issue.overflow, 32);
  assert.deepEqual(issue.rects, ['字幕带']);
  assert.match(issue.detail, /字幕带 越出下边界 32px/);
  // 四个声明矩形都合法，不该冒出畸形，也不该有"超出画布"的措辞
  assert.equal(report.rects.length, 4);
  assert.equal(report.rects[1].w, 538);
  assert.equal(report.rects[2].h, 180);
  assert.ok(report.issues.every(item => item.kind !== 'malformed'));
  assert.doesNotMatch(child.stdout, /畸形|超出画布/);
});

test('不依赖 Pillow / numpy：源码不 import，运行后也不会加载', opts, t => {
  const source = readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(source, /^\s*import\s+PIL/m);
  assert.doesNotMatch(source, /^\s*from\s+PIL/m);
  assert.doesNotMatch(source, /^\s*import\s+numpy/m);
  assert.doesNotMatch(source, /^\s*from\s+numpy/m);
  assert.doesNotMatch(source, /PIL|numpy/);

  const code = [
    'import importlib.util, sys',
    "spec = importlib.util.spec_from_file_location('layout_check_probe', sys.argv[1])",
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    "print(int('PIL' in sys.modules), int('numpy' in sys.modules))",
  ].join('\n');
  const probe = spawnSync(PYTHON, ['-c', code, SCRIPT], { encoding: 'utf8', windowsHide: true });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout.trim(), '0 0');
});

test('中文报告在强制 GBK 的管道里也不炸', opts, t => {
  const { dir } = fixture(t);
  const child = spawnSync(PYTHON, [SCRIPT, join(dir, '不存在的分镜.json'), '--hud', '档案:56,44,596,200'], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'gbk' },
  });
  assert.equal(child.status, 2, child.stderr);
  assert.match(child.stdout, /\[畸形\]/);
  assert.match(child.stdout, /读不到分镜/);
  assert.equal(child.stderr, '');
});