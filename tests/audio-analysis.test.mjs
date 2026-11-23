import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mediaToolPath, requireMediaTools } from './media-tools.mjs';

const script = fileURLToPath(new URL('../skills/lyric-driven-code-mv/scripts/analyze-audio.mjs', import.meta.url));
const { analyzePcm, decodeAudio, parseArgs } = await import(new URL('../skills/lyric-driven-code-mv/scripts/analyze-audio.mjs', import.meta.url));
const sampleRate = 8000;

// These signals have hand-chosen beat positions, rather than expectations computed by the analyzer.
function pulses(duration = 8, phase = 0.17, period = 0.5, amplitude = 0.8) {
  const samples = new Float32Array(Math.round(duration * sampleRate));
  for (let start = phase; start < duration; start += period) {
    for (let offset = 0; offset < 0.04 * sampleRate; offset++) {
      const index = Math.round(start * sampleRate) + offset;
      if (index < samples.length) samples[index] = amplitude * Math.exp(-offset / (0.012 * sampleRate)) * Math.cos(2 * Math.PI * 600 * offset / sampleRate);
    }
  }
  return samples;
}

function lowFrequencyPulses(duration = 12, phase = 0.17, period = 0.5) {
  const samples = new Float32Array(Math.round(duration * sampleRate));
  for (let start = phase; start < duration; start += period) {
    for (let offset = 0; offset < 0.08 * sampleRate; offset++) {
      const index = Math.round(start * sampleRate) + offset;
      if (index < samples.length) samples[index] = 0.8 * Math.exp(-offset / (0.025 * sampleRate)) * Math.sin(2 * Math.PI * 70 * offset / sampleRate);
    }
  }
  return samples;
}

// 80 ms of timing spread represents loose playing; the intended beat remains 110 BPM.
function loose110(duration = 80, jitter = 0.08) {
  const samples = new Float32Array(Math.round(duration * sampleRate));
  let state = 12;
  for (let beat = 0; 0.17 + beat * 60 / 110 < duration; beat++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const start = 0.17 + beat * 60 / 110 + (state / 4294967296 - 0.5) * jitter;
    for (let offset = 0; offset < 0.04 * sampleRate; offset++) {
      const index = Math.round(start * sampleRate) + offset;
      if (index >= 0 && index < samples.length) samples[index] = 0.8 * Math.exp(-offset / (0.012 * sampleRate)) * Math.cos(2 * Math.PI * 600 * offset / sampleRate);
    }
  }
  return samples;
}

function changingTempoWithDropout() {
  const duration = 24;
  const samples = new Float32Array(duration * sampleRate);
  const addPulse = at => {
    for (let offset = 0; offset < 0.04 * sampleRate; offset++) {
      const index = Math.round(at * sampleRate) + offset;
      if (index < samples.length) samples[index] = 0.8 * Math.exp(-offset / (0.012 * sampleRate)) * Math.cos(2 * Math.PI * 600 * offset / sampleRate);
    }
  };
  for (let beat = 0; 0.17 + beat * 60 / 110 < 9; beat++) addPulse(0.17 + beat * 60 / 110);
  for (let beat = 0; 12.2 + beat * 60 / 84 < duration; beat++) addPulse(12.2 + beat * 60 / 84);
  return samples;
}

function graduallyChangingTempo() {
  const duration = 48;
  const samples = new Float32Array(duration * sampleRate);
  for (let at = 0.17; at < duration;) {
    for (let offset = 0; offset < 0.04 * sampleRate; offset++) {
      const index = Math.round(at * sampleRate) + offset;
      if (index < samples.length) samples[index] = 0.8 * Math.exp(-offset / (0.012 * sampleRate)) * Math.cos(2 * Math.PI * 600 * offset / sampleRate);
    }
    at += 0.5 - 0.04 * at / duration;
  }
  return samples;
}

function tempDirectory(t) {
  const root = resolve(tmpdir());
  const directory = mkdtempSync(join(root, 'lyric audio analysis '));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(root + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function wav(samples) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  samples.forEach((sample, index) => buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), 44 + index * 2));
  return buffer;
}

function runCli(args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  return result;
}

