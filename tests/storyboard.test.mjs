import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as storyboardValidator from '../skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs';

const { validateStoryboard } = storyboardValidator;
const analyzeStoryboard = (...args) => {
  assert.equal(typeof storyboardValidator.analyzeStoryboard, 'function', 'the analyzer must expose errors separately from creative warnings');
  return storyboardValidator.analyzeStoryboard(...args);
};

const script = fileURLToPath(new URL('../skills/lyric-driven-code-mv/scripts/validate-storyboard.mjs', import.meta.url));

function validStoryboard() {
  const scene = (id, start, end, lyricIds, actor) => ({
    id, start, end, lyricIds,
    meaning: '保存共同的记忆', location: '雪地木屋', objective: '保留礼物',
    action: '把礼物放上搁板', feedback: '显示保留徽标', outcome: '礼物成为纪念物',
    // 事件 HUD 用结构化写法：字符串写法另有专门用例覆盖兼容性。
    actors: [actor], props: ['gift'], events: [{ at: start + 1, action: 'raise-gift', hud: { label: '保留', value: 1, delta: 0 } }],
    exitTransition: 'pixel-wipe',
  });
  return {
    schemaVersion: 1, timebase: 'clip',
    project: {
      fps: 30, duration: 12, sourceOffset: 120, width: 1920, height: 1080,
      virtualWidth: 320, virtualHeight: 180, seed: 'winter-song',
      audio: { path: 'assets/music.wav', timebase: 'source' },
    },
    lyrics: [{ id: 'line-a', start: 1, end: 3, text: '把回忆保留' }, { id: 'line-b', start: 8, end: 12, text: '再次想起你' }],
    music: { status: 'draft', beats: [0, 2, 4, 6, 8, 10], sections: [{ id: 'verse', start: 0, end: 12 }] },
    actors: [{ id: '1p', costumes: ['red-knit', 'winter-coat'] }, { id: '2p', costumes: ['red-knit'] }],
    props: ['gift', 'star'],
    scenes: [scene('keep', 0, 6, ['line-a'], { id: '1p', costume: 'red-knit' }), scene('remember', 6, 12, ['line-b'], { id: '2p', costume: 'red-knit' })],
  };
}

test('accepts a complete clip storyboard while sourceOffset only records the original song offset', () => {
  const data = validStoryboard();
  data.extraNotes = { intentionallyUnknown: true };
  assert.deepEqual(validateStoryboard(data), []);
  data.project.audio.timebase = 'clip';
  assert.deepEqual(validateStoryboard(data), []);
});

test('accepts optional word timings that reconstruct the lyric within its clip interval', () => {
  const data = validStoryboard();
  data.lyrics[0].words = [
    { text: '把', start: 1, end: 1.4 },
    { text: '回忆', start: 1.55, end: 2.2 },
    { text: '保留', start: 2.4, end: 3 },
  ];
  assert.deepEqual(validateStoryboard(data), []);
});

test('rejects invalid word timing arrays, text, order, overlap, and cue bounds', () => {
  const validWords = () => [
    { text: '把', start: 1, end: 1.4 },
    { text: '回忆', start: 1.55, end: 2.2 },
    { text: '保留', start: 2.4, end: 3 },
  ];
  const cases = [
    ['non-array', { text: '把', start: 1, end: 1.4 }],
    ['missing text', [{ text: '', start: 1, end: 1.4 }]],
    ['nonfinite start', [{ text: '把', start: Infinity, end: 1.4 }]],
    ['nonpositive duration', [{ text: '把', start: 1, end: 1 }]],
    ['before cue', [{ text: '把', start: 0.9, end: 1.4 }]],
    ['after cue', [{ text: '把', start: 1, end: 3.1 }]],
    ['mismatched lyric text', [{ text: '留下', start: 1, end: 1.4 }]],
    ['out of order', [
      { text: '把', start: 1.55, end: 2.2 },
      { text: '回忆', start: 1, end: 1.4 },
      { text: '保留', start: 2.4, end: 3 },
    ]],
    ['overlap', [
      { text: '把', start: 1, end: 1.6 },
      { text: '回忆', start: 1.5, end: 2.2 },
      { text: '保留', start: 2.4, end: 3 },
    ]],
  ];
  for (const [name, words] of cases) {
    const data = validStoryboard();
    data.lyrics[0].words = structuredClone(words);
    const errors = validateStoryboard(data);
    assert.ok(errors.some(error => /lyrics\[0\]\.words/.test(error)), `${name}: ${JSON.stringify(errors)}`);
  }
});

test('accepts lyric-free scenes and music sections that do not tile the full clip', () => {
  const data = validStoryboard();
  data.scenes[0].lyricIds = [];
  data.music.sections = [{ id: 'short', start: 2, end: 4 }, { id: 'overlap', start: 3, end: 5 }];
  data.music.beats = [];
  data.music.status = 'illustrative';
  assert.deepEqual(validateStoryboard(data), []);
  data.music.status = 'verified';
  assert.deepEqual(validateStoryboard(data), []);
});

test('accepts a scene seam difference smaller than the 1e-6 coverage tolerance', () => {
  const data = validStoryboard();
  data.scenes[1].start += 5e-7;
  assert.deepEqual(validateStoryboard(data), []);
});

test('rounded interval ends tolerate sub-microsecond differences but real overflow and end beats fail', () => {
  const data = validStoryboard();
  data.project.duration = 4064 / 30;
  data.scenes[1].end = 135.466667;
  data.lyrics[1].end = 135.466667;
  data.music.sections[0].end = 135.466667;
  assert.deepEqual(validateStoryboard(data), []);
  data.lyrics[1].end = data.project.duration + 2e-6;
  assert.ok(validateStoryboard(data).some(e => /lyrics\[1\]\.end/.test(e)));
  data.lyrics[1].end = data.lyrics[1].start;
  assert.ok(validateStoryboard(data).some(e => /start < end/.test(e)));
  data.lyrics[1].start = data.project.duration; data.lyrics[1].end = data.project.duration + 5e-7;
  assert.ok(validateStoryboard(data).some(e => /lyrics\[1\]\.start/.test(e)));
  data.music.beats.push(data.project.duration);
  assert.ok(validateStoryboard(data).some(e => /music\.beats/.test(e)));
});

test('optional audio sha256 must be a complete digest', () => {
  const data = validStoryboard(); data.project.audio.sha256 = 'a'.repeat(64);
  assert.deepEqual(validateStoryboard(data), []);
  data.project.audio.sha256 = 'not-a-hash';
  assert.ok(validateStoryboard(data).some(e => /audio\.sha256/.test(e)));
});

test('rounded scene end does not admit an event at the exclusive clip end', () => {
  const data = validStoryboard(); data.scenes[1].end += 5e-7;
  data.scenes[1].events.push({ at: data.project.duration, action: 'too-late' });
  assert.ok(validateStoryboard(data).some(e => /events\[1\]\.at/.test(e)));
});

test('accepts simultaneous scene events and an event on the following scene start', () => {
  const data = validStoryboard();
  data.scenes[1].events = [{ at: 6, action: 'enter' }, { at: 6, action: 'show-hud', hud: { count: 0 } }];
  assert.deepEqual(validateStoryboard(data), []);
});

