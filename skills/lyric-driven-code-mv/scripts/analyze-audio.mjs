import { spawn } from 'node:child_process';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertNoPathAliases } from './path-safety.mjs';

const MAX_SECONDS = 600;
const ABSOLUTE_RMS_FLOOR = 1e-5;
const TEMPO_WINDOW_SECONDS = 8;
const TEMPO_WINDOW_STEP_SECONDS = 4;
const MIN_WINDOW_CONFIDENCE = 0.45;
const round = value => Math.round(value * 1e6) / 1e6;
const clamp01 = value => Math.max(0, Math.min(1, value));
// 网格拟合只看打击乐硬证据：按 strength 取前 40%，弱起音会把任何网格都拉平。
const STRONG_ONSET_SHARE = 0.4;
// 「拟合优秀」的独立门槛：中位误差不超过 60 ms，且 40 ms 内占比至少 40%。
const STRONG_FIT_MEDIAN_MS = 60;
const STRONG_FIT_WITHIN40 = 0.4;
// 整数倍关系容差 4%：半速/双速是最常见的误判，必须两个都报出来。
const BEAT_MULTIPLES = [[2, 'double'], [0.5, 'half'], [3, 'triple'], [1 / 3, 'third']];

/**
 * 选优权重。拟合误差是主项：起音间隔投票只说明「这个间隔出现过几次」，
 * 拟合说明「这个网格能不能解释音乐里真实落下的重音」。
 */
const FIT_WEIGHT = 0.6;
const VOTE_WEIGHT = 0.2;
const AUTOCORRELATION_WEIGHT = 0.12;
const ALIGNMENT_WEIGHT = 0.08;

function finiteOption(value, name, { positive = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
    throw new Error(`${name} 必须为${positive ? '正' : '非负'}有限数。`);
  }
}

function validateRate(sampleRate) {
  if (![8000, 16000].includes(sampleRate)) throw new Error('sampleRate 必须为 8000 或 16000。');
}

function validateBpmOptions({ bpm, bpmSource, bpmEvidence }) {
  if (bpm === undefined) {
    if (bpmSource !== undefined || bpmEvidence !== undefined) throw new Error('BPM 来源或依据需要同时提供 --bpm / bpm。');
    return;
  }
  finiteOption(bpm, 'BPM / bpm', { positive: true });
  if (bpm > 400) throw new Error('BPM / bpm 不得超过 400。');
  if (bpmSource !== undefined && !['user-provided', 'metadata'].includes(bpmSource)) throw new Error('BPM 来源 bpmSource 必须为 user-provided 或 metadata。');
  if (bpmEvidence !== undefined && (typeof bpmEvidence !== 'string' || !bpmEvidence.trim())) throw new Error('BPM 依据 bpmEvidence 必须为非空文字。');
  if (bpmSource === 'metadata' && !bpmEvidence?.trim()) throw new Error('metadata BPM 必须提供 --bpm-evidence / bpmEvidence，记录曲目页或元数据依据。');
}

/** 强起音子集：按 strength 降序取前 share，再按时间排回。样本太少时原样返回。 */
function strongOnsetSubset(onsets, share = STRONG_ONSET_SHARE) {
  if (onsets.length <= 4) return onsets.slice();
  const ranked = [...onsets].sort((a, b) => b.strength - a.strength || a.at - b.at);
  const count = Math.max(4, Math.round(onsets.length * share));
  return ranked.slice(0, count).sort((a, b) => a.at - b.at);
}

/** 单个起音到最近网格点的绝对距离（毫秒），网格 = phase + n * period。 */
function gridDistanceMs(at, phaseSeconds, periodSeconds) {
  const relative = at - phaseSeconds;
  return Math.abs(relative - Math.round(relative / periodSeconds) * periodSeconds) * 1000;
}

/**
 * 用强起音检验一个 BPM/相位网格：每个起音到最近网格点的距离取中位数与命中率。
 * 这是「这个网格解释得了音乐吗」的直接证据，与间隔投票是两件事。
 */
function onsetGridFit(strong, bpm, phaseSeconds) {
  const period = 60 / bpm;
  if (!strong.length) return { medianMs: null, p90Ms: null, within40ms: 0, within80ms: 0, samples: 0 };
  const distances = strong.map(onset => gridDistanceMs(onset.at, phaseSeconds, period)).sort((a, b) => a - b);
  const quantile = ratio => distances[Math.min(distances.length - 1, Math.max(0, Math.round((distances.length - 1) * ratio)))];
  const share = limit => round(distances.filter(distance => distance <= limit).length / distances.length);
  return {
    medianMs: round(quantile(0.5)),
    p90Ms: round(quantile(0.9)),
    within40ms: share(40),
    within80ms: share(80),
    samples: distances.length,
  };
}

/**
 * 拟合分数：中位误差越小越高，并把 40 ms 命中率并入。
 * 快速网格天然更容易「碰到」起音，所以分数以绝对毫秒为准，不做周期归一化。
 */
function onsetFitScore(onsetFit) {
  if (!onsetFit?.samples || onsetFit.medianMs === null) return 0;
  const closeness = clamp01(1 - onsetFit.medianMs / 150);
  return round(0.6 * clamp01(onsetFit.within40ms) + 0.4 * closeness);
}

/** 拟合是否够硬：中位误差 ≤60 ms 且 40 ms 命中率 ≥40%。 */
function hasStrongFit(candidate) {
  const fit = candidate?.onsetFit;
  return Boolean(fit?.samples) && fit.medianMs !== null && fit.medianMs <= STRONG_FIT_MEDIAN_MS && fit.within40ms >= STRONG_FIT_WITHIN40;
}

