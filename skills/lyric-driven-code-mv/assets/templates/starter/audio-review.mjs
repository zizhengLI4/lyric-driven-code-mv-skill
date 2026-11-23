import { spawn } from 'node:child_process';

export async function decodePcm(ffmpeg, audioPath, sampleRate, channels = 1, duration) {
  const trim = duration === undefined ? [] : ['-t', String(duration)];
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-v', 'error', '-i', audioPath, '-map', '0:a:0', ...trim, '-ac', String(channels), '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1'], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    let size = 0, stderr = '';
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 512 * 1024 * 1024) {
        child.kill();
        reject(new Error('解码PCM超过512MiB限制'));
      } else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
    child.once('error', error => reject(new Error('ffmpeg 解码无法启动：' + error.message)));
    child.once('close', (code, signal) => {
      if (code !== 0) return reject(new Error('ffmpeg 解码失败：' + (stderr.trim() || code || signal)));
      const bytes = Buffer.concat(chunks);
      if (bytes.length % (4 * channels)) return reject(new Error('ffmpeg 返回了不完整的交错 PCM 样本'));
      const samples = new Float32Array(bytes.length / 4);
      for (let i = 0; i < samples.length; i++) samples[i] = bytes.readFloatLE(i * 4);
      resolve(samples);
    });
  });
}

function decodeTruePeak(ffmpeg, audioPath, duration) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, [
      '-hide_banner', '-nostats', '-i', audioPath, '-map', '0:a:0', '-t', String(duration), '-af',
      'ebur128=peak=true:framelog=verbose', '-f', 'null', '-',
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.once('error', reject);
    child.once('close', code => {
      const peak = stderr.match(/True peak:\s*Peak:\s*([-+]?(?:\d+(?:\.\d+)?|inf))\s*dBFS/i);
      if (code !== 0 || !peak) return reject(new Error('最终音轨真峰值测量失败：' + stderr.trim()));
      resolve(Number.isFinite(Number(peak[1])) ? Number(peak[1]) : null);
    });
  });
}

const db = rms => rms > 0 ? Number((20 * Math.log10(rms)).toFixed(2)) : null;

export function stereoCueLevels({ events, mixed, music, stem, sampleRate, duration, windowMs = 80, stemGain = 1, quietDbfs = -55 }) {
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || !Number.isFinite(duration) || duration <= 0 ||
      !Number.isFinite(windowMs) || windowMs <= 0 || !Number.isFinite(stemGain) || stemGain < 0 ||
      !Number.isFinite(quietDbfs)) throw new Error('音效电平报告的采样率、时长、窗口或权重无效');
  const tracks = stem ? [mixed, music, stem] : [mixed, music];
  if (tracks.some(track => !(track instanceof Float32Array) || track.length % 2)) throw new Error('音效电平需要 Float32 双声道交错 PCM');
  const frames = Math.min(Math.round(duration * sampleRate), ...tracks.map(track => track.length / 2));
  if (!frames || tracks.some(track => Math.abs(track.length / 2 - Math.round(duration * sampleRate)) > sampleRate * 0.05)) {
    throw new Error('最终音轨、同期原曲与音效轨的剪辑时长不一致（容差 50 ms）');
  }
  const energy = () => [0, 0];
  const levels = (sum, count) => ({
    left: db(Math.sqrt(sum[0] / count)),
    right: db(Math.sqrt(sum[1] / count)),
    stereo: db(Math.sqrt((sum[0] + sum[1]) / (2 * count))),
  });
  return events.map((event, index) => {
    const start = Math.round(event.at * sampleRate);
    const hit = event.hitAt ?? event.at;
    if (!Number.isFinite(event.at) || event.at < 0 || start >= frames || !Number.isFinite(hit) || hit < event.at || hit >= duration) {
      throw new Error('音效 ' + (event.id ?? index + 1) + ' 超出可测音轨时段');
    }
    const window = time => {
      const first = Math.min(frames - 1, Math.round(time * sampleRate));
      const end = Math.min(frames, first + Math.max(1, Math.round(windowMs / 1000 * sampleRate)));
      const background = energy(), combined = energy(), delta = energy(), effect = energy();
      for (let frame = first; frame < end; frame++) {
        for (let channel = 0; channel < 2; channel++) {
          const i = frame * 2 + channel;
          background[channel] += music[i] ** 2;
          combined[channel] += mixed[i] ** 2;
          delta[channel] += (mixed[i] - music[i]) ** 2;
          if (stem) effect[channel] += (stem[i] * stemGain) ** 2;
        }
      }
      const count = end - first;
      const musicDbfs = levels(background, count), differenceDbfs = levels(delta, count);
      const nearSilence = musicDbfs.stereo === null || musicDbfs.stereo < quietDbfs;
      const relative = level => !nearSilence && level !== null ? Number((level - musicDbfs.stereo).toFixed(2)) : null;
      const stemDbfs = stem ? levels(effect, count) : null;
      return {
        interval: [first / sampleRate, end / sampleRate],
        musicDbfs,
        mixedDbfs: levels(combined, count),
        differenceDbfs,
        differenceRelativeDb: relative(differenceDbfs.stereo),
        stemDbfs,
        stemRelativeDb: stem ? relative(stemDbfs.stereo) : null,
        nearSilence,
      };
    };
    return {
      id: event.id ?? (event.type ?? 'sfx') + '-' + String(index + 1).padStart(2, '0'),
      type: event.type,
      at: event.at,
      hitAt: hit,
      anchor: event.anchor ?? null,
      attack: window(event.at),
      ...(hit !== event.at ? { impact: window(hit) } : {}),
    };
  });
}

export async function inspectAudioMix({ ffmpeg, audio, referenceAudio, stem, events, duration, windowMs = 80, stemGain = 1 }) {
  const sampleRate = 16000;
  const decode = path => decodePcm(ffmpeg, path, sampleRate, 2, duration);
  const [mixed, music, effect, truePeakDbtp] = await Promise.all([
    decode(audio), decode(referenceAudio), stem ? decode(stem) : null, decodeTruePeak(ffmpeg, audio, duration),
  ]);
  return {
    sampleRate, channels: 2, windowMs, quietDbfs: -55, truePeakDbtp,
    stemGain: stem ? stemGain : null,
    scope: '最终音轨解码与同期 BGM 双声道差分候选。差分包含限幅、AAC 误差及重叠事件。独立 SFX 轨电平含混音权重，位于限幅与编码之前。',
    events: stereoCueLevels({ events, mixed, music, stem: effect, sampleRate, duration, windowMs, stemGain }),
  };
}