test('silence produces a draft energy envelope and pauses but no fabricated BPM or onset', () => {
  assert.equal(typeof analyzePcm, 'function', 'export the pure analysis function');
  const report = analyzePcm(new Float32Array(sampleRate * 4), { sampleRate });
  assert.equal(report.status, 'draft');
  assert.equal(report.timebase, 'clip');
  assert.equal(report.tempo.bpm, null);
  assert.equal(report.tempo.phaseSeconds, null);
  assert.equal(report.tempo.confidence, 0);
  assert.deepEqual(report.onsets, []);
  assert.ok(report.energy.envelope.every(frame => frame.rms === 0 && frame.normalized === 0));
  assert.equal(report.pauses[0].start, 0);
  assert.equal(report.pauses[0].end, 4);
});

test('120 BPM pulses retain their 0.17-second phase instead of forcing a grid to zero', () => {
  const report = analyzePcm(pulses(), { sampleRate });
  assert.ok(Math.abs(report.tempo.bpm - 120) <= 1, JSON.stringify(report.tempo));
  assert.ok(Math.abs(report.tempo.phaseSeconds - 0.17) <= 0.025, JSON.stringify(report.tempo));
  assert.ok(report.tempo.phaseSeconds >= 0 && report.tempo.phaseSeconds < 60 / report.tempo.bpm);
  assert.ok(report.onsets.length >= 14);
  assert.ok(Math.abs(report.onsets[0].at - 0.17) <= 0.025);
  assert.ok(report.tempo.candidates.length > 1);
  assert.ok(report.tempo.candidates.every(candidate => candidate.vote >= 0 && candidate.phaseSeconds >= 0 && candidate.phaseSeconds < 60 / candidate.bpm));
  assert.ok(report.tempo.ambiguities.some(candidate => candidate.relation === 'half' && Math.abs(candidate.bpm - 60) < 1));
});

test('low-frequency kick candidates retain low-band evidence and stay aligned to the pulse', () => {
  const report = analyzePcm(lowFrequencyPulses(), { sampleRate });
  assert.ok(report.frequencyBands.lowMaxHz > 0 && report.frequencyBands.midMaxHz > report.frequencyBands.lowMaxHz);
  assert.ok(report.onsets.length >= 18);
  assert.ok(Math.abs(report.onsets[0].at - 0.17) <= 0.03);
  assert.ok(report.onsets[0].bandStrength.low > report.onsets[0].bandStrength.high);
  assert.ok(Math.abs(report.tempo.bpm - 120) <= 1, JSON.stringify(report.tempo));
});

test('local beat support follows a tempo change and does not extrapolate through a dropout', () => {
  const report = analyzePcm(changingTempoWithDropout(), { sampleRate });
  assert.ok(Array.isArray(report.tempo.windows), 'publish local tempo windows with their support');
  assert.ok(report.beatDetails.length === report.beats.length, 'each beat should carry provenance and confidence');
  const early = report.tempo.windows.find(window => window.start < 8 && window.bpm !== null);
  const late = report.tempo.windows.find(window => window.start >= 14 && window.bpm !== null);
  assert.ok(early, JSON.stringify(report.tempo.windows));
  assert.ok(late, JSON.stringify(report.tempo.windows));
  assert.ok(Math.abs(early.bpm - 110) <= 2, JSON.stringify(early));
  assert.ok(Math.abs(late.bpm - 84) <= 2, JSON.stringify(late));
  assert.equal(report.beats.some(at => at >= 9.5 && at < 12), false, 'unsupported silence must remain empty');
  assert.ok(report.beatDetails.every(beat => ['observed', 'predicted'].includes(beat.evidence)));
  assert.ok(report.beatDetails.every(beat => beat.confidence >= 0 && beat.confidence <= 1));
});

test('gradual tempo drift uses local beat candidates instead of one drifting global grid', () => {
  const report = analyzePcm(graduallyChangingTempo(), { sampleRate });
  assert.equal(report.tempo.status, 'variable-tempo', JSON.stringify(report.tempo));
  assert.equal(report.tempo.bpm, null, 'a single BPM should not summarize a supported continuous tempo drift');

  const expectedBeats = [];
  for (let at = 0.17; at < report.duration;) {
    expectedBeats.push(at);
    at += 0.5 - 0.04 * at / report.duration;
  }
  assert.ok(report.beats.length > 80);
  for (const at of report.beats) {
    const nearestDistance = Math.min(...expectedBeats.map(expected => Math.abs(expected - at)));
    assert.ok(nearestDistance <= 0.08, `candidate ${at}s is ${nearestDistance}s from every generated pulse`);
  }
});