/**
 * 与最优候选成整数倍关系的候选（半速/双速最常见）。
 * 两个网格都能解释音乐时只报一个会误导；这里把对手连拟合数字一起列出。
 * 已经落在候选范围内的整数倍网格即使没有自己的簇也直接探测一次，避免「没投票就没数字」。
 */
function multipleRivals(best, clusters, probe) {
  const rivals = [];
  const seen = new Set();
  for (const candidate of clusters) {
    if (candidate.bpm === best.bpm) continue;
    const ratio = candidate.bpm / best.bpm;
    const multiple = BEAT_MULTIPLES.find(([factor]) => Math.abs(ratio - factor) <= factor * 0.04);
    if (!multiple || seen.has(multiple[1])) continue;
    seen.add(multiple[1]);
    const fit = candidate.onsetFit;
    rivals.push({
      bpm: round(candidate.bpm), relation: multiple[1], ratio: round(ratio), vote: round(candidate.vote ?? 0),
      onsetFit: fit, fitScore: round(candidate.fitScore ?? onsetFitScore(fit)),
      fitAcceptable: hasStrongFit(candidate), source: 'cluster',
      status: hasStrongFit(candidate) ? 'rival-grid-also-fits' : 'weaker-grid',
    });
  }
  if (typeof probe === 'function') {
    for (const [factor, relation] of BEAT_MULTIPLES) {
      if (seen.has(relation)) continue;
      const bpm = round(best.bpm * factor);
      // 候选范围外的倍数不给数字：更快的网格天然更容易碰到起音，那会变成假证据。
      if (bpm < 45 || bpm > 200) continue;
      const probed = probe(bpm);
      seen.add(relation);
      rivals.push({
        bpm, relation, ratio: round(factor), vote: null,
        onsetFit: probed.onsetFit, fitScore: probed.fitScore,
        fitAcceptable: hasStrongFit(probed), source: 'grid-probe',
        status: hasStrongFit(probed) ? 'rival-grid-also-fits' : 'weaker-grid',
      });
    }
  }
  return rivals.sort((a, b) => b.fitScore - a.fitScore || a.bpm - b.bpm);
}

function phaseFit(onsets, bpm) {
  const period = 60 / bpm;
  let x = 0, y = 0, totalStrength = 0;
  for (const onset of onsets) {
    const angle = 2 * Math.PI * onset.at / period;
    x += Math.cos(angle) * onset.strength;
    y += Math.sin(angle) * onset.strength;
    totalStrength += onset.strength;
  }
  const alignment = totalStrength ? Math.hypot(x, y) / totalStrength : 0;
  let phase = Math.atan2(y, x) * period / (2 * Math.PI);
  phase = ((phase % period) + period) % period;
  return { alignment: round(alignment), phaseSeconds: Math.min(round(phase), period - Number.EPSILON) };
}

function periodicityAt(novelty, lag) {
  let cross = 0, leftPower = 0, rightPower = 0, leftSum = 0, rightSum = 0;
  const count = novelty.length - lag;
  if (count <= 1) return { autocorrelation: 0, periodicity: 0 };
  for (let i = lag; i < novelty.length; i++) {
    const left = novelty[i], right = novelty[i - lag];
    cross += left * right;
    leftPower += left * left;
    rightPower += right * right;
    leftSum += left;
    rightSum += right;
  }
  const autocorrelation = leftPower && rightPower ? clamp01(cross / Math.sqrt(leftPower * rightPower)) : 0;
  // Positive-only novelty has a noise baseline: remove its mean before accepting periodic evidence.
  const centeredLeft = Math.max(0, leftPower - leftSum * leftSum / count);
  const centeredRight = Math.max(0, rightPower - rightSum * rightSum / count);
  const periodicity = centeredLeft && centeredRight ? clamp01((cross - leftSum * rightSum / count) / Math.sqrt(centeredLeft * centeredRight)) : 0;
  return { autocorrelation: round(autocorrelation), periodicity: round(periodicity) };
}

