import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const skill = resolve(dirname(fileURLToPath(import.meta.url)), '../skills/lyric-driven-code-mv');

test('复制 starter 目录后仍可独立运行 export --help', () => {
  const temp = mkdtempSync(join(tmpdir(), 'lyric-starter-'));
  try {
    const starter = join(temp, 'starter');
    cpSync(join(skill, 'assets/templates/starter'), starter, { recursive: true });
    const result = spawnSync(process.execPath, [join(starter, 'export.mjs'), '--help'], { cwd: starter, encoding: 'utf8', windowsHide: true });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('音效证据校验支持任意事件数量而不硬编码45', async () => {
  const { verifySfxEvents } = await import('../skills/lyric-driven-code-mv/scripts/verify-sfx.mjs');
  const duration = 12, rate = 8000;
  const events = Array.from({ length: 9 }, (_, index) => ({ id: `e-${index + 1}`, at: 0.2 + index * 0.8 }));
  const samples = new Float32Array(duration * rate);
  for (const event of events) {
    const start = Math.round(event.at * rate);
    samples.fill(0.5, start, start + 400);
  }
  const report = verifySfxEvents({ events, samples, sampleRate: rate, duration, windowMs: 50 });
  assert.equal(report.total, 9);
  assert.equal(report.hits, 9);
});

test('最小渲染器从技能目录运行时拒绝默认写盘', () => {
  const temp = mkdtempSync(join(tmpdir(), 'lyric-render-'));
  try {
    const isolatedSkill = join(temp, 'lyric-driven-code-mv');
    cpSync(skill, isolatedSkill, { recursive: true });
    const storyboard = join(isolatedSkill, 'assets/storyboard-example.json');
    const renderer = join(isolatedSkill, 'scripts/minimal-renderer.py');
    const result = spawnSync(process.env.PYTHON || 'python', ['-X', 'utf8', renderer, storyboard, '--probe', '0'], {
      cwd: isolatedSkill, encoding: 'utf8', windowsHide: true,
    });
    assert.notEqual(result.status, 0, '技能目录不应接受默认 work/ 输出');
    assert.match(`${result.stdout}\n${result.stderr}`, /技能安装目录|--out|视频工程根目录/);
    assert.equal(existsSync(join(isolatedSkill, 'work')), false, '拒绝时不得在 Skill 目录创建 work/');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('技能声明本地渠道、依赖文件和角色差异度门槛', () => {
  const skillText = readFileSync(join(skill, 'SKILL.md'), 'utf8');
  const visualText = readFileSync(join(skill, 'references/pixel-game-visuals.md'), 'utf8');
  assert.match(skillText, /channel:\s*local/);
  assert.ok(existsSync(join(skill, 'requirements.txt')));
  assert.match(skillText, /卡拉OK|K歌|karaoke/i);
  assert.match(visualText, /角色差异度与完成度门槛/);
  assert.match(visualText, /纯黑剪影|剪影盲测/);
});