test('a provided BPM does not override local tempo changes or fill a silent gap', () => {
  const report = analyzePcm(changingTempoWithDropout(), { sampleRate, bpm: 110 });
  assert.equal(report.tempo.status, 'local-variation');
  assert.equal(report.beats.some(at => at >= 9.5 && at < 12), false, 'the dropout must remain unsupported');
  const laterWindow = report.tempo.windows.find(window => window.start >= 16 && window.bpm !== null);
  assert.ok(laterWindow, JSON.stringify(report.tempo.windows));
  assert.ok(Math.abs(laterWindow.bpm - 84) <= 2, JSON.stringify(laterWindow));

  const expectedLaterBeats = [];
  for (let at = 12.2; at < report.duration; at += 60 / 84) expectedLaterBeats.push(at);
  for (const at of report.beats.filter(beat => beat >= 12.2)) {
    const nearestDistance = Math.min(...expectedLaterBeats.map(expected => Math.abs(expected - at)));
    assert.ok(nearestDistance <= 0.08, `candidate ${at}s is ${nearestDistance}s from an 84 BPM pulse`);
  }
});

test('known 110 BPM fits phase without replacing the provided tempo or claiming verification', () => {
  const report = analyzePcm(loose110(20), { sampleRate, bpm: 110 });
  assert.equal(report.tempo.bpm, 110);
  assert.equal(report.tempo.source, 'user-provided');
  assert.equal(report.status, 'draft');
  assert.ok(Math.abs(report.tempo.phaseSeconds - 0.17) < 0.035, JSON.stringify(report.tempo));
  assert.match(report.tempo.evidence.method, /相位/);
  assert.match(report.tempo.evidence.bpm, /110/);
  assert.ok(report.beats.length >= 35);
  assert.ok(report.beats.every(at => at >= 0 && at < 20));
  assert.ok(Math.abs(report.beats[1] - report.beats[0] - 60 / 110) < 0.000002);
});

test('a provided 110 BPM can fit phase from every other beat without requiring a detectable intervening beat', () => {
  const report = analyzePcm(pulses(20, 0.17, 120 / 110), { sampleRate, bpm: 110 });
  assert.equal(report.tempo.bpm, 110);
  assert.equal(report.tempo.source, 'user-provided');
  assert.ok(Math.abs(report.tempo.phaseSeconds - 0.17) < 0.025);
  assert.ok(report.beats.length >= 35);
});

test('metadata BPM requires an explicit evidence record and is preserved in the report', () => {
  const evidence = 'https://example.org/tracks/folk-song — 110 BPM';
  const options = parseArgs(['song.wav', '--bpm', '110', '--bpm-source', 'metadata', '--bpm-evidence', evidence]);
  const report = analyzePcm(loose110(20), options);
  assert.equal(report.tempo.source, 'metadata');
  assert.equal(report.tempo.evidence.bpm, evidence);
  assert.throws(() => analyzePcm(loose110(8), { bpm: 110, bpmSource: 'metadata' }), /依据|evidence/);
  for (const args of [['song.wav', '--bpm', 'NaN'], ['song.wav', '--bpm', '0'], ['song.wav', '--bpm', '401'], ['song.wav', '--bpm-source', 'metadata'], ['song.wav', '--bpm', '110', '--bpm-source', 'detected']]) {
    assert.throws(() => parseArgs(args), /BPM|bpm|来源|source/);
  }
});

test('neighboring 109 and 111 candidates form one cluster and produce a draft grid for loose playing', () => {
  const report = analyzePcm(loose110(), { sampleRate });
  assert.ok(Math.abs(report.tempo.bpm - 110) <= 1, JSON.stringify(report.tempo));
  assert.equal(report.tempo.status, 'low-confidence');
  assert.equal(report.tempo.source, 'audio-analysis');
  assert.ok(report.tempo.confidence > 0 && report.tempo.confidence < 0.6);
  const cluster = report.tempo.clusters.find(candidate => candidate.members.some(member => member.bpm === 109) && candidate.members.some(member => member.bpm === 111));
  assert.ok(cluster, JSON.stringify(report.tempo.clusters));
  assert.ok(cluster.range.min <= 109 && cluster.range.max >= 111);
  assert.ok(report.beats.length > 130);
  assert.equal(report.status, 'draft');
});