function estimateTempo(onsets, novelty, hopSeconds, duration, peakRms, options) {
  const source = options.bpm === undefined ? 'audio-analysis' : options.bpmSource ?? 'user-provided';
  const evidence = {
    method: options.bpm === undefined ? '起音间隔投票、±3% 邻近候选聚类、包络自相关与相位拟合，再用强起音（strength 前 40%）做网格拟合验证后选优。' : '采用已提供的 BPM，仅用片段起音拟合相位，并报告强起音网格拟合误差。',
    bpm: options.bpmEvidence?.trim() ?? (options.bpm === undefined ? '离线音频候选；没有外部 BPM 依据。' : `用户提供 ${options.bpm} BPM。`),
    limitations: '启发式证据未经真实歌曲标定；BPM 来源不证明拍号、歌词对齐或人工核对，半速/双速与弱拍仍需听辨。',
  };
  const empty = reason => ({ bpm: null, status: 'unavailable', source, confidence: 0, periodSeconds: null, phaseSeconds: null, onsetFit: null, fitScore: null, candidates: [], clusters: [], ambiguities: [], rivalGrids: [], evidence, ...(options.bpm === undefined ? {} : { requestedBpm: options.bpm }), reason });
  if (peakRms < ABSOLUTE_RMS_FLOOR) return empty('静音或能量低于绝对证据阈值。');
  if (onsets.length < 5 || duration < 3) return empty('片段过短或起音候选不足 5 个。');

  const strongOnsets = strongOnsetSubset(onsets);
  const correlations = new Map();
  const fit = bpm => {
    const lag = Math.round(60 / bpm / hopSeconds);
    if (!correlations.has(lag)) correlations.set(lag, periodicityAt(novelty, lag));
    const phased = { bpm, ...phaseFit(onsets, bpm), ...correlations.get(lag) };
    const fitResult = onsetGridFit(strongOnsets, bpm, phased.phaseSeconds);
    return { ...phased, onsetFit: fitResult, fitScore: onsetFitScore(fitResult) };
  };
  // Coverage keeps a grid from being finer than the evidence; periodicity OR a directly fitted grid proves the signal.
  const usableSignal = candidate => onsets.length / (duration * candidate.bpm / 60) >= 0.2 && (candidate.periodicity >= 0.05 || hasStrongFit(candidate));
  /** 直接给一个 BPM 算网格：用于没有自己簇的整数倍对手（半速/双速）。 */
  const probeBpm = bpm => (Number.isFinite(bpm) && bpm > 0 ? fit(bpm) : null);
  const selected = (candidate, candidates, clusters, confidence, status, reason) => ({
    bpm: candidate.bpm, status, source, confidence: round(confidence),
    periodSeconds: 60 / candidate.bpm, phaseSeconds: candidate.phaseSeconds,
    alignment: candidate.alignment, autocorrelation: candidate.autocorrelation, periodicity: candidate.periodicity,
    onsetFit: candidate.onsetFit, fitScore: candidate.fitScore,
    candidates, clusters, evidence,
    rivalGrids: multipleRivals(candidate, clusters, probeBpm),
    ambiguities: [{ bpm: candidate.bpm / 2, relation: 'half' }, { bpm: candidate.bpm * 2, relation: 'double' }], reason,
  });
  if (options.bpm !== undefined) {
    const candidate = fit(options.bpm);
    const covered = onsets.length / (duration * candidate.bpm / 60) >= 0.2;
    // A known grid can be phased from sparse downbeats even when intervening beats have no onset.
    if (!covered || (candidate.periodicity < 0.05 && candidate.alignment < 0.3)) return empty('已记录提供的 BPM，但音频没有足够的周期或相位证据；不生成任意起点网格。');
    const confidence = clamp01(0.65 * candidate.alignment + 0.35 * candidate.periodicity);
    return selected(candidate, [candidate], [], confidence, confidence >= 0.6 ? 'estimated' : 'low-confidence', 'BPM 来自所记录的外部依据；相位为机器拟合，仍需人工核对。');
  }

  // Short-distance onset pairs vote for plausible subdivisions. This cannot decide a musical metre.
  const bins = new Map();
  for (let i = 1; i < onsets.length; i++) {
    for (let distance = 1; distance <= 8 && i - distance >= 0; distance++) {
      const previous = onsets[i - distance];
      const interval = onsets[i].at - previous.at;
      if (interval < 0.1 || interval > 4) continue;
      for (let subdivisions = 1; subdivisions <= 8; subdivisions++) {
        const bpm = 60 * subdivisions / interval;
        if (bpm < 45 || bpm > 200) continue;
        const key = Math.round(bpm * 2) / 2;
        const bin = bins.get(key) ?? { bpm: key, weight: 0, intervalVotes: 0 };
        bin.weight += Math.sqrt(previous.strength * onsets[i].strength) / (distance * subdivisions);
        bin.intervalVotes++;
        bins.set(key, bin);
      }
    }
  }
  if (!bins.size) return empty('起音间隔没有形成可用的 45–200 BPM 候选。');

  const maxWeight = Math.max(...Array.from(bins.values(), bin => bin.weight));
  const candidates = [];
  for (const bin of bins.values()) {
    const candidate = fit(bin.bpm);
    const vote = bin.weight / maxWeight;
    const score = FIT_WEIGHT * candidate.fitScore + VOTE_WEIGHT * vote + AUTOCORRELATION_WEIGHT * candidate.autocorrelation + ALIGNMENT_WEIGHT * candidate.alignment;
    candidates.push({ ...candidate, vote: round(vote), intervalVotes: bin.intervalVotes, score });
  }
  candidates.sort((a, b) => b.score - a.score || b.vote - a.vote || a.bpm - b.bpm);
  const publicCandidates = candidates.slice(0, 8).map(({ score, ...candidate }) => candidate);

  // Use fixed anchors rather than transitive chaining, which could collapse unrelated BPMs into one cluster.
  const unassigned = new Set(candidates);
  const groups = [];
  for (const anchor of candidates) {
    if (!unassigned.has(anchor)) continue;
    const members = candidates.filter(candidate => unassigned.has(candidate) && Math.abs(candidate.bpm - anchor.bpm) / anchor.bpm <= 0.03);
    members.forEach(candidate => unassigned.delete(candidate));
    const range = { min: Math.min(...members.map(candidate => candidate.bpm)), max: Math.max(...members.map(candidate => candidate.bpm)) };
    const weight = members.reduce((sum, candidate) => sum + candidate.vote, 0);
    let refined = fit(anchor.bpm);
    // Refit inside the supported range to avoid phase drift caused by the 0.5 BPM voting bins.
    for (let tenth = Math.ceil(range.min * 10); tenth <= Math.floor(range.max * 10); tenth++) {
      const candidate = fit(tenth / 10);
      if (candidate.alignment > refined.alignment) refined = candidate;
    }
    groups.push({ ...refined, range, anchorBpm: anchor.bpm, weight, intervalVotes: members.reduce((sum, candidate) => sum + candidate.intervalVotes, 0), members: members.map(({ score, ...candidate }) => candidate) });
  }
  const maxClusterWeight = Math.max(...groups.map(group => group.weight));
  const clusters = groups.map(({ weight, ...group }) => {
    const vote = round(weight / maxClusterWeight);
    return { ...group, vote, score: FIT_WEIGHT * group.fitScore + VOTE_WEIGHT * vote + AUTOCORRELATION_WEIGHT * group.autocorrelation + ALIGNMENT_WEIGHT * group.alignment };
  }).sort((a, b) => b.score - a.score || a.bpm - b.bpm);
  const publicClusters = clusters.slice(0, 8).map(({ score, ...cluster }) => cluster);
  const best = clusters.find(candidate => usableSignal(candidate) && candidate.autocorrelation >= 0.15 && candidate.intervalVotes >= 8 && candidate.vote >= 0.2);
  if (!best) return { ...empty('候选投票或去均值周期一致性不足；请人工听辨。'), candidates: publicCandidates, clusters: publicClusters };
  const confidence = clamp01(0.45 * best.alignment + 0.35 * best.autocorrelation + 0.2 * best.vote);
  const strong = best.alignment >= 0.6 && best.autocorrelation >= 0.2 && confidence >= 0.6;
  return selected(best, publicCandidates, publicClusters, strong ? confidence : Math.min(0.59, confidence), strong ? 'estimated' : 'low-confidence', strong ? '邻近候选的周期与相位共同支持网格；仍需人工核对半速/双速。' : '强起音网格拟合与间隔投票共同支持该候选，但相位或自相关偏弱；网格仅供 draft 分镜试排与人工复核。');
}

