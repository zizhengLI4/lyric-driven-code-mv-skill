import { spawnSync } from 'node:child_process';

const probes = new Map();

export function mediaToolPath(name, env = process.env) {
  if (!['ffmpeg', 'ffprobe'].includes(name)) throw new Error(`未知媒体工具 ${name}。`);
  const variable = `${name.toUpperCase()}_PATH`;
  const configured = env[variable];
  if (configured === undefined) return name;
  if (typeof configured !== 'string' || !configured.trim()) throw new Error(`${variable} 显式配置不能为空。`);
  return configured;
}

/** Missing default PATH tools skip integrations; an explicitly configured bad path is a test failure. */
export function requireMediaTools(t, names = ['ffmpeg'], env = process.env) {
  const available = {};
  for (const name of names) {
    const path = mediaToolPath(name, env);
    const key = JSON.stringify([path, env.PATH, env.Path]);
    if (!probes.has(key)) {
      const result = spawnSync(path, ['-version'], { shell: false, windowsHide: true, encoding: 'utf8', env, timeout: 10000, maxBuffer: 1024 * 1024 });
      probes.set(key, result.error ? result.error.message : result.status === 0 ? null : `退出码 ${result.status ?? result.signal}`);
    }
    const failure = probes.get(key);
    if (failure !== null) {
      const variable = `${name.toUpperCase()}_PATH`;
      if (env[variable] !== undefined) throw new Error(`${variable} 显式路径 ${path} 不可用：${failure}`);
      t.skip(`需要本机已有 ${name}；PATH 中不可用：${failure}`);
      return null;
    }
    available[name] = path;
  }
  return available;
}
