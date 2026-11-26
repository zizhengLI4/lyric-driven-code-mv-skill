import { spawnSync } from 'node:child_process';

export function checkMediaTools(ffmpeg, ffprobe, run = spawnSync, { subtitles = true, encoding = true } = {}) {
  const checks = [];
  const record = (name, ok, detail, fix) => checks.push({
    name, required: true, ok, detail, ...(ok ? {} : { fix }),
  });
  const probe = (binary, args) => {
    const result = run(binary, args, { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
    return result.status === 0 && !result.error
      ? { output: (result.stdout ?? '') + (result.stderr ?? '') }
      : { error: result.error?.message ?? (result.stderr?.trim() || `退出 ${result.status}`) };
  };
  if (ffmpeg) {
    const filters = subtitles ? probe(ffmpeg, ['-hide_banner', '-filters']) : null;
    const encoders = encoding && !filters?.error ? probe(ffmpeg, ['-hide_banner', '-encoders']) : null;
    const ffmpegError = filters?.error ?? encoders?.error
      ?? (!subtitles && !encoding ? probe(ffmpeg, ['-version']).error : undefined);
    record('ffmpeg', !ffmpegError, ffmpegError || 'FFmpeg 可运行', '确保 ffmpeg 可从 PATH 运行，或设置 FFMPEG_PATH。');
    if (filters?.output !== undefined) {
      const hasASS = /\bass\s+V->V/.test(filters.output);
      record('libass', hasASS, hasASS ? '支持 ASS 滤镜' : 'FFmpeg 缺少 libass 的 ass 滤镜，字幕无法烧录',
        '使用带 libass 的 FFmpeg 构建，或设置 FFMPEG_PATH。');
    }
    if (encoders?.output !== undefined) {
      for (const name of ['libx264', 'aac']) {
        const found = encoders.output.split(/\r?\n/).some(line => line.trim().split(/\s+/)[1] === name);
        record(name, found, found ? `支持 ${name} 编码器` : `FFmpeg 缺少 ${name} 编码器`,
          `使用带 ${name} 的 FFmpeg 构建，或设置 FFMPEG_PATH。`);
      }
    }
  }
  if (ffprobe) {
    const probeVersion = probe(ffprobe, ['-version']);
    record('ffprobe', !probeVersion.error, probeVersion.error ?? probeVersion.output.trim().split(/\r?\n/)[0],
      '确保 ffprobe 可以从 PATH 运行，或设置 FFPROBE_PATH。');
  }
  return checks;
}