function analyzeTempoWindows(onsets, novelty, envelope, hopSeconds, duration, options) {
  const windows = [];
  for (let start = 0; start < duration; start += TEMPO_WINDOW_STEP_SECONDS) {
    const end = Math.min(duration, start + TEMPO_WINDOW_SECONDS);
    if (end - start < 3) continue;
    const localOnsets = onsets
      .filter(onset => onset.at >= start && onset.at < end)
      .map(onset => ({ ...onset, at: onset.at - start }));
    const firstIndex = Math.floor(start / hopSeconds);
    const lastIndex = Math.min(novelty.length, Math.ceil(end / hopSeconds));
    const localNovelty = novelty.slice(firstIndex, lastIndex);
    const localEnvelope = envelope.filter(frame => frame.at >= start && frame.at < end);
    const localPeakRms = localEnvelope.reduce((peak, frame) => Math.max(peak, frame.rms), 0);
    // A supplied BPM is a whole-clip reference. Local estimates must remain
    // audio-derived so tempo changes can override that reference where needed.
    const windowOptions = options.bpm === undefined
      ? options
      : { ...options, bpm: undefined, bpmSource: undefined, bpmEvidence: undefined };
    const result = estimateTempo(localOnsets, localNovelty, hopSeconds, end - start, localPeakRms, windowOptions);
    const periodSeconds = result.bpm === null ? null : 60 / result.bpm;
    const phaseSeconds = periodSeconds === null
      ? null
      : round((((start + result.phaseSeconds) % periodSeconds) + periodSeconds) % periodSeconds);
    const supportedOnsets = onsets.filter(onset => onset.at >= start && onset.at < end);
    const support = periodSeconds === null || supportedOnsets.length === 0
      ? null
      : {
        start: round(Math.max(start, supportedOnsets[0].at - periodSeconds / 2)),
        end: round(Math.min(end, supportedOnsets.at(-1).at + periodSeconds / 2)),
      };
    windows.push({
      start: round(start), end: round(end), bpm: result.bpm,
      phaseSeconds, periodSeconds: periodSeconds === null ? null : round(periodSeconds),
      confidence: result.confidence, status: result.status,
      evidenceCount: supportedOnsets.length, onsetFit: result.onsetFit,
      support, reason: result.reason,
    });
  }
  return windows;
}

function localTempoClusters(windows) {
  const clusters = [];
  for (const window of windows) {
    if (window.bpm === null || window.confidence < 0.5) continue;
    const cluster = clusters.find(candidate => Math.abs(window.bpm - candidate.anchorBpm) / candidate.anchorBpm <= 0.05);
    if (cluster) cluster.windows.push(window);
    else clusters.push({ anchorBpm: window.bpm, windows: [window] });
  }
  return clusters;
}

function summarizeTempoWindows(tempo, windows, options) {
  const clusters = localTempoClusters(windows);
  const supportedClusters = clusters.filter(cluster => cluster.windows.length >= 2);
  if (options.bpm === undefined && supportedClusters.length > 1) {
    return {
      ...tempo,
      bpm: null,
      status: 'variable-tempo',
      periodSeconds: null,
      phaseSeconds: null,
      globalCandidate: { bpm: tempo.bpm, phaseSeconds: tempo.phaseSeconds, status: tempo.status },
      reason: '局部窗口支持多个速度范围；不再用单一全局 BPM 外推整段拍点。',
      windows,
    };
  }
  const compatibleProvidedSpeeds = options.bpm === undefined
    ? []
    : [options.bpm / 2, options.bpm, options.bpm * 2];
  if (options.bpm !== undefined && supportedClusters.some(cluster =>
    !compatibleProvidedSpeeds.some(speed => Math.abs(cluster.anchorBpm - speed) / speed <= 0.05))) {
    return { ...tempo, status: 'local-variation', reason: '局部窗口显示速度与所提供 BPM 有差异；请按段落复核。', windows };
  }
  return { ...tempo, windows };
}

function onsetGroups(onsets, periodSeconds) {
  const maximumGap = Math.max(1.25, periodSeconds * 2.5);
  const groups = [];
  for (const onset of onsets) {
    const current = groups.at(-1);
    if (!current || onset.at - current.at(-1).at > maximumGap) groups.push([onset]);
    else current.push(onset);
  }
  return groups.filter(group => group.length >= 4);
}

