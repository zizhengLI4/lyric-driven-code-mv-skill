import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeTestReview } from './review-fixture.mjs';
import { requireMediaTools } from './media-tools.mjs';

const starter = new URL('../skills/lyric-driven-code-mv/assets/templates/starter/', import.meta.url);
const exporter = await import(new URL('export.mjs', starter));
const { inspectPNG } = await import(new URL('png.mjs', starter));

async function setup(t, { draft = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mv-visual-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = JSON.parse(await readFile(new URL('../../storyboard-example.json', starter), 'utf8'));
  const storyboard = join(root, 'storyboard.json');
  Object.assign(data.project, { width: 384, height: 216, fps: 2, duration: 2 });
  data.scenes[0].end = 2;
  data.scenes[0].events = [];
  data.music.sections = [{ id: 'test', start: 0, end: 2 }];
  data.music.beats = [];
  data.lyrics = [{ id: 'line', start: 0.5, end: 1.5, text: 'Example' }];
  delete data.chapters;
  if (draft) {
    data.music.status = 'draft';
    data.project.audio = { ...data.project.audio, path: 'song.wav' };
    await writeFile(join(root, 'song.wav'), exporter.synthesizeWAV(2));
  }
  await writeFile(storyboard, JSON.stringify(data));
  const args = ['--storyboard', storyboard, '--out', join(root, 'film.mp4'), '--ffmpeg', 'intentional-missing-ffmpeg'];
  return { root, data, storyboard, args };
}

test('真实项目缺静帧确认时阻断动态和帧序列，但可导出世界层单帧', async t => {
  const { root, args } = await setup(t);
  const out = join(root, 'world.png');
  await exporter.exportFrame(exporter.parseArgs([...args, '--frame-time', '0.5', '--frame-out', out]), () => {});
  assert.equal(inspectPNG(await readFile(out)).width, 384);
  for (const options of [[], ['--frames-only', '--frames-dir', join(root, 'frames')]]) {
    await assert.rejects(() => exporter.exportVideo(exporter.parseArgs([...args, ...options])), /场景.*人物.*确认/);
  }
  assert.ok(!(await readdir(root)).includes('frames'));
  const preview = spawnSync(process.execPath, [fileURLToPath(new URL('export.mjs', starter)), ...args, '--preview'], {
    windowsHide: true, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(preview.status, 1);
  assert.match(preview.stderr, /静帧确认/);
});

test('逐场逐人确认及版本检查在 FFmpeg 预检之前执行', async t => {
  const { root, data, storyboard, args } = await setup(t);
  const { path, record } = await writeTestReview(root, storyboard, data);
  const approved = () => exporter.exportVideo(exporter.parseArgs([...args, '--review', path]));
  await writeFile(path, JSON.stringify({ ...record, actors: [] }));
  await assert.rejects(approved, /人物/);
  await writeFile(path, JSON.stringify({ ...record, scenes: [] }));
  await assert.rejects(approved, /场景/);
  await writeFile(path, JSON.stringify(record));
  await assert.rejects(approved, /intentional-missing-ffmpeg/);
  const scene = join(root, record.scenes[0].frame.path);
  const approvedScene = await readFile(scene);
  await writeFile(scene, Buffer.concat([approvedScene, Buffer.from([0])]));
  await assert.rejects(approved, /静帧.*已变更|静帧.*哈希/);
  await writeFile(scene, approvedScene);
  await writeFile(storyboard, JSON.stringify({ ...data, note: 'Edited after approval' }));
  await assert.rejects(approved, /分镜.*(?:已变更|版本)/);
});

test('最终尺寸静帧可在未确认时使用正式 ASS，字幕时点随成片秒', async t => {
  const tools = requireMediaTools(t, ['ffmpeg']); if (!tools) return;
  const { root, args, storyboard, data } = await setup(t);
  const out = join(root, 'captioned.png');
  const render = () => exporter.exportFrame(exporter.parseArgs([...args.slice(0, -2), '--ffmpeg', tools.ffmpeg, '--frame-time', '0.75', '--frame-out', out, '--frame-final']), () => {});
  await render();
  const captioned = await readFile(out);
  assert.deepEqual(inspectPNG(captioned, { template: false }), { width: 384, height: 216 });
  data.lyrics = [];
  await writeFile(storyboard, JSON.stringify(data));
  await render();
  assert.notDeepEqual(await readFile(out), captioned);
});

test('Python 视觉入口在编码前检查定版记录，单帧仍可供评审', async t => {
  const python = process.env.PYTHON || 'python';
  const probe = spawnSync(python, ['-c', 'import PIL'], { windowsHide: true });
  if (probe.status !== 0) { t.skip('需要已有 Python 和 Pillow'); return; }
  const { root, storyboard } = await setup(t);
  const renderer = fileURLToPath(new URL('../../../scripts/minimal-renderer.py', starter));
  const run = (...args) => spawnSync(python, ['-X', 'utf8', renderer, storyboard, ...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  const frame = run('--probe', '1');
  assert.equal(frame.status, 0, frame.stderr);
  const video = run('--out', join(root, 'film.mp4'));
  assert.equal(video.status, 1, video.stderr);
  assert.match(video.stderr, /确认.*场景.*人物/);
});

test('含 9 个事件的分镜默认载入提示音，明确的静默技术检查仍生效', async () => {
  const storyboard = fileURLToPath(new URL('../../storyboard-sfx-demo.json', starter));
  const enabled = await exporter.loadProject(exporter.parseArgs(['--storyboard', storyboard]));
  assert.equal(enabled.sfx.length, 9);
  const muted = await exporter.loadProject(exporter.parseArgs(['--storyboard', storyboard, '--no-sfx']));
  assert.equal(muted.sfx.length, 0);
  assert.equal(muted.expectedSfx, 9);
});


test('静帧审批能识别出错的字幕字体或重复的角色远近景', async t => {
  const { root, data, storyboard, args } = await setup(t);
  const { path, record } = await writeTestReview(root, storyboard, data);
  const run = (...options) => exporter.exportVideo(exporter.parseArgs([...args, '--review', path, ...options]));
  await assert.rejects(() => run('--font', 'A changed font'), /字幕字体/);
  assert.ok(record.actors.length);
  record.actors[0].close = record.actors[0].wide;
  await writeFile(path, JSON.stringify(record));
  await assert.rejects(run, /远近景必须分别提供/);
});

test('更换已登记的画法素材并重新确认后拒绝复用旧帧', async t => {
  const { root, data, storyboard, args } = await setup(t);
  const { path, record } = await writeTestReview(root, storyboard, data);
  const extra = join(root, 'art-material.txt');
  await writeFile(extra, 'First asset');
  const sources = [...record.sources.map(entry => entry.path), extra];
  await writeTestReview(root, storyboard, data, { sources });
  const opts = [...args, '--review', path, '--frames-dir', join(root, 'resume')];
  await exporter.prepareFrames(exporter.parseArgs(opts), () => {});
  await writeFile(extra, 'New asset');
  await writeTestReview(root, storyboard, data, { sources });
  await assert.rejects(() => exporter.prepareFrames(exporter.parseArgs([...opts, '--resume']), () => {}), /配置.*源码/);
});

test('逐镜索引标出起中末、歌词、关键动作和跨镜前后帧', async () => {
  const { buildShotReviewIndex } = await import(new URL('../../../scripts/qa.mjs', starter));
  const index = buildShotReviewIndex({
    project: { duration: 2, fps: 4 },
    lyrics: [{ id: 'cross', start: 0.7, end: 1.8, text: '一句' }],
    scenes: [
      { id: 'a', start: 0, end: 1, exit: { type: 'dissolve', dur: 0.5 }, events: [{ id: 'touch', at: 0.5 }] },
      { id: 'b', start: 1, end: 2 },
    ],
  });
  assert.equal(index.totalFrames, 8);
  assert.deepEqual(index.scenes.map(shot => shot.lyrics[0].id), ['cross', 'cross']);
  assert.ok(index.scenes[0].frames.find(frame => frame.frame === 2).reasons.includes('event:touch'));
  assert.ok(index.scenes[0].frames.find(frame => frame.frame === 3).reasons.includes('end'));
  assert.ok(index.scenes[0].frames.find(frame => frame.frame === 4).reasons.includes('boundary'));
  assert.ok(index.scenes[1].frames.find(frame => frame.frame === 7).reasons.includes('end'));
  assert.ok(index.scenes.every(shot => shot.visualReview === 'pending'));
});

test('双声道 RMS 保留反相提示音并对近静音不计算比值', async () => {
  const { stereoCueLevels } = await import(new URL('audio-review.mjs', starter));
  const mixed = new Float32Array(2000), music = new Float32Array(2000), stem = new Float32Array(2000);
  for (let i = 0; i < 1000; i++) {
    const bg = i < 400 ? 0.1 : 0;
    music[2 * i] = music[2 * i + 1] = bg;
    stem[2 * i] = 0.1;
    stem[2 * i + 1] = -0.1;
    mixed[2 * i] = bg + 0.1;
    mixed[2 * i + 1] = bg - 0.1;
  }
  const levels = stereoCueLevels({ events: [{ at: 0.1, hitAt: 0.2 }, { at: 0.6 }], mixed, music, stem, sampleRate: 1000, duration: 1 });
  assert.equal(levels[0].attack.differenceRelativeDb, 0);
  assert.equal(levels[0].impact.stemDbfs.stereo, -20);
  assert.equal(levels[1].attack.nearSilence, true);
  assert.equal(levels[1].attack.stemRelativeDb, null);
  assert.deepEqual(levels[1].attack.differenceDbfs, { left: -20, right: -20, stereo: -20 });
});

test('真实 FFmpeg 导出记录全部 9 个提示音并从 AAC 和最终视频逐镜复核', async t => {
  const tools = requireMediaTools(t, ['ffmpeg', 'ffprobe']); if (!tools) return;
  const { root, data, storyboard } = await setup(t);
  const sample = JSON.parse(await readFile(new URL('../../storyboard-sfx-demo.json', starter), 'utf8'));
  const events = [sample.project.sfx, ...sample.scenes.map(scene => scene.sfx ?? [])].flat().sort((a, b) => a.at - b.at);
  data.project.duration = 12;
  data.project.audio.path = 'song.wav';
  data.scenes[0].end = 12;
  data.music.sections[0].end = 12;
  data.project.sfx = events.map(({ at, type, gain, hitAt, anchor }, i) => ({ id: 'cue-' + (i + 1), at, type, gain, hitAt, anchor }));
  await writeFile(join(root, 'song.wav'), exporter.synthesizeWAV(12));
  await writeFile(storyboard, JSON.stringify(data));
  const { path: review } = await writeTestReview(root, storyboard, data);
  const out = join(root, 'mv.mp4');
  const clips = join(root, 'frames');
  const c = exporter.parseArgs(['--storyboard', storyboard, '--review', review, '--out', out, '--frames-dir', clips,
    '--ffmpeg', tools.ffmpeg, '--ffprobe', tools.ffprobe]);
  await exporter.exportVideo(c, () => {});
  const manifest = JSON.parse(await readFile(out + '.assets.json', 'utf8'));
  assert.equal(manifest.sfx.expected, 9);
  assert.equal(manifest.sfx.mixed, 9);
  assert.equal(manifest.sfx.finalMix.events.length, 9);
  assert.equal(manifest.sfx.finalMix.channels, 2);
  assert.ok(manifest.sfx.finalMix.events.every(event => event.attack.stemDbfs.stereo !== null), '每个计划事件的攻击窗口应测得单轨');
  assert.ok(Number.isFinite(manifest.sfx.finalMix.truePeakDbtp));
  assert.ok(manifest.visualReview.sha256);

  const python = process.env.PYTHON || 'python';
  const qa = fileURLToPath(new URL('../../../scripts/qa.mjs', starter));
  const cmdFile = fileURLToPath(new URL('../../../scripts/film-sheet.py', starter));
  const plan = join(root, 'shot-index.json'), dir = join(root, 'final-stills');
  const generated = spawnSync(process.execPath, [qa, '--review-index', storyboard, '--out', plan], { encoding: 'utf8', windowsHide: true });
  assert.equal(generated.status, 0, generated.stderr);
  const extracted = spawnSync(python, ['-X', 'utf8', cmdFile, out, '--review-index', plan, '--review-dir', dir], {
    windowsHide: true, encoding: 'utf8', env: { ...process.env, FFMPEG_PATH: tools.ffmpeg, FFPROBE_PATH: tools.ffprobe },
  });
  assert.equal(extracted.status, 0, extracted.stderr);
  const artifact = JSON.parse(await readFile(join(dir, 'review-index.json'), 'utf8'));
  assert.equal(artifact.videoSha256, manifest.output.sha256);
  assert.equal(artifact.binding, 'export-manifest');
  const detail = join(root, 'detail');
  const cropped = spawnSync(python, ['-X', 'utf8', cmdFile, out, '--review-index', plan, '--review-dir', detail, '--strip', '0.5', '1.5', '--crop', '18', '20', '37', '29'], {
    windowsHide: true, encoding: 'utf8', env: { ...process.env, FFMPEG_PATH: tools.ffmpeg, FFPROBE_PATH: tools.ffprobe },
  });
  assert.equal(cropped.status, 0, cropped.stderr);
  const detailIndex = JSON.parse(await readFile(join(detail, 'review-index.json'), 'utf8'));
  assert.deepEqual(detailIndex.strip.frames.map(point => point.frame), [1, 2]);
  const croppedFrame = await readFile(join(detail, detailIndex.strip.frames[0].file));
  assert.deepEqual(inspectPNG(croppedFrame, { template: false }), { width: 37, height: 29 });
  await writeFile(out + '.assets.json', JSON.stringify({ ...manifest, storyboardSha256: 'stale hash' }));
  const mismatched = spawnSync(python, ['-X', 'utf8', cmdFile, out, '--review-index', plan, '--review-dir', join(root, 'stale-review')], {
    windowsHide: true, encoding: 'utf8', env: { ...process.env, FFMPEG_PATH: tools.ffmpeg, FFPROBE_PATH: tools.ffprobe },
  });
  assert.equal(mismatched.status, 1, mismatched.stdout);
  assert.match(mismatched.stderr, /版本不一致/);
  const first = await readFile(join(dir, artifact.scenes[0].frames[0].file));
  assert.deepEqual(inspectPNG(first, { template: false }), { width: 384, height: 216 });
});
