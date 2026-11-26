import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repository = resolve('.');
const skill = join(repository, 'skills/lyric-driven-code-mv');
const read = path => readFileSync(path, 'utf8');

test('public entry points do not present the retired videos or paper-boat story as the default style', () => {
  const removedAssets = [
    'assets/demos/opening-hook-demo.mp4',
    'assets/demos/four-cue-scene-change-demo.mp4',
    'assets/demos/four-cue-scene-change-no-captions.mp4',
    'assets/demos/opening-hook-contact.png',
    'assets/demos/four-scene-contact.png',
    'assets/examples/visual-quality-demos.py',
  ];
  for (const relativePath of removedAssets) {
    assert.equal(existsSync(join(skill, relativePath)), false, `${relativePath} should be removed`);
  }

  const readme = read(join(repository, 'README.md'));
  const gettingStarted = read(join(repository, 'GETTING-STARTED.md'));
  const starterReadme = read(join(skill, 'assets/templates/starter/README.md'));
  const starterFrame = read(join(skill, 'assets/templates/starter/frame.mjs'));
  const starterPreview = read(join(skill, 'assets/templates/starter/preview.html'));
  const fallbackRenderer = read(join(skill, 'scripts/minimal-renderer.py'));
  const storyboardExample = read(join(skill, 'assets/storyboard-example.json'));
  const sfxExample = read(join(skill, 'assets/storyboard-sfx-demo.json'));
  const productionGuide = read(join(skill, 'references/storyboard-and-timing.md'));
  const visualGuide = read(join(skill, 'references/pixel-visuals.md'));
  const storyGuide = read(join(skill, 'references/research-and-story.md'));
  const timingGuide = read(join(skill, 'references/storyboard-and-timing.md'));
  const pixelFont = read(join(skill, 'scripts/pixel-font.py'));

  assert.doesNotMatch(readme, /assets\/demos\/|纸船与两岸灯光演示|夜晚、两岸、纸船/);
  assert.doesNotMatch(gettingStarted, /paper-boat-original-v1|送一盏小灯到对岸/);
  for (const content of [starterReadme, starterFrame, starterPreview]) {
    assert.doesNotMatch(content, /纸船|paper-boat|小灯到对岸/);
  }
  assert.match(starterReadme, /技术检查夹具/);
  assert.match(starterReadme, /风格参考/);
  assert.match(starterPreview, /不提供 MV 美术参考/);
  assert.doesNotMatch(fallbackRenderer, /纸船|paper-boat|冰障|远岸灯/);
  assert.doesNotMatch(storyboardExample, /纸船|paper-boat|隔岸寄送/);
  assert.doesNotMatch(sfxExample, /纸船|paper-boat|隔岸寄送/);
  assert.match(storyboardExample, /技术校验分镜/);
  assert.match(storyboardExample, /色块、时间标记、字幕/);
  assert.doesNotMatch(storyboardExample, /lyricsMeta/);
  assert.match(visualGuide, /文字制作案例/);
  assert.match(productionGuide, /普通朋友/);
  assert.doesNotMatch(storyGuide.split('## 参考片取证')[0], /纸船|另一岸|沿河横移|放船/);
  assert.doesNotMatch(timingGuide, /纸船|另一岸/);
  assert.doesNotMatch(pixelFont, /河面舞台|同一夜 · 两岸|SIGNAL 3|CHAPTER 02 \/ 12/);
});