function gridCandidatesForSupport({ start, end, phaseSeconds, periodSeconds, bpm, confidence, onsets }) {
  const firstIndex = Math.ceil((start - phaseSeconds) / periodSeconds - 1e-8);
  const lastIndex = Math.floor((end - phaseSeconds) / periodSeconds + 1e-8);
  const candidates = [];
  for (let index = firstIndex; index <= lastIndex; index++) {
    const at = round(phaseSeconds + index * periodSeconds);
    if (at < 0 || at >= end) continue;
    const tolerance = Math.min(0.08, periodSeconds * 0.15);
    let nearest = null;
    for (const onset of onsets) {
      const distance = Math.abs(onset.at - at);
      if (distance <= tolerance && (!nearest || distance < nearest.distance)) nearest = { onset, distance };
    }
    candidates.push({
      at,
      bpm,
      confidence: round(Math.min(1, confidence * 0.75 + (nearest ? nearest.onset.strength * 0.25 : 0))),
      evidence: nearest ? 'observed' : 'predicted',
    });
  }
  return candidates;
}

function buildBeatDetails(tempo, windows, onsets, duration) {
  const candidates = [];
  const globalPeriod = tempo.bpm === null ? null : 60 / tempo.bpm;
  const hasLocalTempoChange = tempo.status === 'variable-tempo' || tempo.status === 'local-variation';
  const stableGlobalGrid = tempo.bpm !== null && !hasLocalTempoChange && tempo.confidence >= MIN_WINDOW_CONFIDENCE;
  if (stableGlobalGrid && tempo.phaseSeconds !== null) {
    for (const group of onsetGroups(onsets, globalPeriod)) {
      const start = Math.max(0, group[0].at - globalPeriod / 2);
      const end = Math.min(duration, group.at(-1).at + globalPeriod / 2);
      candidates.push(...gridCandidatesForSupport({
        start, end, phaseSeconds: tempo.phaseSeconds, periodSeconds: globalPeriod,
        bpm: tempo.bpm, confidence: tempo.confidence, onsets: group,
      }));
    }
  } else if (hasLocalTempoChange) {
    for (const window of windows) {
      const periodSeconds = window.periodSeconds;
      if (window.bpm === null || window.confidence < MIN_WINDOW_CONFIDENCE || !hasStrongFit(window) || periodSeconds === null || window.phaseSeconds === null) continue;
      const localOnsets = onsets.filter(onset => onset.at >= window.start && onset.at < window.end);
      for (const group of onsetGroups(localOnsets, periodSeconds)) {
        const start = Math.max(window.start, group[0].at - periodSeconds / 2);
        const end = Math.min(window.end, group.at(-1).at + periodSeconds / 2);
        candidates.push(...gridCandidatesForSupport({
          start, end, phaseSeconds: window.phaseSeconds, periodSeconds,
          bpm: window.bpm, confidence: window.confidence, onsets: group,
        }));
      }
    }
  }
  candidates.sort((a, b) => a.at - b.at || b.confidence - a.confidence);
  const merged = [];
  for (const candidate of candidates) {
    const previous = merged.at(-1);
    const mergeTolerance = previous ? Math.min(0.1, 0.18 * Math.min(60 / previous.bpm, 60 / candidate.bpm)) : 0;
    if (!previous || candidate.at - previous.at > mergeTolerance) {
      merged.push(candidate);
      continue;
    }
    if (candidate.confidence > previous.confidence) {
      merged[merged.length - 1] = { ...candidate, evidence: previous.evidence === 'observed' || candidate.evidence === 'observed' ? 'observed' : 'predicted' };
    } else if (candidate.evidence === 'observed') previous.evidence = 'observed';
  }
  return merged.map(({ windowStart, ...beat }) => beat);
}

function bandEnvelopes(samples, sampleRate, windowSamples, hopSamples) {
  const lowCutoff = 150, midCutoff = Math.min(1200, sampleRate * 0.35);
  const lowAlpha = Math.exp(-2 * Math.PI * lowCutoff / sampleRate);
  const midAlpha = Math.exp(-2 * Math.PI * midCutoff / sampleRate);
  const rings = [new Float64Array(windowSamples), new Float64Array(windowSamples), new Float64Array(windowSamples)];
  const powers = [0, 0, 0], previousFilters = [0, 0];
  const bands = { low: [], mid: [], high: [] }, names = ['low', 'mid', 'high'];
  let ringIndex = 0;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const lowpass = (1 - lowAlpha) * sample + lowAlpha * previousFilters[0];
    const midpass = (1 - midAlpha) * sample + midAlpha * previousFilters[1];
    previousFilters[0] = lowpass; previousFilters[1] = midpass;
    const values = [lowpass, midpass - lowpass, sample - midpass];
    for (let band = 0; band < values.length; band++) {
      const old = rings[band][ringIndex];
      rings[band][ringIndex] = values[band];
      powers[band] += values[band] * values[band] - old * old;
    }
    ringIndex = (ringIndex + 1) % windowSamples;
    if (index + 1 >= windowSamples && (index + 1 - windowSamples) % hopSamples === 0) {
      const at = (index + 1 - windowSamples) / sampleRate;
      for (let band = 0; band < names.length; band++) bands[names[band]].push({ at, rms: Math.sqrt(Math.max(0, powers[band]) / windowSamples) });
    }
  }
  const nextStart = bands.low.length * hopSamples;
  for (let start = nextStart; start < samples.length; start += hopSamples) {
    const count = samples.length - start;
    const first = (ringIndex - count + windowSamples) % windowSamples;
    const partialPowers = [0, 0, 0];
    for (let offset = 0; offset < count; offset++) {
      const ring = (first + offset) % windowSamples;
      for (let band = 0; band < names.length; band++) partialPowers[band] += rings[band][ring] * rings[band][ring];
    }
    for (let band = 0; band < names.length; band++) bands[names[band]].push({ at: start / sampleRate, rms: Math.sqrt(partialPowers[band] / count) });
  }
  return { bands, lowCutoff, midCutoff };
}

