import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFile, mkdir, copyFile} from 'node:fs/promises';
import {WIDTH, HEIGHT} from './frame.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export async function runRemotion(c, assets, mode, output) {
  let cli;
  try {
    const manifest = createRequire(import.meta.url).resolve('@remotion/cli/package.json');
    cli = join(dirname(manifest), 'remotion-cli.js');
  } catch {
    throw new Error('此工程缺少 Remotion 依赖，请在 export.mjs 所在的工程目录按 Remotion 接入说明安装。');
  }
  const studio = mode === 'studio';
  const props = join(assets, 'remotion-props.json');
  const publicDir = join(assets, 'remotion-public');
  await mkdir(publicDir, {recursive:true});
  if (studio) await copyFile(join(assets, 'audio.wav'), join(publicDir, 'audio.wav'));
  await writeFile(props, JSON.stringify({width:studio ? c.width : WIDTH, height:studio ? c.height : HEIGHT,
    fps:c.fps, duration:c.duration, timeline:c.timeline, seed:c.seed, previewAudio:studio}));
  const args = [cli, mode, join(here, 'remotion.jsx')];
  if (!studio) args.push('LyricMV', output);
  args.push('--props=' + props, '--public-dir=' + publicDir);
  if (studio) args.push('--port=' + c.port);
  if (mode === 'render') args.push('--codec=h264', '--crf=1', '--pixel-format=yuv444p', '--image-format=png', '--concurrency=2');
  if (mode === 'still') args.push('--frame=' + Math.floor(c.frameTime * c.fps));
  if (!studio && process.env.REMOTION_BROWSER_EXECUTABLE) args.push('--browser-executable=' + process.env.REMOTION_BROWSER_EXECUTABLE);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {cwd:here, stdio:'inherit', windowsHide:true});
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Remotion 退出码 ' + code)));
  });
}
