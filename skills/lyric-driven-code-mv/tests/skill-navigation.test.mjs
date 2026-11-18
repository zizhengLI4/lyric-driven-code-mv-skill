import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const skillDirectory = join(testDirectory, '..');
const referenceDirectory = join(skillDirectory, 'references');
const skillText = readFileSync(join(skillDirectory, 'SKILL.md'), 'utf8');

function readReference(name) {
  return readFileSync(join(referenceDirectory, name), 'utf8');
}

test('SKILL.md links directly to every reference document', () => {
  const references = readdirSync(referenceDirectory).filter(name => name.endsWith('.md'));
  const links = new Set([...skillText.matchAll(/\[[^\]]+\]\((references\/[^)#]+\.md)(?:#[^)]+)?\)/g)]
    .map(match => match[1]));

  for (const reference of references) {
    assert.ok(links.has(`references/${reference}`), `SKILL.md must link references/${reference}`);
  }
});

test('missing character or story direction triggers sourced research without overwriting supplied details', () => {
  assert.match(skillText, /人物或剧情至少有一项未指定/);
  assert.match(skillText, /联网搜索查歌曲背景/);
  const guide = readReference('song-research-and-story.md');
  assert.match(guide, /必须保留/);
  assert.match(guide, /事实/);
  assert.match(guide, /推断/);
  assert.match(guide, /创作/);
  assert.match(guide, /没有可靠来源|查不到可靠来源|检索无结果|联网能力不可用/);
  assert.match(guide, /搜索摘要只用于发现线索/);
  assert.match(guide, /只有来源明确建立了.*经历.*创作/);
  assert.match(guide, /目标.*行动.*反馈.*结果/);
  assert.match(guide, /scene\.id/);
  assert.match(guide, /分镜/);
});

test('sync reference compares the four timing tools and states their limits', () => {
  const guide = readReference('sync-review.md');
  for (const tool of ['hud-density.mjs', 'sync-audit.py', 'timeline-sync.py', 'visualize-sync.mjs']) {
    assert.ok(guide.includes(tool), `sync-review.md must cover ${tool}`);
  }
  for (const heading of ['输入', '输出', '不能证明']) {
    assert.ok(guide.includes(heading), `sync-review.md must state ${heading}`);
  }
});



test('reference pages do not link to one another', () => {
  const references = readdirSync(referenceDirectory).filter(name => name.endsWith('.md'));
  const crossLinks = [];

  for (const reference of references) {
    const filePath = join(referenceDirectory, reference);
    const contents = readFileSync(filePath, 'utf8');
    for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const href = match[1].split('#', 1)[0];
      if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;

      const target = resolve(dirname(filePath), decodeURIComponent(href));
      const fromReferences = relative(referenceDirectory, target);
      const staysInReferences = fromReferences !== ''
        && fromReferences !== '..'
        && !fromReferences.startsWith('..' + sep)
        && !isAbsolute(fromReferences);
      if (staysInReferences && extname(target).toLowerCase() === '.md' && target !== filePath) {
        crossLinks.push(reference + ' -> ' + fromReferences);
      }
    }
  }

  assert.deepEqual(crossLinks, [], 'reference links belong in the SKILL.md entry point: ' + crossLinks.join(', '));
});


test('SKILL.md is an entry point rather than a second CLI manual', () => {
  const lineCount = skillText.split(/\r?\n/).length;
  assert.ok(lineCount <= 90, `SKILL.md should stay under 90 lines; got ${lineCount}`);
  assert.match(skillText, /最小三步|三步/);
  assert.match(skillText, /失败|缺项|partial|needs_setup/);
  assert.doesNotMatch(skillText, /--window-ms|--warmup-frames|--sfx-script|1e-6|80 ?ms|30\/255|60%/);
  assert.ok((skillText.match(/^```/gm) || []).length <= 4, 'detailed command catalogs belong in references');
});

test('dependency reference owns platform setup commands and environment routing', () => {
  const guide = readReference('dependencies-and-delivery.md');
  assert.match(guide, /Windows PowerShell/);
  assert.match(guide, /macOS\s*\/\s*Linux/);
  assert.match(guide, /check_environment\.py/);
  assert.match(guide, /requirements\.txt/);
  assert.match(guide, /ready|partial|needs_setup/);
  assert.match(guide, /FFmpeg|FFprobe/);
});


test('skill trigger metadata names positive requests and near misses', () => {
  const frontmatter = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(frontmatter, 'SKILL.md must have frontmatter');
  const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1] ?? '';
  assert.match(description, /^Use when/);
  for (const trigger of ['给这首歌做个 MV', '歌词视频', '像素剧情 MV', '按歌词和鼓点检查副歌分镜']) {
    assert.match(description, new RegExp(trigger));
  }
  for (const symptom of ['画面像 PPT', '高潮弱', '人物动作异常', '模糊', '转场僵硬']) {
    assert.match(description, new RegExp(symptom));
  }
  assert.match(description, /频谱|音乐可视化/);
  assert.match(description, /普通口播|字幕剪辑/);
  assert.match(description, /给采访加逐字字幕|纯器乐做频谱动画/);
  assert.match(description, /不.*触发|不.*用于/);
});

test('OpenAI UI metadata routes the same default workflow', () => {
  const yaml = readFileSync(join(skillDirectory, 'agents', 'openai.yaml'), 'utf8');
  assert.match(yaml, /short_description:/);
  assert.match(yaml, /像素.*MV/);
  assert.match(yaml, /歌词|副歌|镜头|角色/);
  assert.match(yaml, /default_prompt:/);
  assert.match(yaml, /\$lyric-driven-code-mv/);
  assert.match(yaml, /联网|背景/);
  assert.match(yaml, /fact\/inference\/creative|只补缺失|保留/);
});

test('skill frontmatter uses the supported versioning surface', () => {
  const frontmatter = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
  assert.doesNotMatch(frontmatter, /^version:/m, 'top-level version is not accepted by the current skill validator');
  assert.doesNotMatch(frontmatter, /^metadata:\s*$/m, 'do not invent a release version without a release scheme');
});



test('protagonist appearance guidance requires a readable, story-linked design card', () => {
  const guide = readReference('character-design.md');
  for (const field of ['轮廓', '发型', '配色', '上装', '下装', '鞋', '配饰', '像素', '故事功能']) {
    assert.match(guide, new RegExp(field), `character-design.md must define ${field}`);
  }
  assert.match(guide, /用户.*外观|已指定.*外观/);
  assert.match(guide, /costumes|衣装/);
  assert.match(guide, /先生成主角外观卡/);
  assert.match(guide, /再从主角的欲望与外观构思阻碍/);
  assert.match(skillText, /主角.*外观|外观卡/);
  const protagonistFirst = skillText.indexOf('先生成主角外观卡');
  const supportingStory = skillText.indexOf('再构思阻碍、配角和世界规则');
  assert.ok(protagonistFirst >= 0 && supportingStory >= 0 && protagonistFirst < supportingStory,
    '主角外观必须先于阻碍、配角或世界规则的构思');
});

test('subtitle font guidance maps visual direction to installed primary and secondary families', () => {
  const guide = readReference('hud-and-subtitles.md');
  assert.match(guide, /字体.*风格|风格.*字体/);
  assert.match(guide, /captionStyle\.font/);
  assert.match(guide, /captionStyle\.secondaryFont/);
  assert.match(guide, /像素|游戏 UI/);
  assert.match(guide, /复古|年代/);
  assert.match(guide, /未来|科技|终端/);
  assert.match(guide, /中文.*字形|字形.*中文/);
  assert.match(guide, /已安装|本机已有/);
  assert.match(guide, /不.*下载|不.*安装/);
});

test('no-lyric chorus fixture advances the story instead of leaving a long empty window', async () => {
  const fixturePath = join(skillDirectory, 'assets', 'storyboard-no-lyric-chorus.json');
  const data = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const interlude = data.scenes.find(scene => scene.id === 'chorus-without-lyrics');
  assert.ok(interlude, 'fixture must include a named no-lyric chorus scene');
  assert.deepEqual(interlude.lyricIds ?? [], []);
  assert.ok(interlude.events?.length >= 3, 'the instrumental chorus needs visible story events');
  assert.ok(interlude.events.every(event => event.meaning || event.support), 'each event needs a causal explanation');
  const { analyzeDensity } = await import('../scripts/hud-density.mjs');
  const report = analyzeDensity(data, { maxGap: 4 });
  assert.deepEqual(report.sparseGaps, [], 'story events should keep the no-lyric chorus readable');
});


test('output protection guidance names overwrite, trusted modules, and preview exposure', () => {
  const guide = readFileSync(join(skillDirectory, 'assets', 'templates', 'starter', 'README.md'), 'utf8');
  assert.match(guide, /覆盖|overwrite/);
  assert.match(guide, /可信.*模块|当前进程权限|本地.*代码/);
  assert.match(guide, /127\.0\.0\.1|project\.json/);
  assert.match(guide, /ffmpeg|ffprobe/);
});


test('minimal core route distinguishes storyboard structure from real audio sync evidence', () => {
  assert.match(skillText, /核心三步|最小核心/);
  assert.match(skillText, /无真实音频|没有真实音频|illustrative/);
  assert.match(skillText, /不声称音画同步|不证明音画同步|不等于音画同步/);
  assert.match(skillText, /hud-density.*按需|可选.*hud-density|可读变化.*按需/);
  const tools = readReference('sync-review.md');
  assert.match(tools, /不证明.*核听|不能证明.*核听/);
});

test('README clearly labels repository, installed-skill, and project command roots', () => {
  const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
  assert.match(readme, /路径约定/);
  assert.match(readme, /仓库根目录/);
  assert.match(readme, /skill 根目录/);
  assert.match(readme, /工程目录|项目目录/);
});