function onsetCandidates(frames, peakRms, windowSeconds, band, duration, sampleRate, bandStrengthScale = peakRms) {
  if (peakRms <= ABSOLUTE_RMS_FLOOR) return [];
  const novelty = frames.map((frame, index) => Math.max(0, frame.rms - (frames[index - 1]?.rms ?? 0)));
  const threshold = Math.max(ABSOLUTE_RMS_FLOOR, peakRms * 0.1);
  const onsets = [];
  for (let index = 0; index < novelty.length; index++) {
    if (novelty[index] < threshold || novelty[index] < (novelty[index - 1] ?? 0) || novelty[index] <= (novelty[index + 1] ?? 0)) continue;
    const at = Math.min(frames[index].at + windowSeconds / 2, duration - 1 / sampleRate);
    const candidate = { at: round(at), strength: round(novelty[index] / peakRms), source: band, bandStrength: { low: 0, mid: 0, high: 0 } };
    candidate.bandStrength[band] = round(novelty[index] / bandStrengthScale);
    const last = onsets.at(-1);
    if (last && candidate.at - last.at < 0.08) {
      if (candidate.strength > last.strength) onsets[onsets.length - 1] = candidate;
    } else onsets.push(candidate);
  }
  return onsets;
}

function mergeOnsetCandidates(candidates) {
  const sorted = candidates.sort((a, b) => a.at - b.at || b.strength - a.strength), merged = [];
  for (const candidate of sorted) {
    const previous = merged.at(-1);
    if (!previous || candidate.at - previous.at >= 0.08) {
      merged.push({ ...candidate, bandStrength: { ...candidate.bandStrength } });
      continue;
    }
    if (candidate.strength > previous.strength) { previous.at = candidate.at; previous.strength = candidate.strength; }
    previous.source = previous.source === candidate.source ? previous.source : 'combined';
    for (const band of ['low', 'mid', 'high']) previous.bandStrength[band] = Math.max(previous.bandStrength[band], candidate.bandStrength[band]);
  }
  return merged;
}

/** Analyze already-cut mono PCM. sourceOffset is metadata; every returned time uses the clip clock. */
export function analyzePcm(samples, options = {}) {
  const { sampleRate = 8000, sourceOffset = 0, windowSeconds = 0.02, hopSeconds = 0.01 } = options;
  validateBpmOptions(options);
  validateRate(sampleRate);
  finiteOption(sourceOffset, 'sourceOffset');
  finiteOption(windowSeconds, 'windowSeconds', { positive: true });
  finiteOption(hopSeconds, 'hopSeconds', { positive: true });
  if (windowSeconds > 1 || hopSeconds > windowSeconds || windowSeconds * sampleRate < 1 || hopSeconds * sampleRate < 1) {
    throw new Error('windowSeconds/hopSeconds 必须至少含一个样本，且 0 < hopSeconds <= windowSeconds <= 1。');
  }
  if (!(samples instanceof Float32Array || samples instanceof Float64Array) || samples.length === 0) throw new Error('PCM 必须为非空 Float32Array 或 Float64Array 样本。');
  if (samples.length > sampleRate * MAX_SECONDS) throw new Error(`PCM 超过 ${MAX_SECONDS} 秒上限；请先截取需要分析的片段。`);
  let totalPower = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new Error('PCM 样本不得含 NaN 或 Infinity。');
    totalPower += sample * sample;
  }
  if (!Number.isFinite(totalPower)) throw new Error('PCM 样本能量超出可计算范围。');
  const duration = samples.length / sampleRate;
  const windowSamples = Math.round(windowSeconds * sampleRate);
  const hopSamples = Math.round(hopSeconds * sampleRate);
  const actualHop = hopSamples / sampleRate;
  const actualWindow = windowSamples / sampleRate;
  const envelope = [];
  let peakRms = 0;
  for (let start = 0; start < samples.length; start += hopSamples) {
    const end = Math.min(start + windowSamples, samples.length);
    let power = 0;
    for (let index = start; index < end; index++) power += samples[index] * samples[index];
    const rms = Math.sqrt(power / (end - start));
    peakRms = Math.max(peakRms, rms);
    envelope.push({ at: start / sampleRate, rms });
  }
  const filtered = bandEnvelopes(samples, sampleRate, windowSamples, hopSamples);
  const bandRises = Object.fromEntries(Object.entries(filtered.bands).map(([name, frames]) => [name, frames.map((frame, index) => Math.max(0, frame.rms - (frames[index - 1]?.rms ?? 0)))]));
  const bandMaxima = Object.fromEntries(Object.entries(bandRises).map(([name, rises]) => [name, rises.reduce((peak, rise) => Math.max(peak, rise), 0)]));
  const bandStrengthScale = Math.max(ABSOLUTE_RMS_FLOOR, ...Object.values(bandMaxima));
  const bandWeights = { low: 0.45, mid: 0.35, high: 0.2 };
  const novelty = envelope.map((frame, index) => Object.entries(bandRises).reduce((sum, [name, rises]) => sum + bandWeights[name] * (bandMaxima[name] ? rises[index] / bandMaxima[name] : 0), 0));
  const bandOnsets = Object.entries(filtered.bands).flatMap(([name, frames]) => onsetCandidates(frames, bandMaxima[name], actualWindow, name, duration, sampleRate, bandStrengthScale));
  const broadband = onsetCandidates(envelope, peakRms, actualWindow, 'rms', duration, sampleRate);
  const onsets = mergeOnsetCandidates([...broadband, ...bandOnsets]);

  const pauses = [];
  const pauseThreshold = Math.max(ABSOLUTE_RMS_FLOOR, peakRms * 0.1);
  let pauseStart = null;
  let pauseMaxRms = 0;
  for (let i = 0; i <= envelope.length; i++) {
    const frame = envelope[i];
    if (frame && frame.rms <= pauseThreshold) {
      pauseStart ??= frame.at;
      pauseMaxRms = Math.max(pauseMaxRms, frame.rms);
    } else if (pauseStart !== null) {
      const end = frame?.at ?? duration;
      if (end - pauseStart >= 0.15) pauses.push({ start: pauseStart, end, maxRms: round(pauseMaxRms) });
      pauseStart = null;
      pauseMaxRms = 0;
    }
  }
  const globalTempo = estimateTempo(onsets, novelty, actualHop, duration, peakRms, options);
  const windows = analyzeTempoWindows(onsets, novelty, envelope, actualHop, duration, options);
  const tempo = summarizeTempoWindows(globalTempo, windows, options);
  const beatDetails = buildBeatDetails(tempo, windows, onsets, duration);
  const beats = beatDetails.map(beat => beat.at);
  return {
    schemaVersion: 1,
    status: 'draft',
    timebase: 'clip',
    sourceOffset,
    duration,
    sampleRate,
    energy: {
      windowSeconds: actualWindow,
      hopSeconds: actualHop,
      peakRms: round(peakRms),
      meanRms: round(Math.sqrt(totalPower / samples.length)),
      envelope: envelope.map(frame => ({ at: frame.at, rms: round(frame.rms), normalized: peakRms ? round(frame.rms / peakRms) : 0 })),
    },
    pauses,
    onsets,
    frequencyBands: { lowMaxHz: filtered.lowCutoff, midMaxHz: filtered.midCutoff },
    tempo,
    beats,
    beatDetails,
    warnings: [
      '全部结果为 draft 机器推定，不代表听辨歌词、演唱词时间或 verified 节拍。',
      '低频/中频/高频滤波带能量上升仍是音乐瞬态候选，可能来自鼓、人声或混音，不能用于断言歌词边界。',
      'beats 只保留局部窗口支持的拍点；beatDetails 区分可观测起音与网格预测，长静音处不继续外推。',
      '半速/双速、切分音、拖音、变速、弱拍、短片段与单声道降采样均可能改变 BPM/相位候选。',
      'tempo.confidence 为未经真实歌曲标定的启发式一致性评分，不是检测正确的概率。',
      `时间精度受 ${actualWindow} 秒能量窗和 ${actualHop} 秒步长限制；起音时点使用窗口中心估计。`,
    ],
    limits: { maxDecodedSeconds: MAX_SECONDS, maxPcmBytes: sampleRate * MAX_SECONDS * 4 },
  };
}