test('long exact 110 BPM pulses are not rejected because a half-time bin ranks first', () => {
  const report = analyzePcm(loose110(80, 0), { sampleRate });
  assert.ok(Math.abs(report.tempo.bpm - 110) < 0.3, JSON.stringify(report.tempo));
  assert.ok(Math.abs(report.tempo.phaseSeconds - 0.17) < 0.025);
});

test('white noise and randomly spaced impulses retain no automatic or provided candidate grid', () => {
  for (const kind of ['white', 'impulses']) {
    let state = 12;
    const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
    const samples = new Float32Array(80 * sampleRate);
    if (kind === 'white') {
      for (let i = 0; i < samples.length; i++) samples[i] = 0.8 * (2 * random() - 1);
    } else {
      for (let start = 0.1; start < 80; start += 0.15 + random() * 0.7) {
        for (let offset = 0; offset < 0.04 * sampleRate; offset++) {
          const index = Math.round(start * sampleRate) + offset;
          if (index < samples.length) samples[index] = 0.8 * Math.exp(-offset / (0.012 * sampleRate)) * Math.cos(2 * Math.PI * 600 * offset / sampleRate);
        }
      }
    }
    for (const options of [{ sampleRate }, { sampleRate, bpm: 110 }]) {
      const report = analyzePcm(samples, options);
      assert.equal(report.tempo.bpm, null, `${kind}: ${JSON.stringify(report.tempo)}`);
      assert.deepEqual(report.beats, []);
    }
  }
  const silent = analyzePcm(new Float32Array(8 * sampleRate), { bpm: 110 });
  assert.equal(silent.tempo.bpm, null);
  assert.deepEqual(silent.beats, []);
});

test('a quiet pulse train below the absolute evidence floor leaves tempo unselected', () => {
  const report = analyzePcm(pulses(8, 0.17, 0.5, 1e-7), { sampleRate });
  assert.equal(report.tempo.bpm, null);
  assert.equal(report.tempo.confidence, 0);
});

test('steady sustained audio is not promoted to beat evidence', () => {
  const samples = Float32Array.from({ length: sampleRate * 6 }, (_, index) => 0.4 * Math.sin(2 * Math.PI * 400 * index / sampleRate));
  const report = analyzePcm(samples, { sampleRate });
  assert.equal(report.tempo.bpm, null);
});

test('insufficient onset count leaves BPM null even when two pulses share an interval', () => {
  const report = analyzePcm(pulses(1.2), { sampleRate });
  assert.equal(report.tempo.bpm, null);
  assert.equal(report.tempo.phaseSeconds, null);
});

test('nonzero source offset is metadata and does not shift the clip envelope, onset, or grid', () => {
  const report = analyzePcm(pulses(), { sampleRate, sourceOffset: 37.2 });
  assert.equal(report.sourceOffset, 37.2);
  assert.equal(report.duration, 8);
  assert.equal(report.energy.envelope[0].at, 0);
  assert.ok(report.onsets.every(onset => onset.at >= 0 && onset.at < 8));
  assert.ok(Math.abs(report.tempo.phaseSeconds - 0.17) <= 0.025);
  assert.ok(report.pauses.every(pause => pause.start >= 0 && pause.end <= 8));
});

test('partial terminal energy frame stays within clip duration and includes its samples', () => {
  const samples = new Float32Array(83).fill(0.5);
  const report = analyzePcm(samples, { sampleRate });
  assert.equal(report.duration, 83 / sampleRate);
  assert.ok(report.energy.envelope.every(frame => frame.at >= 0 && frame.at < report.duration));
  assert.ok(report.energy.envelope.every(frame => Math.abs(frame.rms - 0.5) < 1e-6));
});

test('a fractional-sample duration never rounds a pause end beyond the clip boundary', () => {
  const report = analyzePcm(new Float32Array(3205), { sampleRate: 16000 });
  assert.equal(report.duration, 0.2003125);
  assert.equal(report.pauses[0].end, 0.2003125);
});

test('extreme finite PCM cannot overflow the RMS computation into a bogus report', () => {
  assert.throws(() => analyzePcm(new Float64Array([1e308]), { sampleRate }), /PCM|能量|样本/);
});