// Each case names a real invariant: removing its check must make this assertion fail.
const invalidCases = [
  ['source-time lyric mixed into a 12-second clip', d => { d.lyrics[0].start = 121; d.lyrics[0].end = 123; }, /lyrics\[0\]/],
  ['source-time beat mixed into a 12-second clip', d => { d.music.beats = [120]; }, /music\.beats\[0\]/],
  ['source-time scene event mixed into a 12-second clip', d => { d.scenes[0].events[0].at = 121; }, /scenes\[0\]\.events\[0\]\.at/],
  ['root source timebase', d => { d.timebase = 'source'; }, /timebase/],
  ['wrong schema version', d => { d.schemaVersion = 2; }, /schemaVersion/],
  ['nonpositive fps', d => { d.project.fps = 0; }, /project\.fps/],
  ['infinite duration', d => { d.project.duration = Infinity; }, /project\.duration/],
  ['numeric-string fps', d => { d.project.fps = '30'; }, /project\.fps/],
  ['negative source offset', d => { d.project.sourceOffset = -1; }, /project\.sourceOffset/],
  ['NaN source offset', d => { d.project.sourceOffset = NaN; }, /project\.sourceOffset/],
  ['noninteger output dimension', d => { d.project.width = 1920.5; }, /project\.width/],
  ['zero virtual dimension', d => { d.project.virtualHeight = 0; }, /project\.virtualHeight/],
  ['noninteger pixel scale', d => { d.project.width = 1919; }, /project/],
  ['different integer scales on the two axes', d => { d.project.height = 900; }, /project/],
  ['blank deterministic seed', d => { d.project.seed = ' '; }, /project\.seed/],
  ['blank audio path', d => { d.project.audio.path = ''; }, /project\.audio\.path/],
  ['invalid audio timebase', d => { d.project.audio.timebase = 'song'; }, /project\.audio\.timebase/],
  ['missing audio object', d => { delete d.project.audio; }, /project\.audio/],
  ['duplicate lyric ids', d => { d.lyrics[1].id = 'line-a'; }, /lyrics\[1\]\.id/],
  ['zero-duration lyric', d => { d.lyrics[0].end = d.lyrics[0].start; }, /lyrics\[0\]/],
  ['negative lyric start', d => { d.lyrics[0].start = -1; }, /lyrics\[0\]\.start/],
  ['blank lyric text', d => { d.lyrics[0].text = ' '; }, /lyrics\[0\]\.text/],
  ['beat on exclusive clip end', d => { d.music.beats.push(12); }, /music\.beats\[6\]/],
  ['duplicate beats', d => { d.music.beats = [0, 2, 2]; }, /music\.beats\[2\]/],
  ['descending beats', d => { d.music.beats = [0, 4, 2]; }, /music\.beats\[2\]/],
  ['negative beat', d => { d.music.beats = [-1, 0]; }, /music\.beats\[0\]/],
  ['nonfinite beat', d => { d.music.beats = [NaN]; }, /music\.beats\[0\]/],
  ['invalid analysis status', d => { d.music.status = 'measured'; }, /music\.status/],
  ['section beyond clip duration', d => { d.music.sections[0].end = 13; }, /music\.sections\[0\]/],
  ['reversed section', d => { d.music.sections[0].start = 5; d.music.sections[0].end = 4; }, /music\.sections\[0\]/],
  ['duplicate actor identities', d => { d.actors[1].id = '1p'; }, /actors\[1\]\.id/],
  ['duplicate costume within an actor', d => { d.actors[0].costumes.push('red-knit'); }, /actors\[0\]\.costumes/],
  ['duplicate root prop', d => { d.props.push('gift'); }, /props/],
  ['unknown actor reference', d => { d.scenes[0].actors[0].id = '3p'; }, /scenes\[0\]\.actors\[0\]\.id/],
  ['costume belonging to a different actor', d => { d.scenes[1].actors[0].costume = 'winter-coat'; }, /scenes\[1\]\.actors\[0\]\.costume/],
  ['unknown prop reference', d => { d.scenes[0].props.push('lantern'); }, /scenes\[0\]\.props\[1\]/],
  ['unknown lyric reference', d => { d.scenes[0].lyricIds = ['missing']; }, /scenes\[0\]\.lyricIds\[0\]/],
  ['lyric reference outside scene interval', d => { d.scenes[0].lyricIds = ['line-b']; }, /scenes\[0\]\.lyricIds\[0\]/],
  ['lyric touching but not intersecting a scene end', d => { d.lyrics[0].start = 6; d.lyrics[0].end = 7; }, /scenes\[0\]\.lyricIds\[0\]/],
  ['duplicate scene ids', d => { d.scenes[1].id = 'keep'; }, /scenes\[1\]\.id/],
  ['initial uncovered clip interval', d => { d.scenes[0].start = 0.01; }, /scenes/],
  ['middle uncovered clip interval', d => { d.scenes[1].start = 6.01; }, /scenes/],
  ['overlapping scene intervals', d => { d.scenes[1].start = 5.99; }, /scenes/],
  ['trailing uncovered clip interval', d => { d.scenes[1].end = 11; d.lyrics[1].end = 11; }, /scenes/],
  ['scenes out of chronological order', d => { d.scenes.reverse(); }, /scenes/],
  ['empty scene list cannot cover a positive clip', d => { d.scenes = []; }, /scenes/],
  ['event at preceding scene exclusive end', d => { d.scenes[0].events.push({ at: 6, action: 'leave' }); }, /scenes\[0\]\.events\[1\]\.at/],
  ['event just before scene start without tolerance relaxation', d => { d.scenes[1].events[0].at = 6 - 1e-8; }, /scenes\[1\]\.events\[0\]\.at/],
  ['events out of chronological order', d => { d.scenes[0].events.push({ at: 0.5, action: 'early' }); }, /scenes\[0\]\.events\[1\]\.at/],
  ['blank event action', d => { d.scenes[0].events[0].action = ''; }, /scenes\[0\]\.events\[0\]\.action/],
  ['malformed nested scene entry', d => { d.scenes[0] = null; }, /scenes\[0\]/],
  ['missing required lyric array', d => { delete d.lyrics; }, /lyrics/],
  ['non-numeric interval object in lyric start', d => { d.lyrics[0].start = { valueOf: null, toString: null }; }, /lyrics\[0\]\.start/],
  ['non-numeric interval object in lyric end', d => { d.lyrics[0].end = { valueOf: null, toString: null }; }, /lyrics\[0\]\.end/],
  ['non-numeric interval object in scene start', d => { d.scenes[0].start = { valueOf: null, toString: null }; d.scenes[0].lyricIds = []; }, /scenes\[0\]\.start/],
  ['non-numeric interval object in scene end', d => { d.scenes[0].end = { valueOf: null, toString: null }; d.scenes[0].lyricIds = []; }, /scenes\[0\]\.end/],
];

for (const field of ['meaning', 'location', 'objective', 'action', 'feedback', 'outcome', 'exitTransition']) {
  invalidCases.push([`blank scene ${field}`, d => { d.scenes[0][field] = ' '; }, new RegExp(`scenes\\[0\\]\\.${field}`)]);
}

for (const [name, mutate, expectedPath] of invalidCases) {
  test(`rejects ${name}`, () => {
    const data = validStoryboard();
    mutate(data);
    const errors = validateStoryboard(data);
    assert.ok(Array.isArray(errors) && errors.every(e => typeof e === 'string'));
    assert.ok(errors.some(e => expectedPath.test(e)), `Expected an error for ${expectedPath}; got ${JSON.stringify(errors)}`);
  });
}

test('rejects non-object root data without throwing', () => {
  for (const value of [null, [], 'text', 1]) {
    assert.ok(validateStoryboard(value).length > 0);
  }
});

function runCli(args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined);
  return result;
}