/** Decode with bounded async stdout consumption: no shell, API, dependency download, or unbounded output. */
export async function decodeAudio(input, options = {}) {
  const { sampleRate = 8000, start = 0, duration, ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg', maxPcmBytes = sampleRate * MAX_SECONDS * 4, timeoutMs = 120000 } = options;
  validateRate(sampleRate);
  finiteOption(start, 'start');
  if (duration !== undefined) {
    finiteOption(duration, 'duration', { positive: true });
    if (duration > MAX_SECONDS) throw new Error(`duration 超过 ${MAX_SECONDS} 秒上限。`);
  }
  if (!Number.isInteger(maxPcmBytes) || maxPcmBytes < 4 || maxPcmBytes > sampleRate * MAX_SECONDS * 4) throw new Error('maxPcmBytes 必须为不超过默认 PCM 上限的正整数。');
  finiteOption(timeoutMs, 'timeoutMs', { positive: true });
  if (typeof input !== 'string' || !input.trim()) throw new Error('无法读取音频：输入路径不能为空。');
  if (typeof ffmpegPath !== 'string' || !ffmpegPath.trim()) throw new Error('ffmpeg 路径不能为空。');
  const inputPath = resolve(input);
  try {
    if (!(await stat(inputPath)).isFile()) throw new Error('不是普通文件');
    await access(inputPath, constants.R_OK);
  } catch (error) {
    throw new Error(`无法读取音频 ${inputPath}：${error.message}`);
  }
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(start), '-i', inputPath];
  if (duration !== undefined) args.push('-t', String(duration));
  args.push('-map', '0:a:0', '-vn', '-sn', '-dn', '-ac', '1', '-ar', String(sampleRate), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1');
  const child = spawn(ffmpegPath, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let spawnError;
  let streamError;
  let stderr = '';
  child.once('error', error => { spawnError = error; });
  child.stderr.on('data', chunk => { if (stderr.length < 65536) stderr = (stderr + chunk.toString('utf8')).slice(0, 65536); });
  const closed = new Promise(resolveClose => child.once('close', (code, signal) => resolveClose({ code, signal })));
  const timer = setTimeout(() => {
    streamError = new Error('ffmpeg 解码超时；请缩短片段或检查音频。');
    child.kill();
  }, timeoutMs);
  timer.unref();
  const sampleChunks = [];
  let bytes = 0;
  let sampleCount = 0;
  let pending = Buffer.alloc(0);
  try {
    // Async iteration obeys Readable backpressure. Each chunk is released after conversion.
    for await (const chunk of child.stdout) {
      bytes += chunk.length;
      if (bytes > maxPcmBytes) throw new Error(`音频解码超过 ${maxPcmBytes} 字节 PCM 上限；请用 --start 和 --duration 截取不超过 ${MAX_SECONDS} 秒的片段。`);
      const data = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const completeBytes = data.length - data.length % 4;
      const samples = new Float32Array(completeBytes / 4);
      for (let i = 0; i < samples.length; i++) samples[i] = data.readFloatLE(i * 4);
      sampleChunks.push(samples);
      sampleCount += samples.length;
      pending = Buffer.from(data.subarray(completeBytes));
    }
  } catch (error) {
    streamError ??= error;
    child.kill();
  }
  const result = await closed;
  clearTimeout(timer);
  if (spawnError) throw new Error(`无法启动 ffmpeg：${spawnError.message}。请确认本机 ffmpeg 在 PATH 中，或指定 --ffmpeg 路径。`);
  if (streamError) throw streamError;
  if (result.code !== 0) throw new Error(`ffmpeg 音频解码失败（退出 ${result.code ?? result.signal}）：${stderr.trim() || '没有可用错误输出。'}`);
  if (pending.length || sampleCount === 0) throw new Error('ffmpeg 未输出完整 PCM 样本；检查音频流及截取起点是否超出源文件。');
  // At most two PCM copies coexist here: <=76.8 MB at 16 kHz / 600 s, plus report data.
  const samples = new Float32Array(sampleCount);
  let offset = 0;
  for (const chunk of sampleChunks) { samples.set(chunk, offset); offset += chunk.length; }
  return samples;
}

export function parseArgs(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const parsed = { input: undefined, start: 0, duration: undefined, out: undefined, sampleRate: 8000, ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg' };
  const names = { '--start': 'start', '--duration': 'duration', '--out': 'out', '--sample-rate': 'sampleRate', '--ffmpeg': 'ffmpegPath', '--bpm': 'bpm', '--bpm-source': 'bpmSource', '--bpm-evidence': 'bpmEvidence' };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument.startsWith('--')) {
      const name = names[argument];
      if (!name) throw new Error(`未知参数 ${argument}。`);
      if (seen.has(name)) throw new Error(`重复参数 ${argument}。`);
      seen.add(name);
      const value = args[++i];
      if (value === undefined || value.startsWith('--') || !value.trim()) throw new Error(`参数 ${argument} 缺少值。`);
      parsed[name] = ['start', 'duration', 'sampleRate', 'bpm'].includes(name) ? Number(value) : value;
    } else if (parsed.input === undefined) parsed.input = argument;
    else throw new Error('用法需要且仅需要一个音频输入路径。');
  }
  if (!parsed.input?.trim()) throw new Error('用法需要一个音频输入路径。');
  finiteOption(parsed.start, 'start');
  if (parsed.duration !== undefined) {
    finiteOption(parsed.duration, 'duration', { positive: true });
    if (parsed.duration > MAX_SECONDS) throw new Error(`duration 不得超过 ${MAX_SECONDS} 秒。`);
  }
  if (![8000, 16000].includes(parsed.sampleRate)) throw new Error('参数 --sample-rate 必须为 8000 或 16000。');
  validateBpmOptions(parsed);
  return parsed;
}

const usage = `用法：node analyze-audio.mjs <audio> [--start 秒] [--duration 秒] [--out report.json]
      [--sample-rate 8000|16000] [--ffmpeg 可执行文件路径]
      [--bpm 已知BPM] [--bpm-source user-provided|metadata] [--bpm-evidence 来源依据]
示例：node analyze-audio.mjs "song with spaces.mp3" --start 37.2 --duration 12 --out report.json
已知速度：--bpm 110；曲目元数据：--bpm 110 --bpm-source metadata --bpm-evidence "曲目页URL及110 BPM记录"
仅用本机 ffmpeg 与 Node 内置模块。默认 8 kHz 单声道 float PCM。
--ffmpeg 优先于 FFMPEG_PATH；未指定时使用 PATH。显式无效路径会失败。
全部结果为 draft 机器候选，不能声称听辨歌词或 verified 节拍。
所有时点为片段秒；sourceOffset 保存 --start。局部窗口（tempo.windows）汇报速度与证据；beats 只保留有局部音频支持的候选，beatDetails 标记 observed 或 predicted。无证据的静音/间断区不外推拍点。
一次最多分析 600 秒；超长输入会拒绝，请指定片段。PCM 上限为 38.4 MB（16 kHz），
拼接时最多两份 PCM 约 76.8 MB，另有包络及 JSON 内存；短片段更适合人工校对。`;

async function main(args) {
  try {
    const options = parseArgs(args);
    if (options.help) { console.log(usage); return; }
    const inputPath = resolve(options.input);
    if (options.out) assertNoPathAliases({ inputs: [inputPath], outputs: [options.out] });
    const samples = await decodeAudio(inputPath, options);
    const report = analyzePcm(samples, { sampleRate: options.sampleRate, sourceOffset: options.start, bpm: options.bpm, bpmSource: options.bpmSource, bpmEvidence: options.bpmEvidence });
    const json = JSON.stringify(report, null, 2) + '\n';
    if (options.out) {
      const outputPath = resolve(options.out);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, json, 'utf8');
      console.log(`已保存 draft 音频候选报告：${outputPath}`);
    } else {
      await new Promise((resolveWrite, rejectWrite) => process.stdout.write(json, error => error ? rejectWrite(error) : resolveWrite()));
    }
  } catch (error) {
    console.error(`音频分析失败：${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(process.argv.slice(2));
