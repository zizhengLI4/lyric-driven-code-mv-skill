import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const starter = new URL('../skills/lyric-driven-code-mv/assets/templates/starter/', import.meta.url);
const { encodePNG } = await import(new URL('png.mjs', starter));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function makeImage(root, path, index, width, height) {
  const bytes = encodePNG({ width, height, data: new Uint8Array(width * height * 4).fill(index) });
  await writeFile(join(root, path), bytes);
  return { path, sha256: sha(bytes) };
}

export async function writeTestReview(root, storyboard, data, overrides = {}) {
  const sourceEntries = overrides.sources ?? ['frame-core.mjs', 'frame.mjs', 'timeline.mjs', 'export.mjs', 'png.mjs'].map(name => fileURLToPath(new URL(name, starter)));
  const sources = await Promise.all(sourceEntries.map(async path => ({ path, sha256: sha(await readFile(path)) })));
  const scenes = await Promise.all(data.scenes.map(async ({ id }, i) => ({
    id, frame: await makeImage(root, `scene-${i}.png`, 10 + i, data.project.width, data.project.height), decision: 'Test fixture: scene approved',
  })));
  const actors = await Promise.all((data.actors ?? []).map(async ({ id }, i) => ({
    id, wide: await makeImage(root, `wide-${i}.png`, 80 + i, 32, 32),
    close: await makeImage(root, `close-${i}.png`, 120 + i, 32, 32), decision: 'Test fixture: character approved',
  })));
  const record = { schemaVersion: 1, storyboardSha256: sha(await readFile(storyboard)), reviewedAt: '2026-11-23T12:00:00Z', renderSettings: { font: process.platform === 'win32' ? 'Microsoft YaHei' : 'sans-serif' }, sources, scenes, actors };
  const path = join(root, 'visual-review.json');
  await writeFile(path, JSON.stringify(record));
  return { path, record };
}