function temporaryJson(t, content) {
  const root = resolve(tmpdir());
  const directory = mkdtempSync(join(root, 'lyric-storyboard-test-'));
  t.after(() => {
    assert.ok(resolve(directory).startsWith(root + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  const path = join(directory, 'storyboard.json');
  writeFileSync(path, content, 'utf8');
  return path;
}

test('CLI accepts a valid UTF-8 JSON file with BOM and exits zero', t => {
  const path = temporaryJson(t, '\uFEFF' + JSON.stringify(validStoryboard()));
  const result = runCli([path]);
  assert.equal(result.status, 0, result.stderr);
});

test('CLI exits one and explains a storyboard range error', t => {
  const data = validStoryboard();
  data.music.beats = [120];
  const result = runCli([temporaryJson(t, JSON.stringify(data))]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /music\.beats\[0\]/);
});

test('CLI reports malformed JSON without a JavaScript stack', t => {
  const result = runCli([temporaryJson(t, '{ "project":')]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JSON/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test('CLI reports malformed time fields as validation errors without a JavaScript stack', t => {
  const data = validStoryboard();
  data.scenes[0].start = { valueOf: null, toString: null };
  data.scenes[0].lyricIds = [];
  const result = runCli([temporaryJson(t, JSON.stringify(data))]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /scenes\[0\]\.start/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test('CLI reports unreadable paths without a JavaScript stack', t => {
  const path = temporaryJson(t, '{}') + '.missing';
  const result = runCli([path]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /读取|read/i);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test('CLI --help prints usage and exits zero', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /用法|usage/i);
});

test('CLI missing or extra input paths print usage and exit one', () => {
  for (const args of [[], ['one.json', 'two.json']]) {
    const result = runCli(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /用法|usage/i);
  }
});

function deliveryStoryboard() {
  const data = validStoryboard();
  Object.assign(data.project.audio, {
    license: 'CC BY 4.0', credit: 'Example artist — Example song',
    url: 'https://example.test/song', licenseUrl: 'https://example.test/license',
    use: 'Include the audio in this music video and publish it with attribution',
  });
  data.music.evidence = { method: 'Listen and align marked attacks', limitations: 'Tempo can drift between the manually checked attacks' };
  data.music.pendingChecks = [{ start: 1, end: 3, check: '核对第一句起止与举礼物动作的峰值是否对应演唱重音' }];
  return data;
}

const warningsAt = (analysis, path) => analysis.warnings.filter(message => message.startsWith(path + ':'));

test('analyzer keeps old valid data compatible and reports missing audio permission as a warning', () => {
  const data = validStoryboard();
  const result = analyzeStoryboard(data);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.every(message => typeof message === 'string'));
  assert.equal(warningsAt(result, 'project.audio').length, 1);
  assert.deepEqual(validateStoryboard(data), []);
});

test('structured exits can replace legacy text and permit all supported creative transitions', () => {
  for (const type of ['cut', 'dissolve', 'ripple', 'water']) {
    const data = validStoryboard();
    delete data.scenes[0].exitTransition;
    data.scenes[0].exit = { type, dur: type === 'cut' ? 0 : 0.75, origin: [0, 1], target: 'remember' };
    assert.deepEqual(validateStoryboard(data), [], type);
  }
});

test('legacy free text exits and structured supplemental exits remain valid', () => {
  const data = validStoryboard();
  data.scenes[0].exitTransition = '随冬日记忆消散，镜头自由留白';
  data.scenes[0].exit = { type: 'dissolve', dur: 0.5 };
  assert.deepEqual(validateStoryboard(data), []);
});

test('the final structured non-cut exit must name the background explicitly', () => {
  const data = validStoryboard();
  data.scenes[1].exit = { type: 'water', dur: 1 };
  assert.ok(validateStoryboard(data).some(message => /scenes\[1\]\.exit\.target/.test(message)));
  data.scenes[1].exit.target = 'background';
  assert.deepEqual(validateStoryboard(data), []);
  data.scenes[1].exit = { type: 'cut', dur: 0 };
  assert.deepEqual(validateStoryboard(data), []);
});

const invalidExitCases = [
  ['an unsupported structured exit type', { type: 'star-wipe', dur: 1 }, /\.type/],
  ['a nonzero cut duration', { type: 'cut', dur: 0.1 }, /\.dur/],
  ['a zero non-cut duration', { type: 'ripple', dur: 0 }, /\.dur/],
  ['a negative non-cut duration', { type: 'ripple', dur: -1 }, /\.dur/],
  ['a non-cut duration equal to scene length', { type: 'water', dur: 6 }, /\.dur/],
  ['a non-cut duration longer than the scene', { type: 'water', dur: 7 }, /\.dur/],
  ['a numeric string exit duration', { type: 'water', dur: '1' }, /\.dur/],
  ['a nonfinite exit duration', { type: 'water', dur: Infinity }, /\.dur/],
  ['an origin outside the normalized frame', { type: 'water', dur: 1, origin: [1.01, 0.5] }, /\.origin/],
  ['a one-dimensional origin', { type: 'water', dur: 1, origin: [0.5] }, /\.origin/],
  ['a nonnumeric origin', { type: 'water', dur: 1, origin: [0.5, '0.5'] }, /\.origin/],
  ['a normal transition to a non-adjacent target', { type: 'dissolve', dur: 1, target: 'keep' }, /\.target/],
  ['a normal transition to background before the final scene', { type: 'dissolve', dur: 1, target: 'background' }, /\.target/],
  ['a malformed structured exit', null, /\.exit/],
  ['a malformed cut target', { type: 'cut', dur: 0, target: {} }, /\.target/],
];

for (const [name, exit, expected] of invalidExitCases) {
  test(`rejects ${name}`, () => {
    const data = validStoryboard();
    data.scenes[0].exit = exit;
    const errors = validateStoryboard(data);
    assert.ok(errors.some(message => message.startsWith('scenes[0].exit') && expected.test(message)), JSON.stringify(errors));
  });
}

test('one lyric crossing a main scene boundary is a warning rather than an error', () => {
  const data = validStoryboard();
  data.lyrics[0].end = 7;
  const result = analyzeStoryboard(data);
  assert.deepEqual(result.errors, []);
  assert.equal(warningsAt(result, 'lyrics[0]').length, 1);
  assert.match(warningsAt(result, 'lyrics[0]')[0], /跨|边界/);
});

test('an intentional lyric split needs both the opt-in and an explanation', () => {
  const data = validStoryboard();
  data.lyrics[0].end = 7;
  data.lyrics[0].allowSceneSplit = true;
  assert.equal(warningsAt(analyzeStoryboard(data), 'lyrics[0]').length, 1);
  data.lyrics[0].splitReason = '用同一行歌词连接记忆与现实';
  assert.equal(warningsAt(analyzeStoryboard(data), 'lyrics[0]').length, 0);
  delete data.lyrics[0].allowSceneSplit;
  assert.equal(warningsAt(analyzeStoryboard(data), 'lyrics[0]').length, 1);
});

test('lyrics touching scene boundaries and tiny tolerated seam gaps do not count as lyric splits', () => {
  const data = validStoryboard();
  data.lyrics[0].end = 6;
  data.lyrics[1].start = 6;
  data.scenes[1].start += 5e-7;
  assert.equal(analyzeStoryboard(data).warnings.filter(message => /^lyrics\[/.test(message)).length, 0);
});

test('beat-synced events report the nearest-grid offset only beyond the tolerance', () => {
  const data = validStoryboard();
  data.scenes[0].events = [
    { at: 2.079, action: 'raise-gift', sync: 'beat' },
    { at: 4.08, action: 'keep-gift', sync: 'beat' },
    { at: 4.081, action: 'lower-gift', sync: 'beat' },
  ];
  const result = analyzeStoryboard(data);
  assert.deepEqual(result.errors, []);
  assert.equal(warningsAt(result, 'scenes[0].events[0].at').length, 0);
  assert.equal(warningsAt(result, 'scenes[0].events[1].at').length, 0);
  assert.match(warningsAt(result, 'scenes[0].events[2].at')[0], /offsetMs=81(?:\D|$)/);
});

test('the caller can choose a beat tolerance and offsets choose the closest beat', () => {
  const data = validStoryboard();
  data.music.beats = [0, 2, 2.2];
  data.scenes[0].events = [{ at: 2.16, action: 'raise-gift', sync: 'beat' }];
  assert.equal(warningsAt(analyzeStoryboard(data), 'scenes[0].events[0].at').length, 0);
  assert.match(warningsAt(analyzeStoryboard(data, { beatToleranceMs: 30 }), 'scenes[0].events[0].at')[0], /offsetMs=-40(?:\D|$)/);
});

test('project beat tolerance setting must be a nonnegative finite number', () => {
  const data = validStoryboard();
  for (const value of [-1, NaN, Infinity, '80']) {
    data.project.settings = { beatToleranceMs: value };
    assert.ok(analyzeStoryboard(data).errors.some(message => message.startsWith('project.settings.beatToleranceMs:')));
  }
  data.project.settings = null;
  assert.ok(analyzeStoryboard(data).errors.some(message => message.startsWith('project.settings:')));
});

test('CLI uses the storyboard beat tolerance setting', t => {
  const data = validStoryboard();
  data.project.settings = { beatToleranceMs: 150 };
  data.scenes[0].events = [{ at: 4.1, action: 'raise-gift', sync: 'beat' }];
  const result = runCli([temporaryJson(t, JSON.stringify(data))]);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /events\[0\]\.at.*offsetMs=100/);
});

test('an empty beat grid warns only on explicitly beat-synced events', () => {
  const data = validStoryboard();
  data.music.beats = [];
  data.scenes[0].events = [{ at: 1, action: 'observe' }, { at: 2, action: 'raise-gift', sync: 'beat' }];
  const result = analyzeStoryboard(data);
  assert.equal(warningsAt(result, 'scenes[0].events[0].at').length, 0);
  assert.match(warningsAt(result, 'scenes[0].events[1].at')[0], /网格|beats/);
});

test('ordinary actions and subtitle timing do not trigger musical sync warnings', () => {
  const data = validStoryboard();
  data.scenes[0].events = [{ at: 1.123, action: 'observe' }, { at: 3.17, action: 'open-caption', sync: 'lyric' }];
  assert.equal(analyzeStoryboard(data).warnings.filter(message => /events\[/.test(message)).length, 0);
});

test('a HUD without lyric support or an event explanation gets a narrative warning', () => {
  const data = validStoryboard();
  data.scenes[0].lyricIds = [];
  const result = analyzeStoryboard(data);
  assert.deepEqual(result.errors, []);
  assert.equal(warningsAt(result, 'scenes[0].events[0].hud').length, 1);
});

test('a lyric-free instrumental HUD can explain its narrative purpose', () => {
  for (const key of ['meaning', 'support']) {
    const data = validStoryboard();
    data.scenes[0].lyricIds = [];
    data.scenes[0].events[0].hud = { count: 0, label: '独行' };
    data.scenes[0].events[0][key] = '间奏中用计数归零表达失落';
    assert.deepEqual(validateStoryboard(data), []);
    assert.equal(warningsAt(analyzeStoryboard(data), 'scenes[0].events[0].hud').length, 0);
  }
});

test('a valid event lyric reference supports the HUD without a scene-level reference', () => {
  const data = validStoryboard();
  data.scenes[0].lyricIds = [];
  data.scenes[0].events[0].lyricIds = ['line-a'];
  assert.deepEqual(validateStoryboard(data), []);
  assert.equal(warningsAt(analyzeStoryboard(data), 'scenes[0].events[0].hud').length, 0);
});

test('an event can refer to a scene lyric before its caption begins', () => {
  const data = validStoryboard();
  data.scenes[0].events = [{ at: 0, action: 'foreshadow', lyricIds: ['line-a'] }];
  assert.deepEqual(validateStoryboard(data), []);
});

test('an event lyric outside its current caption needs an explicit scene-level narrative link', () => {
  const data = validStoryboard();
  data.scenes[0].lyricIds = [];
  data.scenes[0].events = [{ at: 0, action: 'foreshadow', lyricIds: ['line-a'] }];
  assert.ok(validateStoryboard(data).some(message => /^scenes\[0\]\.events\[0\]\.lyricIds\[0\]:/.test(message)));
  data.scenes[0].lyricIds = ['line-a'];
  assert.deepEqual(validateStoryboard(data), []);
});

const invalidEventCases = [
  ['an unknown event lyric', event => { event.lyricIds = ['missing']; }, /\.lyricIds\[0\]/],
  ['an event lyric belonging to another scene', event => { event.lyricIds = ['line-b']; }, /\.lyricIds\[0\]/],
  ['a duplicate event lyric', event => { event.lyricIds = ['line-a', 'line-a']; }, /\.lyricIds\[1\]/],
  ['a malformed event lyric list', event => { event.lyricIds = 'line-a'; }, /\.lyricIds/],
  ['a numeric HUD', event => { event.hud = 1; }, /\.hud/],
  ['an array HUD', event => { event.hud = ['保留']; }, /\.hud/],
  ['a null HUD', event => { event.hud = null; }, /\.hud/],
  ['a blank HUD string', event => { event.hud = ' '; }, /\.hud/],
];

for (const [name, mutate, expected] of invalidEventCases) {
  test(`rejects ${name}`, () => {
    const data = validStoryboard();
    mutate(data.scenes[0].events[0]);
    assert.ok(validateStoryboard(data).some(message => message.startsWith('scenes[0].events[0]') && expected.test(message)));
  });
}

test('delivery requires completed audio permission records but does not infer their legal validity', () => {
  const data = deliveryStoryboard();
  assert.deepEqual(analyzeStoryboard(data, { delivery: true }).errors, []);
  data.project.audio.license = 'A documented custom license';
  data.project.audio.url = 'local contract record #42';
  assert.deepEqual(analyzeStoryboard(data, { delivery: true }).errors, []);
  for (const key of ['license', 'credit', 'url', 'licenseUrl', 'use']) {
    const missing = deliveryStoryboard();
    delete missing.project.audio[key];
    assert.ok(analyzeStoryboard(missing, { delivery: true }).errors.some(message => message.startsWith(`project.audio.${key}:`)), key);
  }
});

test('original audio still needs rights, author credit and intended use but can omit external links', () => {
  const data = deliveryStoryboard();
  data.project.audio.provenance = 'original';
  delete data.project.audio.url;
  delete data.project.audio.licenseUrl;
  assert.deepEqual(analyzeStoryboard(data, { delivery: true }).errors, []);
  assert.equal(warningsAt(analyzeStoryboard(data), 'project.audio').length, 0);
  delete data.project.audio.credit;
  assert.ok(analyzeStoryboard(data, { delivery: true }).errors.some(message => /^project\.audio\.credit:/.test(message)));
});

test('an explicit publication use activates publication permission checks even without a delivery flag', () => {
  for (const use of ['publish', 'public', 'commercial']) {
    const data = validStoryboard();
    data.project.audio.use = use;
    assert.ok(validateStoryboard(data).some(message => /^project\.audio\.license:/.test(message)), use);
  }
});

test('pending and unknown permission declarations remain unresolved for delivery', () => {
  for (const marker of ['unknown', ' Pending ', 'unknown: author has not replied', 'pending confirmation', '未知', '待确认']) {
    const data = deliveryStoryboard();
    data.project.audio.license = marker;
    assert.deepEqual(validateStoryboard(data), []);
    assert.ok(warningsAt(analyzeStoryboard(data), 'project.audio').length);
    assert.ok(analyzeStoryboard(data, { delivery: true }).errors.some(message => /^project\.audio\.license:/.test(message)));
  }
});

test('malformed beat data suppresses misleading grid-distance diagnostics', () => {
  const data = validStoryboard();
  data.music.beats = [0, '2', 4];
  data.scenes[0].events[0].sync = 'beat';
  const result = analyzeStoryboard(data);
  assert.ok(result.errors.some(message => /^music\.beats\[1\]:/.test(message)));
  assert.equal(warningsAt(result, 'scenes[0].events[0].at').length, 0);
});

test('sparse beat arrays cannot crash nearest-beat diagnostics', () => {
  const data = validStoryboard();
  data.music.beats = new Array(2);
  data.scenes[0].events[0].sync = 'beat';
  const result = analyzeStoryboard(data);
  assert.ok(result.errors.some(message => /^music\.beats\[0\]:/.test(message)));
  assert.equal(warningsAt(result, 'scenes[0].events[0].at').length, 0);
});

test('invalid scene seams do not create a spurious main-shot lyric split warning', () => {
  const data = validStoryboard();
  data.lyrics[0].end = 7;
  data.scenes[1].start = 5;
  const result = analyzeStoryboard(data);
  assert.ok(result.errors.length > 0);
  assert.equal(warningsAt(result, 'lyrics[0]').length, 0);
});

test('explicitly verified music needs a reviewer and real ISO timestamp for delivery', () => {
  const data = deliveryStoryboard();
  data.music.status = 'verified';
  assert.deepEqual(validateStoryboard(data), []);
  assert.equal(warningsAt(analyzeStoryboard(data), 'music.evidence').length, 1);
  assert.ok(analyzeStoryboard(data, { delivery: true }).errors.some(message => /^music\.evidence:/.test(message)));
  Object.assign(data.music.evidence, { reviewer: 'Human listener', reviewedAt: '2026-11-17T08:00:00Z' });
  assert.equal(warningsAt(analyzeStoryboard(data), 'music.evidence').length, 0);
  assert.deepEqual(analyzeStoryboard(data, { delivery: true }).errors, []);
  for (const reviewedAt of ['November 17, 2026', '2026-02-30T08:00:00Z', '2026-11-17', '2026-11-17T08:00:00']) {
    data.music.evidence.reviewedAt = reviewedAt;
    assert.ok(warningsAt(analyzeStoryboard(data), 'music.evidence').length, reviewedAt);
    assert.ok(analyzeStoryboard(data, { delivery: true }).errors.some(message => /^music\.evidence:/.test(message)), reviewedAt);
  }
});

test('illustrative music needs an explicit presentation notice for delivery', () => {
  const data = deliveryStoryboard();
  data.music.status = 'illustrative';
  assert.deepEqual(validateStoryboard(data), []);
  assert.equal(warningsAt(analyzeStoryboard(data), 'music.presentationNotice').length, 1);
  assert.ok(analyzeStoryboard(data, { delivery: true }).errors.some(message => /^music\.presentationNotice:/.test(message)));
  data.music.presentationNotice = true;
  assert.equal(warningsAt(analyzeStoryboard(data), 'music.presentationNotice').length, 0);
  assert.deepEqual(analyzeStoryboard(data, { delivery: true }).errors, []);
});

test('draft music can be delivered with a transparent method and limitations without claiming listening verification', () => {
  const data = deliveryStoryboard();
  assert.deepEqual(analyzeStoryboard(data, { delivery: true }).errors, []);
  assert.equal(data.music.status, 'draft');
  assert.equal(data.music.evidence.reviewer, undefined);
  for (const key of ['method', 'limitations']) {
    delete data.music.evidence[key];
    assert.ok(analyzeStoryboard(data, { delivery: true }).errors.some(message => message.startsWith(`music.evidence.${key}:`)), key);
    data.music.evidence[key] = 'Documented';
  }
});

test('ordinary draft validation keeps legacy evidence compatible without a pending-check list', () => {
  const data = deliveryStoryboard();
  delete data.music.pendingChecks;
  const result = analyzeStoryboard(data);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(validateStoryboard(data), []);
});

test('draft delivery requires a nonempty pending-check list with inspectable clip intervals', () => {
  for (const pendingChecks of [undefined, []]) {
    const data = deliveryStoryboard();
    if (pendingChecks === undefined) delete data.music.pendingChecks;
    else data.music.pendingChecks = pendingChecks;
    assert.ok(analyzeStoryboard(data, { delivery: true }).errors.some(message => /^music\.pendingChecks:/.test(message)));
    assert.deepEqual(analyzeStoryboard(data).errors, []);
  }
  const data = deliveryStoryboard();
  assert.deepEqual(analyzeStoryboard(data, { delivery: true }).errors, []);
  data.music.pendingChecks = [{ start: 0, end: 12, check: '完整试听以确认句起止、节拍相位和关键动作落点；目前只有机器推定' }];
  assert.deepEqual(analyzeStoryboard(data, { delivery: true }).errors, []);
});

const invalidPendingCheckCases = [
  ['a pending-check list represented as text', '核对第一句', /music\.pendingChecks:/],
  ['a null pending-check list', null, /music\.pendingChecks:/],
  ['a null pending-check entry', [null], /music\.pendingChecks\[0\]:/],
  ['a pending-check interval before the clip', [{ start: -1, end: 2, check: '核对第一句起点' }], /\.start:/],
  ['a pending-check interval after the clip', [{ start: 1, end: 13, check: '核对末句结束位置' }], /\.end:/],
  ['a source-time pending-check interval', [{ start: 121, end: 123, check: '核对第一句起止' }], /\.end:/],
  ['a reversed pending-check interval', [{ start: 3, end: 1, check: '核对第一句起止' }], /music\.pendingChecks\[0\]:/],
  ['a zero-length pending-check interval', [{ start: 1, end: 1, check: '核对第一句起点' }], /music\.pendingChecks\[0\]:/],
  ['a numeric-string pending-check interval', [{ start: '1', end: 3, check: '核对第一句起止' }], /\.start:/],
  ['a nonfinite pending-check interval', [{ start: 1, end: Infinity, check: '核对第一句起止' }], /\.end:/],
  ['a missing description of the unconfirmed check', [{ start: 1, end: 3 }], /\.check:/],
  ['a blank description of the unconfirmed check', [{ start: 1, end: 3, check: ' ' }], /\.check:/],
  ['a nontext description of the unconfirmed check', [{ start: 1, end: 3, check: {} }], /\.check:/],
];

for (const [name, pendingChecks, expected] of invalidPendingCheckCases) {
  test(`rejects ${name} in both ordinary and delivery validation`, () => {
    const data = deliveryStoryboard();
    data.music.pendingChecks = pendingChecks;
    for (const options of [{}, { delivery: true }]) {
      const result = analyzeStoryboard(data, options);
      assert.ok(result.errors.some(message => message.startsWith('music.pendingChecks') && expected.test(message)), JSON.stringify(result.errors));
    }
  });
}

test('pending-check descriptions reject pure placeholders while accepting concrete unconfirmed content', () => {
  for (const check of ['待核对', ' 待确认。 ', '未核对', '没核对', 'pending', ' UNKNOWN! ', 'tbd']) {
    const data = deliveryStoryboard();
    data.music.pendingChecks[0].check = check;
    assert.ok(analyzeStoryboard(data, { delivery: true }).errors.some(message => /^music\.pendingChecks\[0\]\.check:/.test(message)), check);
  }
  const data = deliveryStoryboard();
  data.music.pendingChecks[0].check = '待核对第一句的尾音是否应在转场开始前结束';
  assert.deepEqual(analyzeStoryboard(data, { delivery: true }).errors, []);
});

test('a sparse pending-check list produces diagnostics rather than silently satisfying draft delivery', () => {
  const data = deliveryStoryboard();
  data.music.pendingChecks = new Array(1);
  assert.ok(analyzeStoryboard(data, { delivery: true }).errors.some(message => /^music\.pendingChecks\[0\]:/.test(message)));
});

test('non-draft delivery does not require pending checks, and publication use activates draft delivery requirements', () => {
  const data = deliveryStoryboard();
  delete data.music.pendingChecks;
  data.music.status = 'illustrative';
  data.music.presentationNotice = true;
  assert.deepEqual(analyzeStoryboard(data, { delivery: true }).errors, []);
  data.music.status = 'verified';
  Object.assign(data.music.evidence, { reviewer: 'Human listener', reviewedAt: '2026-11-17T08:00:00Z' });
  assert.deepEqual(analyzeStoryboard(data, { delivery: true }).errors, []);
  data.music.status = 'draft';
  data.project.audio.use = 'publish';
  assert.ok(analyzeStoryboard(data).errors.some(message => /^music\.pendingChecks:/.test(message)));
});

test('malformed optional records and invalid timing inputs never crash analyzer diagnostics', () => {
  const cases = [null, [], { project: null }, ...[
    d => { d.scenes[0].exit = { type: 'water', dur: { valueOf: null }, origin: [null, {}] }; },
    d => { d.lyrics[0].end = { valueOf: null, toString: null }; },
    d => { d.scenes[1].start = { valueOf: null, toString: null }; },
    d => { d.music.beats = [null, {}, '2']; d.scenes[0].events[0].sync = 'beat'; },
    d => { d.music.evidence = []; },
    d => { d.project.audio.license = { valueOf: null, toString: null }; },
    d => { d.scenes[0].events[0] = null; },
    d => { d.scenes[0].events[0].lyricIds = [null, {}]; },
    d => { d.chapters = null; },
  ].map(mutate => { const data = validStoryboard(); mutate(data); return data; })];
  for (const data of cases) {
    const result = analyzeStoryboard(data, { delivery: true });
    assert.ok(Array.isArray(result.errors) && Array.isArray(result.warnings));
    assert.ok(result.errors.length, JSON.stringify(data));
  }
});

test('CLI prints warnings while the default successful exit code still depends only on errors', t => {
  const result = runCli([temporaryJson(t, JSON.stringify(validStoryboard()))]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /警告.*project\.audio/);
  assert.match(result.stdout, /校验通过/);
});

test('CLI strict mode fails on warnings and succeeds when every warning is addressed', t => {
  const warned = runCli(['--strict', temporaryJson(t, JSON.stringify(validStoryboard()))]);
  assert.equal(warned.status, 1);
  assert.match(warned.stderr, /警告.*project\.audio/);
  const clean = runCli([temporaryJson(t, JSON.stringify(deliveryStoryboard())), '--strict']);
  assert.equal(clean.status, 0, clean.stderr);
});

test('CLI delivery mode fails incomplete rights and accepts transparent draft evidence', t => {
  const incomplete = runCli(['--delivery', temporaryJson(t, JSON.stringify(validStoryboard()))]);
  assert.equal(incomplete.status, 1);
  assert.match(incomplete.stderr, /project\.audio\.license/);
  const complete = runCli(['--delivery', temporaryJson(t, JSON.stringify(deliveryStoryboard()))]);
  assert.equal(complete.status, 0, complete.stderr);
});

test('CLI strict is a warning policy and does not require draft delivery evidence or upgrade music status', t => {
  const data = deliveryStoryboard();
  delete data.music.pendingChecks;
  const path = temporaryJson(t, JSON.stringify(data));
  const ordinaryStrict = runCli(['--strict', path]);
  assert.equal(ordinaryStrict.status, 0, ordinaryStrict.stderr);
  assert.equal(data.music.status, 'draft');
  const deliveryStrict = runCli(['--strict', '--delivery', path]);
  assert.equal(deliveryStrict.status, 1);
  assert.match(deliveryStrict.stderr, /music\.pendingChecks/);
});

test('CLI rejects unknown options and still validates the number of paths', () => {
  for (const args of [['--magic', 'one.json'], ['--strict'], ['--delivery', 'one.json', 'two.json']]) {
    const result = runCli(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /用法|usage/i);
  }
});

test('accepts optional story devices, contiguous chapters, material variants and semantic HUD entries', () => {
  const data = validStoryboard();
  data.device = {
    id: 'save-console', type: 'game-system', name: '存档系统',
    purpose: '把关系状态呈现为可操作界面',
  };
  data.chapters = [
    { id: 'chapter-1', start: 0, end: 6, title: '第一次发送', meaning: '主动靠近' },
    { id: 'chapter-2', start: 6, end: 12, title: '收到回光', meaning: '关系留下回应' },
  ];
  data.scenes[0].materialVariant = {
    id: 'winter', label: '冬季材质', change: '雪材质替换，机位保持不变',
  };
  data.scenes[0].hud = [
    { id: 'mood', type: 'bar', label: '心情', value: 56, min: 0, max: 100, meaning: '行动后的情绪反馈' },
    { id: 'heartbreak', type: 'bar', label: '心碎', value: -56, min: -100, max: 0, meaning: '关系受挫后的负向状态' },
    { id: 'save-status', type: 'status', label: '存档', value: '已保存', meaning: '任务结果已写入系统' },
  ];
  assert.deepEqual(validateStoryboard(data), []);
});

test('validates optional integrated pixel caption style', () => {
  const data = validStoryboard();
  data.captionStyle = {
    mode: 'scene-panel', placement: 'integrated', lines: 2,
    primary: { color: '#FFF1D6', outline: '#E56B7A', shadow: '#24152B' },
    secondary: { color: '#F3C8C7' },
    panel: { color: '#24152B', alpha: 0.88, border: '#F0A06D', accent: '#FFD58A' },
    chapter: { show: true, position: 'top', duration: 2.4 },
  };
  assert.deepEqual(validateStoryboard(data), []);
  for (const [field, value] of [['mode', 'unknown'], ['lines', 3], ['panel', { alpha: 2 }], ['primary', { color: 'white' }]]) {
    const copy = structuredClone(data);
    copy.captionStyle[field] = value;
    assert.ok(validateStoryboard(copy).some(message => message.startsWith(`captionStyle.${field}`) || message.startsWith('captionStyle')), field);
  }
});

test('rejects invalid chapter coverage, unknown device types and HUDs without semantic meaning', () => {
  const data = validStoryboard();
  data.device = { id: 'x', type: 'unknown-device', name: '装置', purpose: '用途' };
  data.chapters = [
    { id: 'a', start: 0, end: 7, title: 'A', meaning: '一' },
    { id: 'a', start: 6, end: 12, title: 'B', meaning: '二' },
  ];
  data.scenes[0].hud = [{ id: 'count', type: 'counter', label: '次数', value: 2 }];
  const errors = validateStoryboard(data);
  assert.ok(errors.some(message => /device\.type/.test(message)));
  assert.ok(errors.some(message => /chapters\[1\]\.id/.test(message)));
  assert.ok(errors.some(message => /chapters.*不得有空洞或重叠/.test(message)));
  assert.ok(errors.some(message => /scenes\[0\]\.hud\[0\]\.meaning/.test(message)));
});

test('requires supplied chapters to be nonempty and checks sparse chapter entries', () => {
  const empty = validStoryboard();
  empty.chapters = [];
  assert.ok(validateStoryboard(empty).some(message => /^chapters:/.test(message)));

  const sparse = validStoryboard();
  sparse.chapters = [
    { id: 'opening', start: 0, end: 12, title: '开始', meaning: '建立故事' },
    ,
  ];
  assert.ok(validateStoryboard(sparse).some(message => /chapters\[1\].*必须为对象/.test(message)));
});

test('rejects HUD values that are outside a declared bar range or have unsupported types', () => {
  const data = validStoryboard();
  data.scenes[0].hud = [
    { id: 'mood', type: 'bar', label: '心情', value: 101, min: 0, max: 100, meaning: '行动反馈' },
    { id: 'counter', type: 'counter', label: '次数', value: { count: 2 }, meaning: '重复行动' },
  ];
  const errors = validateStoryboard(data);
  assert.ok(errors.some(message => /scenes\[0\]\.hud\[0\].*value.*min.*max/.test(message)));
  assert.ok(errors.some(message => /scenes\[0\]\.hud\[1\]\.value/.test(message)));
});

// ── 事件 HUD：结构化读数 ──────────────────────────────────────────────
// 旧写法（字符串、自由对象）继续通过；结构化对象 {label,unit?,value,delta?,broken?}
// 逐字段校验，负向状态用数值判定（delta < 0 或 broken: true），不再靠中文词猜测。

function structuredHudStoryboard() {
  const data = validStoryboard();
  data.scenes[0].events = [
    { at: 1, action: 'raise-gift', hud: { label: '好感度', unit: '%', value: 70, delta: -30 } },
    { at: 2, action: 'save-fail', hud: { label: '存档', value: '已损坏', broken: true } },
  ];
  return data;
}

test('accepts structured event HUD objects with label, unit, value, delta and broken', () => {
  assert.deepEqual(validateStoryboard(structuredHudStoryboard()), []);
  const states = analyzeStoryboard(structuredHudStoryboard()).hudStates;
  assert.ok(Array.isArray(states), 'analyzer must expose the numeric HUD reading it used');
  const readings = states.filter(state => state.path.startsWith('scenes[0]'));
  assert.deepEqual(readings.map(state => state.path), ['scenes[0].events[0].hud', 'scenes[0].events[1].hud']);
  assert.deepEqual(readings.map(state => [state.label, state.unit, state.value, state.delta, state.broken]), [
    ['好感度', '%', 70, -30, undefined],
    ['存档', undefined, '已损坏', undefined, true],
  ]);
});

test('decides negative HUD states from numbers instead of Chinese wording', () => {
  const data = validStoryboard();
  data.scenes[0].events = [
    { at: 1, action: 'drop', hud: { label: '好感度', value: 40, delta: -30 } },
    { at: 2, action: 'rise', hud: { label: '神选度', unit: '%', value: 12, delta: 4 } },
    { at: 3, action: 'break', hud: { label: '存档', value: '已损坏', broken: true } },
    { at: 4, action: 'legacy-text', hud: '好感度 -30' },
    { at: 5, action: 'legacy-object', hud: { count: 0 } },
  ];
  const { errors, hudStates } = analyzeStoryboard(data);
  assert.deepEqual(errors, []);
  const states = hudStates.filter(state => state.path.startsWith('scenes[0]'));
  assert.deepEqual(states.map(state => state.mode), ['structured', 'structured', 'structured', 'string', 'freeform']);
  // 只有结构化读数能给出负向结论；文案里的“-30”不构成判据。
  assert.deepEqual(states.map(state => state.negative), [true, false, true, null, null]);
});

test('rejects malformed structured event HUD fields with located diagnostics', () => {
  const cases = [
    ['a structured HUD without a label', { value: 1, delta: -2 }, /events\[0\]\.hud\.label/],
    ['a blank structured HUD label', { label: ' ', value: 1, delta: -2 }, /events\[0\]\.hud\.label/],
    ['a structured HUD without a value', { label: '好感度', delta: -2 }, /events\[0\]\.hud\.value/],
    ['a blank structured HUD value', { label: '好感度', value: '  ' }, /events\[0\]\.hud\.value/],
    ['a nonnumeric HUD delta', { label: '好感度', value: 1, delta: 'minus' }, /events\[0\]\.hud\.delta/],
    ['a nonfinite HUD delta', { label: '好感度', value: 1, delta: Infinity }, /events\[0\]\.hud\.delta/],
    ['a nonboolean HUD broken flag', { label: '存档', value: '损坏', broken: 'yes' }, /events\[0\]\.hud\.broken/],
    ['a blank HUD unit', { label: '神选度', value: 12, unit: ' ' }, /events\[0\]\.hud\.unit/],
    ['a HUD object that only declares a delta', { delta: -1 }, /events\[0\]\.hud/],
  ];
  for (const [name, hud, expected] of cases) {
    const data = validStoryboard();
    data.scenes[0].events = [{ at: 2, action: 'raise-gift', hud }];
    const errors = validateStoryboard(data);
    assert.ok(errors.some(message => expected.test(message)), `${name}: ${JSON.stringify(errors)}`);
  }
});

test('keeps legacy string and free-form HUD events valid while warning once about numeric migration', () => {
  const data = validStoryboard();
  data.scenes[0].events = [{ at: 2, action: 'raise-gift', hud: '好感度 -30' }];
  data.scenes[1].events = [{ at: 8, action: 'open-save', hud: '存档 损坏' }];
  const result = analyzeStoryboard(data);
  assert.deepEqual(result.errors, []);
  const migration = warningsAt(result, 'events[*].hud');
  assert.equal(migration.length, 1, JSON.stringify(result.warnings));
  assert.match(migration[0], /结构化|迁移/);
  assert.match(migration[0], /label/);
  // 一个对象读数出现后，迁移提示消失。
  data.scenes[0].events.push({ at: 3, action: 'read', hud: { label: '好感度', value: 40, delta: -30 } });
  assert.equal(warningsAt(analyzeStoryboard(data), 'events[*].hud').length, 0);
});

test('negative structured HUD states are reported with their numeric evidence', () => {
  const data = validStoryboard();
  data.scenes[0].lyricIds = [];
  data.scenes[0].events = [{ at: 2, action: 'drop', hud: { label: '好感度', value: 40, delta: -30 } }];
  const negative = warningsAt(analyzeStoryboard(data), 'scenes[0].events[0].hud');
  assert.equal(negative.length, 1);
  assert.match(negative[0], /delta=-?30|下降/);
  // 文案里带减号但不带数值依据时，不给数值结论。
  data.scenes[0].events = [{ at: 2, action: 'drop', hud: '好感度 下降' }];
  const textual = warningsAt(analyzeStoryboard(data), 'scenes[0].events[0].hud');
  assert.equal(textual.length, 1);
  assert.doesNotMatch(textual[0], /delta=/);
});

// ── 字幕单行长度（按显示宽度，不是字符数）────────────────────────────
test('warns when one subtitle line exceeds 22 full-width characters', () => {
  const data = validStoryboard();
  data.lyrics[0].text = '一二三四五六七八九十一二三四五六七八九十一二';
  let result = analyzeStoryboard(data);
  assert.deepEqual(result.errors, []);
  assert.equal(warningsAt(result, 'lyrics[0].text').length, 0, '22 个全角字宽是上限而不是错误');
  data.lyrics[0].text = '一二三四五六七八九十一二三四五六七八九十一二三';
  result = analyzeStoryboard(data);
  assert.deepEqual(result.errors, []);
  assert.match(warningsAt(result, 'lyrics[0].text')[0], /23 个全角字宽.*拆成两行/);
  // 空白不计数。
  data.lyrics[0].text = ' 一二三四五六七八九十一二 三四五六七八九十一二三 ';
  assert.match(warningsAt(analyzeStoryboard(data), 'lyrics[0].text')[0], /23 个全角字宽/);
  // 空白撑到 22 字以上但实际字符不足时不提示。
  data.lyrics[0].text = '一二三四五六七八九十一二     三四五六七八九十一二';
  assert.equal(warningsAt(analyzeStoryboard(data), 'lyrics[0].text').length, 0);
});

test('counts ASCII as half width so English subtitles are not falsely flagged', () => {
  const data = validStoryboard();
  // 一行 40 个半角字符 = 20 个全角宽，排得下；按字符数会被误判成 40 字超限。
  data.lyrics[0].text = 'You said to me I am not what you see';
  let result = analyzeStoryboard(data);
  assert.deepEqual(result.errors, []);
  assert.equal(warningsAt(result, 'lyrics[0].text').length, 0, '40 个半角字符只占 20 个全角宽');
  // 中英混排按各自宽度累加：10 汉字 + 18 半角 = 19 宽，仍在上限内。
  data.lyrics[0].text = '一二三四五六七八九十 you never know';
  assert.equal(warningsAt(analyzeStoryboard(data), 'lyrics[0].text').length, 0);
  // 再补 8 个汉字 → 18 汉字 + 12 半角 = 24 宽，超限。
  data.lyrics[0].text = '一二三四五六七八九十一二三四五六七八 you never know';
  assert.match(warningsAt(analyzeStoryboard(data), 'lyrics[0].text')[0], /24 个全角字宽/);
  // 真正的超长英文仍要告警：80 个半角 = 40 宽。
  data.lyrics[0].text = 'You said to me I am not what you see and I am moving on somebody else can give you more';
  assert.equal(warningsAt(analyzeStoryboard(data), 'lyrics[0].text').length, 1);
});

// ── lyricsMeta 歌词溯源 ───────────────────────────────────────────────
function lyricsMetaStoryboard() {
  const data = validStoryboard();
  data.lyricsMeta = {
    source: 'netease-lrc', ref: '3410245671',
    fetchedAt: '2026-11-17T14:45:00+08:00', proofread: true,
  };
  return data;
}

test('accepts optional lyric provenance metadata and warns when it was not proofread', () => {
  assert.deepEqual(validateStoryboard(lyricsMetaStoryboard()), []);
  assert.equal(warningsAt(analyzeStoryboard(lyricsMetaStoryboard()), 'lyricsMeta').length, 0);
  const data = lyricsMetaStoryboard();
  data.lyricsMeta.proofread = false;
  const result = analyzeStoryboard(data);
  assert.deepEqual(result.errors, []);
  const warning = warningsAt(result, 'lyricsMeta.proofread');
  assert.equal(warning.length, 1);
  assert.match(warning[0], /试听/);
});

const invalidLyricsMetaCases = [
  ['a lyricsMeta written as text', 'netease-lrc', /^lyricsMeta: 必须为对象/],
  ['a lyricsMeta written as an array', [{ source: 'netease-lrc' }], /^lyricsMeta: 必须为对象/],
  ['a null lyricsMeta', null, /^lyricsMeta: 必须为对象/],
  ['a missing lyric source', { fetchedAt: '2026-11-17T14:45:00+08:00', proofread: false }, /^lyricsMeta\.source:/],
  ['a blank lyric source', { source: ' ', fetchedAt: '2026-11-17T14:45:00+08:00', proofread: false }, /^lyricsMeta\.source:/],
  ['a missing fetch time', { source: 'netease-lrc', proofread: false }, /^lyricsMeta\.fetchedAt:/],
  ['a blank fetch time', { source: 'netease-lrc', fetchedAt: ' ', proofread: false }, /^lyricsMeta\.fetchedAt:/],
  ['a nonboolean proofread flag', { source: 'netease-lrc', fetchedAt: '2026-11-17T14:45:00+08:00', proofread: 'no' }, /^lyricsMeta\.proofread:/],
  ['a nontext lyric reference', { source: 'netease-lrc', fetchedAt: '2026-11-17T14:45:00+08:00', proofread: true, ref: 42 }, /^lyricsMeta\.ref:/],
];

for (const [name, lyricsMeta, expected] of invalidLyricsMetaCases) {
  test(`rejects ${name} with a located diagnostic instead of crashing`, () => {
    const data = validStoryboard();
    data.lyricsMeta = lyricsMeta;
    const result = analyzeStoryboard(data);
    assert.ok(result.errors.some(message => expected.test(message)), JSON.stringify(result.errors));
  });
}

// ── 装置集合与章节引用 ────────────────────────────────────────────────
function devicesStoryboard() {
  const data = validStoryboard();
  data.devices = [
    { id: 'city-system', type: 'game-system', name: '城市地图系统', purpose: '把路线与邀请状态呈现为可读状态' },
    { id: 'save-load', type: 'game-system', name: '读档界面', purpose: '第二个阶段换成读档提示' },
  ];
  data.chapters = [
    { id: 'send-chapter', start: 0, end: 6, title: '第一次发送', meaning: '主动靠近', deviceId: 'city-system' },
    { id: 'load-chapter', start: 6, end: 12, title: '读档回看', meaning: '回看未抵达', deviceId: 'save-load' },
  ];
  return data;
}

test('accepts devices[] with stable ids and chapter device references', () => {
  const data = devicesStoryboard();
  assert.deepEqual(validateStoryboard(data), []);
  assert.equal(analyzeStoryboard(data).warnings.filter(message => /deviceId/.test(message)).length, 0);
});

test('keeps one legacy device usable as the effective device set', () => {
  const data = validStoryboard();
  data.device = { id: 'save-console', type: 'game-system', name: '存档系统', purpose: '把关系状态呈现为可操作界面' };
  data.chapters = [
    { id: 'chapter-1', start: 0, end: 6, title: '第一次发送', meaning: '主动靠近', deviceId: 'save-console' },
    { id: 'chapter-2', start: 6, end: 12, title: '收到回光', meaning: '关系留下回应', deviceId: 'save-console' },
  ];
  const result = analyzeStoryboard(data);
  assert.deepEqual(result.errors, []);
  const hint = warningsAt(result, 'chapters[1].deviceId');
  assert.equal(hint.length, 1, JSON.stringify(result.warnings));
  assert.match(hint[0], /章节牌/);
});

test('rejects a chapter deviceId outside the effective device set', () => {
  const unknown = devicesStoryboard();
  unknown.chapters[1].deviceId = 'unknown-device';
  const errors = validateStoryboard(unknown);
  assert.ok(errors.some(message => /^chapters\[1\]\.deviceId:.*unknown-device/.test(message)), JSON.stringify(errors));
  const declared = validStoryboard();
  declared.chapters = [{ id: 'only', start: 0, end: 12, title: '全片', meaning: '单章', deviceId: 'river-system' }];
  assert.ok(validateStoryboard(declared).some(message => /^chapters\[0\]\.deviceId:/.test(message)));
});

test('rejects malformed device collections while keeping the single-device diagnostics', () => {
  const cases = [
    ['devices written as one object', { id: 'x', type: 'game-system', name: '装置', purpose: '用途' }, /^devices: 必须为数组/],
    ['an empty devices list', [], /^devices:/],
    ['a device entry without an id', [{ type: 'game-system', name: '装置', purpose: '用途' }], /^devices\[0\]\.id:/],
    ['duplicate device ids', [{ id: 'same', type: 'game-system', name: '甲', purpose: '用途' }, { id: 'same', type: 'game-system', name: '乙', purpose: '用途' }], /^devices\[1\]\.id:/],
    ['an unsupported device type in devices[]', [{ id: 'x', type: 'plugin', name: '装置', purpose: '用途' }], /^devices\[0\]\.type:/],
    ['a sparse device entry', [null], /^devices\[0\]: 必须为对象/],
  ];
  for (const [name, devices, expected] of cases) {
    const data = validStoryboard();
    data.devices = devices;
    const errors = validateStoryboard(data);
    assert.ok(errors.some(message => expected.test(message)), `${name}: ${JSON.stringify(errors)}`);
  }
});

// ── 示例分镜：严格单镜 24 秒 + 三次可读变化 ─────────────────────────
// 示例是新手最先复制的东西，所以它自己必须示范「长镜头靠变化密度成立」：
// 一镜 0–24 秒，靠 1 次 HUD 下降 + 2 次字幕换行撑住可读性。
// 需要多镜的测试自己从第一镜派生 fixture，不反过来要求示例保住第二个镜。
test('the shipped example carries a 24-second main shot whose readability comes from three changes', () => {
  const example = JSON.parse(readFileSync(
    new URL('../skills/lyric-driven-code-mv/assets/storyboard-example.json', import.meta.url), 'utf8',
  ));
  for (const key of ['project', 'music', 'lyrics', 'scenes', 'chapters', 'actors', 'props', 'device']) {
    assert.ok(example[key] !== undefined, `示例必须保留必填字段 ${key}`);
  }
  assert.equal(example.scenes.length, 1, '示例必须是严格单镜；多镜示范会自相矛盾');
  const [main] = example.scenes;
  assert.deepEqual([main.id, main.start, main.end], ['send', 0, 24], '主镜必须是 24 秒一镜，而不是几个短镜');
  const hudEvents = main.events.filter(event => event.hud !== undefined);
  assert.equal(hudEvents.length, 1, '主镜里 HUD 只变一次');
  assert.equal(typeof hudEvents[0].hud, 'object');
  assert.equal(typeof hudEvents[0].hud.delta, 'number');
  const onScreen = example.lyrics.filter(line => line.start < main.end);
  assert.equal(onScreen.length, 3, '字幕换两行需要三行；第一行建立基线');
  assert.deepEqual(onScreen.map(line => line.start), [0.8, 9, 17.2]);
  // 三次可读变化：HUD 下降一次 + 字幕换行两次。
  const changes = [...hudEvents.map(event => event.at), ...onScreen.slice(1).map(line => line.start)].sort((a, b) => a - b);
  assert.deepEqual(changes, [4.5, 9, 17.2]);
  assert.equal(example.lyricsMeta, undefined, '示例不伪造歌词校对记录');
  // 收尾必须落在 24 秒上：duration、章节、段落、拍点都不能越过主镜。
  assert.equal(example.project.duration, 24);
  assert.equal(example.chapters.at(-1).end, 24);
  assert.equal(example.music.sections.at(-1).end, 24);
  assert.ok(example.music.beats.every(beat => beat < 24), '拍点不能越过成片时长');
  const analysis = analyzeStoryboard(example);
  assert.deepEqual(analysis.errors, []);
  assert.deepEqual(analysis.warnings, [], '示例必须能通过 --strict，不能自带警告');
});
