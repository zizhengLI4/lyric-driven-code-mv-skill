import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, readdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const base = new URL('../skills/lyric-driven-code-mv/assets/templates/starter/', import.meta.url);
const source = JSON.parse(await readFile(new URL('../skills/lyric-driven-code-mv/assets/storyboard-example.json', import.meta.url), 'utf8'));
const fixture = () => {
  const data = structuredClone(source);
  Object.assign(data.project, { duration: 4, fps: 4, width: 768, height: 432 });
  data.scenes[0].end = 1.5; data.scenes[0].exit = { type: 'dissolve', dur: 0.5 };
  data.scenes[1].start = 1.5; data.scenes[1].end = 4;
  data.lyrics = [{ id: 'new-line', start: 0.2, end: 1.2, text: '新的分镜字幕', en: 'A new cue.' }];
  return data;
};
const setup = async (t, data = fixture()) => {
  const root = await mkdtemp(join(tmpdir(), 'mv-storyboard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'storyboard.json'); await writeFile(path, JSON.stringify(data));
  return { root, path, data };
};

test('音轨覆盖只能重定位同一素材，演示记录不能冒充真实歌曲', async t => {
  const exporter = await import(new URL('export.mjs', base));
  const { root, path, data } = await setup(t);
  const audio = join(root, 'song.wav'); await writeFile(audio, exporter.synthesizeWAV());
  await assert.rejects(() => exporter.loadProject(exporter.parseArgs(['--storyboard', path, '--audio', audio])), /illustrative|演示/);
  data.music.status = 'draft'; data.project.audio.path = 'declared.wav';
  await writeFile(path, JSON.stringify(data));
  await assert.rejects(() => exporter.loadProject(exporter.parseArgs(['--storyboard', path, '--audio', audio])), /不一致|绑定|sha256/);
  data.project.audio.sha256 = createHash('sha256').update(await readFile(audio)).digest('hex');
  await writeFile(path, JSON.stringify(data));
  const c = await exporter.loadProject(exporter.parseArgs(['--storyboard', path, '--audio', audio]));
  assert.equal(c.audioHash, data.project.audio.sha256);
  assert.equal(c.audioRecord.path, 'declared.wav');
  await writeFile(join(root, 'declared.wav'), await readFile(audio));
  delete data.project.audio.sha256; await writeFile(path, JSON.stringify(data));
  await exporter.loadProject(exporter.parseArgs(['--storyboard', path, '--audio', audio]));
  await writeFile(audio, Buffer.from('different track'));
  await assert.rejects(() => exporter.loadProject(exporter.parseArgs(['--storyboard', path, '--audio', audio])), /不一致|绑定|sha256/);
});

test('执行字幕容忍帧率分数舍入，但拒绝实质越界', async () => {
  const { createTimeline } = await import(new URL('timeline.mjs', base));
  const data = fixture(); data.project.duration = 4064 / 30;
  data.scenes[1].end = 135.466667; data.lyrics[0].end = 135.466667;
  assert.equal(createTimeline(data).captions[0].end, data.project.duration);
  data.lyrics[0].end = data.project.duration + 2e-6;
  assert.throws(() => createTimeline(data), /时间/);
  data.lyrics[0].start = data.project.duration; data.lyrics[0].end = data.project.duration + 5e-7;
  assert.throws(() => createTimeline(data), /时间/);
});

test('单帧CLI不需要媒体工具，按指定成片秒导出世界层PNG', async t => {
  const { root, path } = await setup(t);
  const out = join(root, 'frame.png');
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('export.mjs', base)), '--storyboard', path, '--frame-time', '1.25', '--frame-out', out, '--ffmpeg', 'missing-ffmpeg'], { encoding: 'utf8', windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  const { inspectPNG, encodePNG } = await import(new URL('png.mjs', base));
  const exporter = await import(new URL('export.mjs', base));
  const { renderFrame } = await import(new URL('frame.mjs', base));
  const c = await exporter.loadProject(exporter.parseArgs(['--storyboard', path]));
  const bytes = await readFile(out);
  assert.deepEqual(inspectPNG(bytes), { width: 384, height: 216 });
  assert.deepEqual(bytes, encodePNG(renderFrame(1.25, { seed: c.seed, timeline: c.timeline })));
  assert.throws(() => exporter.parseArgs(['--frame-time', '1']), /frame-out/);
  assert.throws(() => exporter.parseArgs(['--frame-time', 'NaN', '--frame-out', out]), /frame-time/);
});

test('素材清单无法发布时保留旧MP4并清理本次临时产物', async t => {
  const { requireMediaTools } = await import('./media-tools.mjs');
  const tools = requireMediaTools(t, ['ffmpeg', 'ffprobe']); if (!tools) return;
  const { root, path } = await setup(t);
  const exporter = await import(new URL('export.mjs', base));
  const out = join(root, 'existing.mp4'), original = Buffer.from('old deliverable');
  await writeFile(out, original); await mkdir(`${out}.assets.json`);
  const c = exporter.parseArgs(['--storyboard', path, '--out', out, '--ffmpeg', tools.ffmpeg, '--ffprobe', tools.ffprobe]);
  await assert.rejects(() => exporter.exportVideo(c, () => {}));
  assert.deepEqual(await readFile(out), original);
  assert.ok(!(await readdir(root)).some(name => name.startsWith('.rendering-') || name.startsWith('.mv-publish-') || name.endsWith('.writing')));
});

test('第二个文件提交失败会恢复旧交付，回滚失败会保留可定位备份', async t => {
  const { root } = await setup(t);
  const { publishOutput } = await import(new URL('export.mjs', base));
  const out = join(root, 'old.mp4'), pending = join(root, 'pending.mp4');
  const oldVideo = Buffer.from('old video'), oldRecords = Buffer.from('old metadata');
  for (const rollbackFails of [false, true]) {
    await writeFile(out, oldVideo); await writeFile(`${out}.assets.json`, oldRecords); await writeFile(pending, 'new video');
    const injectedMove = async (from, to) => {
      if (from.endsWith('assets.json') && to === `${out}.assets.json`) throw new Error('second-commit-marker');
      if (rollbackFails && from.endsWith('previous-0')) throw new Error('rollback-marker');
      await rename(from, to);
    };
    await assert.rejects(() => publishOutput(pending, out, { output: 'new' }, injectedMove), rollbackFails ? /保留备份.*rollback-marker/ : /second-commit-marker/);
    assert.deepEqual(await readFile(`${out}.assets.json`), oldRecords);
    const backupDirs = (await readdir(root)).filter(n => n.startsWith('.mv-publish-'));
    if (rollbackFails) {
      assert.equal(backupDirs.length, 1);
      assert.deepEqual(await readFile(join(root, backupDirs[0], 'previous-0')), oldVideo);
    } else {
      assert.deepEqual(await readFile(out), oldVideo); assert.equal(backupDirs.length, 0);
    }
  }
});

test('JSON改变实际边界、转场、字幕与项目时长，拒绝CLI冲突和未知画法', async t => {
  const { path, data } = await setup(t);
  const exporter = await import(new URL('export.mjs', base));
  const frame = await import(new URL('frame.mjs', base));
  const c = await exporter.loadProject(exporter.parseArgs(['--storyboard', path]));
  assert.deepEqual([c.duration, c.fps, c.width, c.height], [4, 4, 768, 432]);
  const state = frame.resolveTimeline(1.25, c.timeline);
  assert.deepEqual([state.index, state.nextIndex, state.progress], [0, 1, 0.5]);
  assert.equal(frame.resolveTimeline(1.5, c.timeline).local, 0);
  assert.equal(frame.resolveTimeline(99, c.timeline).local, 2.5);
  const ass = exporter.createASS(c);
  assert.match(ass, /新的分镜字幕/); assert.match(ass, /A new cue/);
  assert.doesNotMatch(ass, /送一盏小灯到对岸/);
  const hash = f => createHash('sha256').update(f.data).digest('hex');
  assert.notEqual(hash(frame.renderFrame(2, { timeline: c.timeline })), hash(frame.renderFrame(2)));
  await assert.rejects(() => exporter.loadProject(exporter.parseArgs(['--storyboard', path, '--fps', '30'])), /冲突/);
  data.scenes[0].id = 'no-draw-handler'; await writeFile(path, JSON.stringify(data));
  await assert.rejects(() => exporter.loadProject(exporter.parseArgs(['--storyboard', path])), /画法|镜头/);
});

test('draft自动全时段标识，真实歌曲必须输入音轨，恢复拒绝更换JSON或音频内容', async t => {
  const data = fixture(); data.music.status = 'draft'; data.project.audio.timebase = 'source'; data.project.sourceOffset = 2;
  const { root, path } = await setup(t, data);
  const exporter = await import(new URL('export.mjs', base));
  await assert.rejects(() => exporter.loadProject(exporter.parseArgs(['--storyboard', path])), /音轨|音频/);
  const audio = join(root, 'song.wav'); await writeFile(audio, exporter.synthesizeWAV());
  data.project.audio.path = 'song.wav'; await writeFile(path, JSON.stringify(data));
  const c = await exporter.loadProject(exporter.parseArgs(['--storyboard', path, '--audio', audio, '--frames-dir', join(root, 'frames')]));
  assert.equal(c.audioStart, 2); assert.match(exporter.createASS(c), /待核对落点/);
  assert.match(exporter.createASS(c), /0:00:04\.00,Notice/);
  await exporter.prepareFrames(c, () => {});
  const manifest = JSON.parse(await readFile(join(root, 'frames', 'render-config.json'), 'utf8'));
  assert.equal(manifest.frameCount, 16);
  data.project.draftMark = false; data.project.draftMarkText = '内部草稿提示'; await writeFile(path, JSON.stringify(data));
  const hiddenDir = join(root, 'frames-with-hidden-draft-mark');
  const hidden = exporter.parseArgs(['--storyboard', path, '--audio', audio, '--frames-dir', hiddenDir, '--frames-only']);
  await exporter.exportVideo(hidden, () => {});
  const assets = JSON.parse(await readFile(join(hiddenDir, 'asset-manifest.json'), 'utf8'));
  assert.deepEqual(assets.draftMark, { enabled: false, text: null });
  assert.doesNotMatch(exporter.createASS(await exporter.loadProject(hidden)), /内部草稿提示|待核对落点/);
  data.lyrics[0].text = '修改后的字幕'; await writeFile(path, JSON.stringify(data));
  const changed = await exporter.loadProject(exporter.parseArgs(['--storyboard', path, '--audio', audio, '--frames-dir', join(root, 'frames'), '--resume']));
  await assert.rejects(() => exporter.prepareFrames(changed, () => {}), /配置|源码/);
  data.lyrics[0].text = '新的分镜字幕'; await writeFile(path, JSON.stringify(data));
  await writeFile(audio, Buffer.from('different audio bytes'));
  const changedAudio = await exporter.loadProject(exporter.parseArgs(['--storyboard', path, '--audio', audio, '--frames-dir', join(root, 'frames'), '--resume']));
  await assert.rejects(() => exporter.prepareFrames(changedAudio, () => {}), /配置|源码/);
});

test('真实音轨按sourceOffset裁剪且JSON决定输出音视频时长', async t => {
  const { requireMediaTools } = await import('./media-tools.mjs');
  const tools = requireMediaTools(t, ['ffmpeg', 'ffprobe']); if (!tools) return;
  const data = fixture(); data.music.status = 'draft'; data.project.audio.timebase = 'source'; data.project.sourceOffset = 2;
  const { root, path } = await setup(t, data);
  const audio = join(root, 'source.wav');
  data.project.audio.path = 'source.wav';
  Object.assign(data.project.audio, { provenance: 'licensed', credit: '测试曲目 — 测试作者', license: 'Test license', url: 'https://example.org/test', licenseUrl: 'https://example.org/license' });
  await writeFile(path, JSON.stringify(data));
  const generated = spawnSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=if(lt(t\\,2)\\,0\\,0.2*sin(2*PI*440*t)):s=48000:d=8', '-y', audio], { windowsHide: true });
  assert.equal(generated.status, 0, generated.stderr?.toString());
  const exporter = await import(new URL('export.mjs', base));
  const c = exporter.parseArgs(['--storyboard', path, '--audio', audio, '--out', join(root, 'actual.mp4'), '--ffmpeg', tools.ffmpeg, '--ffprobe', tools.ffprobe]);
  const result = await exporter.exportVideo(c, () => {});
  assert.ok(Math.abs(Number(result.format.duration) - 4) < 0.04);
  assert.equal(result.streams.find(s => s.codec_type === 'video').nb_frames, '16');
  const records = JSON.parse(await readFile(`${c.out}.assets.json`, 'utf8'));
  assert.equal(records.audio.declared.credit, data.project.audio.credit);
  assert.equal(records.audio.sourceStart, 2);
  assert.equal(records.audio.sourceSha256, createHash('sha256').update(await readFile(audio)).digest('hex'));
  assert.equal(records.output.sha256, createHash('sha256').update(await readFile(c.out)).digest('hex'));
  const loaded = await exporter.loadProject(c); assert.match(exporter.createASS(loaded), /测试曲目 — 测试作者/);
  const pcm = spawnSync(tools.ffmpeg, ['-v', 'error', '-i', c.out, '-t', '0.25', '-f', 'f32le', '-ac', '1', 'pipe:1'], { windowsHide: true });
  assert.equal(pcm.status, 0);
  let energy = 0; for (let i = 0; i + 4 <= pcm.stdout.length; i += 4) energy += pcm.stdout.readFloatLE(i) ** 2;
  assert.ok(energy / (pcm.stdout.length / 4) > 0.005, '裁剪后第一拍应来自原曲2秒后的有声区');
  data.project.sourceOffset = 7.5; await writeFile(path, JSON.stringify(data));
  await assert.rejects(() => exporter.exportVideo(c, () => {}), /短|长度|时长/);
});
