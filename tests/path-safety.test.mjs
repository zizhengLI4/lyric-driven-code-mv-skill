import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoPathAliases } from '../skills/lyric-driven-code-mv/scripts/path-safety.mjs';

test('rejects input/output aliases and duplicate outputs through normalized paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'skill-path-safety-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'storyboard.json');
  await writeFile(input, '{}');

  assert.throws(() => assertNoPathAliases({ inputs: [input], outputs: [input] }), /输出路径与输入文件冲突/);
  assert.throws(() => assertNoPathAliases({ inputs: [input], outputs: [join(root, 'missing', '..', 'storyboard.json')] }), /输出路径与输入文件冲突/);
  assert.throws(() => assertNoPathAliases({ inputs: [], outputs: [join(root, 'evidence.json'), join(root, '.', 'evidence.json')] }), /多个输出路径指向同一文件/);
  assert.doesNotThrow(() => assertNoPathAliases({ inputs: [input], outputs: [join(root, 'evidence.json')] }));

  const hardLink = join(root, 'storyboard-hardlink.json');
  await link(input, hardLink);
  assert.throws(() => assertNoPathAliases({ inputs: [input], outputs: [hardLink] }), /输出路径与输入文件冲突/);
  assert.throws(() => assertNoPathAliases({ inputs: [], outputs: [input, hardLink] }), /多个输出路径指向同一文件/);

  if (process.platform === 'win32') {
    const aliasDirectory = join(root, 'directory-alias');
    await symlink(root, aliasDirectory, 'junction');
    assert.throws(() => assertNoPathAliases({ inputs: [input], outputs: [join(aliasDirectory, 'storyboard.json')] }), /输出路径与输入文件冲突/);
  }
});
