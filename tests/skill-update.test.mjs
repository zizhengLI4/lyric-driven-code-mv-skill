import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
  const visualText = readFileSync(join(skill, 'references/pixel-visuals.md'), 'utf8');
  assert.match(skillText, /channel:\s*local/);
  assert.ok(existsSync(join(skill, 'requirements.txt')));
  assert.match(skillText, /卡拉OK|K\s*歌|karaoke/i);
  assert.match(skillText, /^metadata:\r?\n  version: "\d+\.\d+\.\d+"/m);
  assert.match(visualText, /角色差异度与完成度门槛/);
  assert.match(visualText, /纯黑剪影|剪影盲测/);
});

test('Skill 首页直达每份参考文档，装置说明覆盖包内所有 JSON 模板', () => {
  const skillText = readFileSync(join(skill, 'SKILL.md'), 'utf8');
  const referenceNames = readdirSync(join(skill, 'references')).filter(name => name.endsWith('.md')).sort();
  const linked = [...skillText.matchAll(/\]\(references\/([^#)]+\.md)(?:#[^)]+)?\)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(linked)].sort(), referenceNames);

  const guide = readFileSync(join(skill, 'references/devices.md'), 'utf8');
  const templates = readdirSync(join(skill, 'assets/devices')).filter(name => name.endsWith('.json'));
  for (const name of templates) assert.ok(guide.includes(`(../assets/devices/${name})`), name);
});

test('参考片记录区分平台自动摘要、实际视听证据与未知流程', () => {
  const analysisText = readFileSync(join(skill, 'references/research-and-story.md'), 'utf8').split('## 参考片取证')[1];
  const productionText = readFileSync(join(skill, 'references/production-cases.md'), 'utf8');
  assert.match(analysisText, /自动章节摘要/);
  assert.match(analysisText, /导航线索/);
  assert.match(analysisText, /静音|未试听/);
  assert.match(analysisText, /作者.*实际.*步骤|作者原话/);
  assert.match(productionText, /7706125819504053514/);
  assert.match(productionText, /平台自动摘要/);
  assert.match(productionText, /未试听/);
});

test('逐词字幕文档说明整句工具边界，并让 AI 素材记录按实际使用填写', () => {
  const skillText = readFileSync(join(skill, 'SKILL.md'), 'utf8');
  const productionText = readFileSync(join(skill, 'references/storyboard-and-timing.md'), 'utf8');
  assert.match(skillText, /LRC 转换仍以整句为单位/);
  assert.match(skillText, /可选 `lyrics\[\]\.words\[\]`/);
  assert.match(skillText, /均分只作为视觉填充/);
  assert.match(productionText, /按项目实际使用填写/);
});

test('制作说明匹配像素RPG目标风格并允许按范围跳过样片', () => {
  const skillText = readFileSync(join(skill, 'SKILL.md'), 'utf8');
  const productionText = readFileSync(join(skill, 'references/storyboard-and-timing.md'), 'utf8');
  const researchText = readFileSync(join(skill, 'references/research-and-story.md'), 'utf8');
  const analysisText = researchText.split('## 参考片取证')[1].split('## 代码绘制与提示词')[0];
  const reviewText = readFileSync(join(skill, 'references/review-and-acceptance.md'), 'utf8');
  const codeVisualText = researchText.split('## 代码绘制与提示词')[1];
  const pixelVisualText = readFileSync(join(skill, 'references/pixel-visuals.md'), 'utf8');
  const syncReviewText = reviewText.split('## 同步候选与可视化')[1];
  assert.match(skillText, /按需求选做动态试片/);
  assert.match(skillText, /风格未定.*可打开《四格相纸》/);
  assert.doesNotMatch(skillText, /four-frame-photo-frames\.png/);
  assert.match(skillText, /公开热评按需查看.*不得声称看过、引用或转述/s);
  assert.match(skillText, /分别记录用户对场景和人物的明确确认/);
  assert.match(productionText, /拆歌.*静帧.*样片.*扩成片/s);
  assert.match(productionText, /跳过样片.*静帧.*分镜/s);
  assert.match(analysisText, /普通朋友.*1:57/s);
  assert.match(analysisText, /7696553856028757283/);
  assert.match(analysisText, /7704949269866914043/);
  assert.match(analysisText, /7707950209745708937/);
  assert.match(analysisText, /00:08.*蓝色天空.*层叠山脉.*松树.*草地/s);
  assert.match(reviewText, /跳过动态样片.*静帧.*接触表/s);
  assert.match(codeVisualText, /动态动作或转场需要验证时.*短动态样片/);
  assert.match(pixelVisualText, /动作样片（如需）/);
  assert.match(syncReviewText, /如制作动态样片/);
  assert.match(reviewText, /动态验证时.*动态播放.*seek.*跳过动态验证时.*待验证/s);
  assert.match(productionText, /静帧、样片（如有）、数据/s);
});

test('参考片分析把普通朋友前段游戏演出作为完整目标并记录ASR限制', () => {
  const analysisText = readFileSync(join(skill, 'references/research-and-story.md'), 'utf8').split('## 参考片取证')[1];
  const productionText = readFileSync(join(skill, 'references/storyboard-and-timing.md'), 'utf8');
  const pixelVisualText = readFileSync(join(skill, 'references/pixel-visuals.md'), 'utf8');

  assert.match(analysisText, /00:00–01:06/);
  assert.match(analysisText, /605 张|605 帧/);
  assert.match(analysisText, /逐秒.*1 fps|1 fps.*逐秒/s);
  assert.match(analysisText, /ASR.*草稿|自动转录.*人工听辨|机器转录.*未经人工听辨/s);
  assert.match(analysisText, /未试听|人工听辨.*未完成/);
  assert.match(productionText, /00:00–01:06/);
  assert.match(productionText, /对话.*HUD|HUD.*对话/s);
  assert.match(productionText, /拆歌.*静帧.*样片.*扩成片/s);
  assert.match(analysisText, /烟火.*HUD.*电话亭|电话亭.*HUD.*烟火/s);
  assert.match(pixelVisualText, /HUD.*行动|行动.*HUD/);
  assert.match(pixelVisualText, /状态.*因果|因果.*状态/);
});
