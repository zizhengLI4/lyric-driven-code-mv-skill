import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const skill = resolve('skills/lyric-driven-code-mv');

test('visual ledger gives each lyric cue a concrete shot and a finishing plan', () => {
  const ledger = JSON.parse(readFileSync(resolve(skill, 'assets/examples/visual-ledger-demo.json'), 'utf8'));
  assert.ok(Array.isArray(ledger.scenes) && ledger.scenes.length >= 4);
  for (const scene of ledger.scenes) {
    assert.ok(scene.cues.length > 0 && scene.cues.length <= 4);
    assert.equal(scene.beats.length, scene.cues.length);
    for (const [index, beat] of scene.beats.entries()) {
      assert.equal(beat.cue, scene.cues[index]);
      for (const field of ['shot', 'object', 'action', 'result']) assert.ok(beat[field]?.trim());
      assert.ok(beat.finish?.material.trim());
      assert.ok(beat.finish?.lighting.trim());
      assert.ok(beat.finish?.secondaryMotion.trim());
      assert.ok(beat.finish?.details.length >= 2);
    }
    for (const field of ['setting', 'meaning', 'action', 'result']) assert.ok(scene[field]?.trim());
    assert.ok(Array.isArray(scene.objects) && scene.objects.length > 0);
    for (const object of scene.objects) {
      assert.ok(object.name.trim());
      assert.ok(object.means.trim());
      assert.ok(object.recognitionCues.length >= 2);
    }
  }
});

test('code-directed workflow guidance specifies observable prompts and deterministic frames', () => {
  const guide = readFileSync(resolve(skill, 'references/research-and-story.md'), 'utf8').split('## 代码绘制与提示词')[1];
  for (const tag of ['<role>', '<context>', '<task>', '<specs>', '<style>', '<check>']) assert.ok(guide.includes(tag));
  assert.match(guide, /每一条 cue/);
  assert.match(guide, /同一成片时刻 `t` 求值/);
  assert.match(guide, /music-mv/);
  assert.match(guide, /code-video/);
  assert.match(guide, /Puppeteer/);
  assert.match(guide, /Playwright/);
  assert.match(guide, /FFmpeg/);
  assert.match(guide, /相邻镜头短暂重叠/);
  assert.match(guide, /子帧采样/);
  assert.match(guide, /不换成图像生成服务/);
});
