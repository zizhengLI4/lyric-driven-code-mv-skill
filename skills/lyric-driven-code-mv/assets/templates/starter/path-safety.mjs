import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

export const pathKey = path => process.platform === 'win32' ? path.toLowerCase() : path;

export function canonicalPath(path) {
  let current = resolve(path);
  const missingParts = [];
  while (true) {
    try {
      return resolve(realpathSync.native(current), ...missingParts.reverse());
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      const parent = dirname(current);
      if (parent === current) return resolve(current, ...missingParts.reverse());
      missingParts.push(basename(current));
      current = parent;
    }
  }
}

function sameFile(first, second) {
  if (pathKey(resolve(first)) === pathKey(resolve(second))) return true;
  try {
    const a = statSync(first), b = statSync(second);
    return a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false;
    throw error;
  }
}

/** Refuse writes that resolve to any input or to another output file. */
export function assertNoPathAliases({ inputs = [], outputs = [] } = {}) {
  for (const path of [...inputs, ...outputs]) {
    if (typeof path !== 'string' || !path.trim()) throw new Error('路径安全检查只接受非空路径');
  }
  const inputByPath = new Map(inputs.map(path => [pathKey(canonicalPath(path)), path]));
  const outputByPath = new Map();
  for (const [index, output] of outputs.entries()) {
    const key = pathKey(canonicalPath(output));
    const input = inputByPath.get(key) ?? inputs.find(candidate => sameFile(candidate, output));
    if (input) throw new Error(`输出路径与输入文件冲突，为避免覆盖输入：${output} ↔ ${input}`);
    const previous = outputByPath.get(key) ?? outputs.slice(0, index).find(candidate => sameFile(candidate, output));
    if (previous) throw new Error(`多个输出路径指向同一文件：${previous} ↔ ${output}`);
    outputByPath.set(key, output);
  }
}
