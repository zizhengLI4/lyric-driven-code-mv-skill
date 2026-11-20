import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { requireMediaTools } from './media-tools.mjs';

const root = resolve('skills/lyric-driven-code-mv');
const ledgerPath = join(root, 'assets/examples/visual-ledger-demo.json');
const demoScript = join(root, 'assets/examples/visual-quality-demos.py');
const promptGuidePath = join(root, 'references/code-directed-visuals.md');

function extractFrameHashes(ffmpeg, videoPath, rate = 1) {
  const result = spawnSync(ffmpeg, [
    '-v', 'error', '-i', videoPath, '-vf', `fps=${rate}`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
  ], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  const frameBytes = 960 * 540 * 3;
  assert.equal(result.stdout.length % frameBytes, 0, 'raw frame output must be complete');
  const hashes = new Set();
  for (let offset = 0; offset < result.stdout.length; offset += frameBytes) {
    hashes.add(result.stdout.subarray(offset, offset + frameBytes).toString('base64'));
  }
  return hashes;
}

test('visual ledger gives each lyric cue a concrete shot and a finishing plan', () => {
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  assert.ok(Array.isArray(ledger.scenes) && ledger.scenes.length >= 4);
  for (const scene of ledger.scenes) {
    assert.ok(scene.cues.length > 0 && scene.cues.length <= 4, `${scene.id} exceeds the lyric-cue review threshold`);
    assert.equal(scene.beats.length, scene.cues.length, `${scene.id} needs one shot beat per lyric cue`);
    for (const [index, beat] of scene.beats.entries()) {
      assert.equal(beat.cue, scene.cues[index], `${scene.id} beat ${index + 1} must narrate its matching lyric cue`);
      for (const field of ['shot', 'object', 'action', 'result']) {
        assert.ok(beat[field]?.trim(), `${scene.id} beat ${index + 1} needs ${field}`);
      }
      assert.ok(beat.finish?.material.trim(), `${scene.id} beat ${index + 1} needs a material treatment`);
      assert.ok(beat.finish?.lighting.trim(), `${scene.id} beat ${index + 1} needs a light plan`);
      assert.ok(beat.finish?.secondaryMotion.trim(), `${scene.id} beat ${index + 1} needs restrained secondary motion`);
      assert.ok(beat.finish?.details.length >= 2, `${scene.id} beat ${index + 1} needs two readable craft details`);
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
  const guide = readFileSync(promptGuidePath, 'utf8');
  for (const tag of ['<role>', '<context>', '<task>', '<specs>', '<style>', '<check>']) {
    assert.ok(guide.includes(tag), `prompt guidance should define ${tag}`);
  }
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

test('quality demo generator produces a moving opener and readable lyric-led shots', async t => {
  const tools = requireMediaTools(t, ['ffmpeg', 'ffprobe']);
  if (!tools) return;
  const python = process.env.PYTHON || 'python';
  const pillow = spawnSync(python, ['-c', 'import PIL'], { windowsHide: true });
  if (pillow.status !== 0) {
    t.skip('Pillow is not installed; visual demo generation is optional and installs nothing');
    return;
  }
  assert.ok(existsSync(demoScript));
  const outputDirectory = mkdtempSync(join(tmpdir(), 'lyric-visual-demos-'));
  t.after(() => rmSync(outputDirectory, { recursive: true, force: true }));
  const generated = spawnSync(python, ['-X', 'utf8', demoScript, '--output-dir', outputDirectory, '--ffmpeg', tools.ffmpeg], {
    encoding: 'utf8', windowsHide: true, timeout: 120000,
  });
  assert.equal(generated.status, 0, `${generated.stdout}\n${generated.stderr}`);
  const opening = join(outputDirectory, 'opening-hook-demo.mp4');
  const semantic = join(outputDirectory, 'four-cue-scene-change-demo.mp4');
  const objectsOnly = join(outputDirectory, 'four-cue-scene-change-no-captions.mp4');
  for (const path of [opening, semantic, objectsOnly]) assert.ok(existsSync(path));

  const probe = path => {
    const result = spawnSync(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', path], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const openingInfo = probe(opening);
  const semanticInfo = probe(semantic);
  const objectsOnlyInfo = probe(objectsOnly);
  for (const info of [openingInfo, semanticInfo, objectsOnlyInfo]) {
    const video = info.streams.find(stream => stream.codec_type === 'video');
    assert.equal(video.width, 960);
    assert.equal(video.height, 540);
    assert.ok(!info.streams.some(stream => stream.codec_type === 'audio'), 'demos are silent and do not claim song synchronization');
  }
  assert.ok(Math.abs(Number(openingInfo.format.duration) - 5) < 0.08);
  assert.ok(Math.abs(Number(semanticInfo.format.duration) - 16) < 0.08);
  assert.ok(Math.abs(Number(objectsOnlyInfo.format.duration) - 16) < 0.08);
  assert.ok(extractFrameHashes(tools.ffmpeg, opening, 1).size >= 4);
  assert.ok(extractFrameHashes(tools.ffmpeg, objectsOnly, 1).size >= 16, 'each lyric cue should change visibly with captions hidden');
});