test('invalid PCM and analysis options fail clearly before numerical work', () => {
  const valid = pulses();
  for (const samples of [null, [], new Float32Array(), new Float32Array([NaN]), new Float32Array([Infinity])]) {
    assert.throws(() => analyzePcm(samples, { sampleRate }), /PCM|样本|sample/i);
  }
  for (const options of [{ sampleRate: 0 }, { sampleRate: '8000' }, { sourceOffset: -1 }, { sourceOffset: NaN }, { windowSeconds: 0 }, { hopSeconds: Infinity }]) {
    assert.throws(() => analyzePcm(valid, options), /sampleRate|sourceOffset|windowSeconds|hopSeconds/);
  }
});

test('CLI parser rejects duplicate, unknown, missing, nonfinite, and overlong options', () => {
  assert.deepEqual(parseArgs(['song.wav', '--start', '37.2', '--duration', '12', '--out', 'report.json']), { input: 'song.wav', start: 37.2, duration: 12, out: 'report.json', sampleRate: 8000, ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg' });
  for (const args of [[], ['a', 'b'], ['a', '--start'], ['a', '--start', '-1'], ['a', '--start', 'NaN'], ['a', '--duration', '0'], ['a', '--duration', '601'], ['a', '--start', '0', '--start', '1'], ['a', '--unknown'], ['a', '--sample-rate', '44100']]) {
    assert.throws(() => parseArgs(args), /用法|参数|start|duration|sample-rate|重复|未知/);
  }
});

test('real ffmpeg CLI handles spaces in paths and emits clip timing after an actual nonzero cut', t => {
  const tools = requireMediaTools(t); if (!tools) return;
  const directory = tempDirectory(t);
  const input = join(directory, 'source pulse song.wav');
  const out = join(directory, 'report with spaces.json');
  writeFileSync(input, wav(pulses(10, 0.37)));
  const result = runCli([input, '--start', '2.2', '--duration', '6', '--out', out, '--ffmpeg', tools.ffmpeg]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(report.sourceOffset, 2.2);
  assert.ok(Math.abs(report.duration - 6) < 1 / sampleRate);
  assert.ok(Math.abs(report.onsets[0].at - 0.17) <= 0.025, JSON.stringify(report.onsets.slice(0, 3)));
  assert.ok(Math.abs(report.tempo.bpm - 120) <= 1);
  assert.ok(Math.abs(report.tempo.phaseSeconds - 0.17) <= 0.025);
});

test('real CLI fits a metadata grid on the cut clock and an explicit flag overrides FFMPEG_PATH', t => {
  const tools = requireMediaTools(t); if (!tools) return;
  const directory = tempDirectory(t);
  const input = join(directory, 'loose playing.wav');
  writeFileSync(input, wav(loose110(10)));
  const evidence = 'https://example.org/track — page says 110 BPM';
  const result = spawnSync(process.execPath, [script, input, '--start', '2.2', '--duration', '6', '--bpm', '110', '--bpm-source', 'metadata', '--bpm-evidence', evidence, '--ffmpeg', tools.ffmpeg], { encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, FFMPEG_PATH: join(directory, 'wrong default ffmpeg') } });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.tempo.bpm, 110);
  assert.equal(report.tempo.source, 'metadata');
  assert.equal(report.tempo.evidence.bpm, evidence);
  assert.equal(report.sourceOffset, 2.2);
  assert.ok(Math.abs(report.tempo.phaseSeconds - 0.151818) < 0.035);
  assert.ok(report.beats.every(at => at >= 0 && at < 6));
});

test('decoder byte cap stops ffmpeg and rejects rather than analyzing a silently truncated source', async t => {
  const tools = requireMediaTools(t); if (!tools) return;
  const directory = tempDirectory(t);
  const input = join(directory, 'larger than allowed.wav');
  writeFileSync(input, wav(pulses(2)));
  await assert.rejects(decodeAudio(input, { sampleRate, maxPcmBytes: sampleRate * 4, ffmpegPath: tools.ffmpeg }), /上限|limit|截取/);
});

test('decoder rejects a nonexistent ffmpeg executable with an actionable error', async t => {
  const directory = tempDirectory(t);
  const input = join(directory, 'valid.wav');
  writeFileSync(input, wav(pulses(1)));
  await assert.rejects(decodeAudio(input, { sampleRate, ffmpegPath: join(directory, 'missing ffmpeg executable') }), /ffmpeg/);
});

test('CLI honors an explicit FFMPEG_PATH instead of silently using a PATH executable', t => {
  const directory = tempDirectory(t);
  const input = join(directory, 'valid.wav');
  writeFileSync(input, wav(pulses(1)));
  const result = spawnSync(process.execPath, [script, input], { encoding: 'utf8', timeout: 20000, windowsHide: true, env: { ...process.env, FFMPEG_PATH: join(directory, 'missing ffmpeg executable') } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ffmpeg/);
});

test('CLI reports missing inputs without a JavaScript stack even before decoding', t => {
  const result = runCli([join(tempDirectory(t), 'not found.wav'), '--duration', '2']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /读取|音频/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test('CLI reports malformed audio without a JavaScript stack after actual decoding', t => {
  const tools = requireMediaTools(t); if (!tools) return;
  const directory = tempDirectory(t);
  const malformed = join(directory, 'bad audio.wav');
  writeFileSync(malformed, 'this is not audio');
  const result = runCli([malformed, '--duration', '2', '--ffmpeg', tools.ffmpeg]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /音频|ffmpeg/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test('CLI refuses outputs that alias its source audio through direct paths and directory junctions', async t => {
  const directory = tempDirectory(t);
  const input = join(directory, 'keep source.wav');
  const original = wav(pulses(2));
  writeFileSync(input, original);
  const result = runCli([input, '--duration', '1', '--out', input]);
  assert.equal(result.status, 1);
  assert.deepEqual(readFileSync(input), original);
  if (process.platform === 'win32') {
    const aliasDirectory = join(directory, 'audio-directory-alias');
    await symlink(directory, aliasDirectory, 'junction');
    const aliasOutput = join(aliasDirectory, 'keep source.wav');
    const viaAlias = runCli([input, '--duration', '1', '--out', aliasOutput]);
    assert.equal(viaAlias.status, 1, viaAlias.stderr);
    assert.match(viaAlias.stderr, /输入文件冲突/);
    assert.deepEqual(readFileSync(input), original);
  }
});

test('CLI help explains draft status and bounded memory without decoding anything', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /draft/);
  assert.match(result.stdout, /600/);
  assert.match(result.stdout, /局部窗口/);
  assert.doesNotMatch(result.stdout, /phaseSeconds \+ n \* 60 \/ bpm/);
});

test('CLI without --out emits parseable JSON on stdout and draft status for a silent clip', t => {
  const tools = requireMediaTools(t); if (!tools) return;
  const directory = tempDirectory(t);
  const input = join(directory, 'quiet source.wav');
  writeFileSync(input, wav(new Float32Array(sampleRate)));
  const result = runCli([input, '--ffmpeg', tools.ffmpeg]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'draft');
  assert.equal(report.tempo.bpm, null);
});

test('CLI rejects a cut beyond EOF instead of emitting an empty tempo report', t => {
  const tools = requireMediaTools(t); if (!tools) return;
  const directory = tempDirectory(t);
  const input = join(directory, 'one second source.wav');
  writeFileSync(input, wav(pulses(1)));
  const result = runCli([input, '--start', '10', '--duration', '2', '--ffmpeg', tools.ffmpeg]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PCM|起点/);
  assert.equal(result.stdout, '');
});

test('media probes skip missing default tools with a reason and reject explicit bad paths', t => {
  const directory = tempDirectory(t);
  const missing = join(directory, 'missing media tool');
  assert.equal(mediaToolPath('ffmpeg', { FFMPEG_PATH: missing }), missing);
  assert.throws(() => requireMediaTools(t, ['ffmpeg'], { ...process.env, FFMPEG_PATH: missing }), /FFMPEG_PATH.*不可用/);
  assert.throws(() => requireMediaTools(t, ['ffprobe'], { ...process.env, FFPROBE_PATH: missing }), /FFPROBE_PATH.*不可用/);
  assert.throws(() => mediaToolPath('ffmpeg', { FFMPEG_PATH: '' }), /FFMPEG_PATH/);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['PATH', 'FFMPEG_PATH', 'FFPROBE_PATH'].includes(name.toUpperCase())));
  env.PATH = directory;
  let reason;
  const tools = requireMediaTools({ skip: value => { reason = value; } }, ['ffmpeg'], env);
  assert.equal(tools, null);
  assert.match(reason, /ffmpeg.*PATH.*不可用/);
});
