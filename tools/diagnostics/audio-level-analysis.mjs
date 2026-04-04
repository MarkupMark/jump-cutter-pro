import { spawnSync } from 'node:child_process';

const analysisSampleRate = 16000;
const minSilenceIntervalGuardMs = 60;
const minSilenceIntervalAnalysisMs = 180;

function mergeIntervals(intervals, maxGapMs = 20) {
  const merged = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && last.kind === interval.kind && interval.startMs - last.endMs <= maxGapMs) {
      last.endMs = Math.max(last.endMs, interval.endMs);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function decodeMonoFloat32(audioPath) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      audioPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(analysisSampleRate),
      '-f',
      'f32le',
      'pipe:1',
    ],
    { encoding: null, maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.status !== 0 || !result.stdout) {
    throw new Error(`Could not decode audio artifact "${audioPath}" with ffmpeg`);
  }
  return new Float32Array(
    result.stdout.buffer,
    result.stdout.byteOffset,
    Math.floor(result.stdout.byteLength / Float32Array.BYTES_PER_ELEMENT)
  );
}

function buildRateIntervals(samples, soundedSpeed) {
  if (!Array.isArray(samples) || samples.length < 2) {
    return [];
  }
  const baseWallMs = samples[0].wallMs ?? 0;
  const intervals = [];
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1];
    const current = samples[i];
    const wallStartMs = Math.max(0, (previous.wallMs ?? 0) - baseWallMs);
    const wallEndMs = Math.max(wallStartMs, (current.wallMs ?? 0) - baseWallMs);
    if (wallEndMs <= wallStartMs) {
      continue;
    }
    const playbackRate = Number(previous.playbackRate ?? soundedSpeed);
    intervals.push({
      startMs: wallStartMs,
      endMs: wallEndMs,
      kind: playbackRate > soundedSpeed + 0.05 ? 'silence' : 'sound',
    });
  }

  return mergeIntervals(intervals, 10);
}

function buildIntrinsicRateIntervals(samples, soundedSpeed) {
  if (!Array.isArray(samples) || samples.length < 2) {
    return [];
  }
  const intervals = [];
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1];
    const current = samples[i];
    const startMs = Number(previous.currentTimeMs ?? 0);
    const endMs = Number(current.currentTimeMs ?? startMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      continue;
    }
    const wallDeltaMs = Math.max(0, Number(current.wallMs ?? 0) - Number(previous.wallMs ?? 0));
    const playbackRate = Number(previous.playbackRate ?? soundedSpeed);
    const expectedContinuousDeltaMs = Math.max(
      120,
      wallDeltaMs * Math.max(playbackRate, soundedSpeed, 0.1) * 2.5 + 120
    );
    if (wallDeltaMs > 0 && endMs - startMs > expectedContinuousDeltaMs) {
      continue;
    }
    intervals.push({
      startMs,
      endMs,
      kind: playbackRate > soundedSpeed + 0.05 ? 'silence' : 'sound',
    });
  }
  return mergeIntervals(intervals, 10);
}

function buildTelemetryIntervals(telemetry, audioCaptureStartedAtUnixTime) {
  if (!Array.isArray(telemetry) || telemetry.length < 2 || !audioCaptureStartedAtUnixTime) {
    return [];
  }
  const intervals = [];
  for (let i = 1; i < telemetry.length; i++) {
    const previous = telemetry[i - 1];
    const current = telemetry[i];
    const startMs = Math.max(
      0,
      ((previous.unixTime - audioCaptureStartedAtUnixTime) + (previous.totalOutputDelay ?? 0)) * 1000
    );
    const endMs = Math.max(
      startMs,
      ((current.unixTime - audioCaptureStartedAtUnixTime) + (current.totalOutputDelay ?? 0)) * 1000
    );
    if (endMs <= startMs) {
      continue;
    }
    intervals.push({
      startMs,
      endMs,
      kind: previous.chartSpeedName === 1 ? 'silence' : 'sound',
    });
  }
  return mergeIntervals(intervals, 30);
}

function buildIntrinsicTelemetryIntervals(telemetry) {
  if (!Array.isArray(telemetry) || telemetry.length < 2) {
    return [];
  }
  const intervals = [];
  for (let i = 1; i < telemetry.length; i++) {
    const previous = telemetry[i - 1];
    const current = telemetry[i];
    const startMs = Number(previous.intrinsicTime ?? 0) * 1000;
    const endMs = Number(current.intrinsicTime ?? (previous.intrinsicTime ?? 0)) * 1000;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      continue;
    }
    if (endMs - startMs > 3000) {
      continue;
    }
    intervals.push({
      startMs,
      endMs,
      kind: previous.chartSpeedName === 1 ? 'silence' : 'sound',
    });
  }
  return mergeIntervals(intervals, 30);
}

function getIntervalsDurationMs(intervals) {
  return intervals.reduce((sum, interval) => sum + Math.max(0, interval.endMs - interval.startMs), 0);
}

function getOverlapDurationMs(intervalsA, intervalsB) {
  let i = 0;
  let j = 0;
  let overlapMs = 0;
  while (i < intervalsA.length && j < intervalsB.length) {
    const intervalA = intervalsA[i];
    const intervalB = intervalsB[j];
    const startMs = Math.max(intervalA.startMs, intervalB.startMs);
    const endMs = Math.min(intervalA.endMs, intervalB.endMs);
    if (endMs > startMs) {
      overlapMs += endMs - startMs;
    }
    if (intervalA.endMs <= intervalB.endMs) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return overlapMs;
}

function getLeadingMismatches(primaryIntervals, secondaryIntervals, limit = 5) {
  const mismatches = [];
  let secondaryIndex = 0;
  for (const interval of primaryIntervals) {
    while (
      secondaryIndex < secondaryIntervals.length
      && secondaryIntervals[secondaryIndex].endMs <= interval.startMs
    ) {
      secondaryIndex += 1;
    }
    let coveredMs = 0;
    let scanIndex = secondaryIndex;
    while (scanIndex < secondaryIntervals.length) {
      const candidate = secondaryIntervals[scanIndex];
      if (candidate.startMs >= interval.endMs) {
        break;
      }
      const overlapMs = Math.max(
        0,
        Math.min(interval.endMs, candidate.endMs) - Math.max(interval.startMs, candidate.startMs)
      );
      coveredMs += overlapMs;
      scanIndex += 1;
    }
    const durationMs = interval.endMs - interval.startMs;
    const uncoveredMs = Math.max(0, durationMs - coveredMs);
    if (uncoveredMs <= 0) {
      continue;
    }
    mismatches.push({
      startMs: Number(interval.startMs.toFixed(1)),
      endMs: Number(interval.endMs.toFixed(1)),
      durationMs: Number(durationMs.toFixed(1)),
      uncoveredMs: Number(uncoveredMs.toFixed(1)),
      coveredShare: durationMs === 0 ? 1 : Number((coveredMs / durationMs).toFixed(3)),
    });
  }
  mismatches.sort((left, right) => right.uncoveredMs - left.uncoveredMs);
  return mismatches.slice(0, limit);
}

function summarizeIntervals(samples, intervalsByKind) {
  const summaries = {
    sound: { durationMs: 0, rms: null, peak: null },
    silence: { durationMs: 0, rms: null, peak: null },
  };

  for (const kind of ['sound', 'silence']) {
    let sumSquares = 0;
    let sampleCount = 0;
    let peak = 0;
    for (const interval of intervalsByKind.filter(interval =>
      interval.kind === kind
      && (kind !== 'silence' || interval.endMs - interval.startMs >= minSilenceIntervalAnalysisMs)
    )) {
      const intervalDurationMs = interval.endMs - interval.startMs;
      const silenceGuardMs = Math.max(minSilenceIntervalGuardMs, intervalDurationMs * 0.45);
      const guardedInterval = kind === 'silence' && intervalDurationMs > silenceGuardMs * 2
        ? {
          startMs: interval.startMs + silenceGuardMs,
          endMs: interval.endMs - silenceGuardMs,
        }
        : interval;
      const startIndex = Math.max(0, Math.floor(guardedInterval.startMs * analysisSampleRate / 1000));
      const endIndex = Math.min(samples.length, Math.ceil(guardedInterval.endMs * analysisSampleRate / 1000));
      if (endIndex <= startIndex) {
        continue;
      }
      summaries[kind].durationMs += guardedInterval.endMs - guardedInterval.startMs;
      for (let i = startIndex; i < endIndex; i++) {
        const value = samples[i];
        const abs = Math.abs(value);
        sumSquares += value * value;
        if (abs > peak) {
          peak = abs;
        }
      }
      sampleCount += endIndex - startIndex;
    }
    if (sampleCount > 0) {
      summaries[kind].rms = Math.sqrt(sumSquares / sampleCount);
      summaries[kind].peak = peak;
    }
    summaries[kind].durationMs = Number(summaries[kind].durationMs.toFixed(1));
    if (summaries[kind].rms != null) {
      summaries[kind].rms = Number(summaries[kind].rms.toFixed(5));
      summaries[kind].peak = Number(summaries[kind].peak.toFixed(5));
    }
  }

  return summaries;
}

export function analyzeCapturedAudioLevels({
  audioPath,
  playbackSamples,
  soundedSpeed,
  telemetry,
  audioCaptureStartedAtUnixTime,
}) {
  if (!audioPath) {
    return null;
  }
  const decoded = decodeMonoFloat32(audioPath);
  const telemetryIntervals = buildTelemetryIntervals(telemetry, audioCaptureStartedAtUnixTime);
  const intervals = telemetryIntervals.length > 0
    ? telemetryIntervals
    : buildRateIntervals(playbackSamples, soundedSpeed);
  const summary = summarizeIntervals(decoded, intervals);
  const soundRms = summary.sound.rms;
  const silenceRms = summary.silence.rms;
  return {
    sampleRate: analysisSampleRate,
    sound: summary.sound,
    silence: summary.silence,
    silenceToSoundRmsRatio:
      soundRms && silenceRms != null
        ? Number((silenceRms / soundRms).toFixed(4))
        : null,
  };
}

export function analyzeSilenceSpeedAlignment({
  playbackSamples,
  soundedSpeed,
  telemetry,
}) {
  const playbackSilenceIntervals = buildIntrinsicRateIntervals(playbackSamples, soundedSpeed)
    .filter(interval => interval.kind === 'silence');
  const telemetrySilenceIntervals = buildIntrinsicTelemetryIntervals(telemetry)
    .filter(interval => interval.kind === 'silence');

  const playbackSpeedupDurationMs = getIntervalsDurationMs(playbackSilenceIntervals);
  const telemetrySilenceDurationMs = getIntervalsDurationMs(telemetrySilenceIntervals);
  const overlapDurationMs = getOverlapDurationMs(playbackSilenceIntervals, telemetrySilenceIntervals);
  const speedupWithoutSilenceDurationMs = Math.max(0, playbackSpeedupDurationMs - overlapDurationMs);
  const silenceWithoutSpeedupDurationMs = Math.max(0, telemetrySilenceDurationMs - overlapDurationMs);

  return {
    timeline: 'intrinsicTime',
    playbackSpeedupDurationMs: Number(playbackSpeedupDurationMs.toFixed(1)),
    telemetrySilenceDurationMs: Number(telemetrySilenceDurationMs.toFixed(1)),
    overlapDurationMs: Number(overlapDurationMs.toFixed(1)),
    speedupWithoutSilenceDurationMs: Number(speedupWithoutSilenceDurationMs.toFixed(1)),
    silenceWithoutSpeedupDurationMs: Number(silenceWithoutSpeedupDurationMs.toFixed(1)),
    speedupMatchedShare:
      playbackSpeedupDurationMs > 0
        ? Number((overlapDurationMs / playbackSpeedupDurationMs).toFixed(3))
        : null,
    silenceMatchedShare:
      telemetrySilenceDurationMs > 0
        ? Number((overlapDurationMs / telemetrySilenceDurationMs).toFixed(3))
        : null,
    playbackSilenceIntervals: playbackSilenceIntervals.length,
    telemetrySilenceIntervals: telemetrySilenceIntervals.length,
    leadingSpeedupWithoutSilence: getLeadingMismatches(
      playbackSilenceIntervals,
      telemetrySilenceIntervals,
    ),
    leadingSilenceWithoutSpeedup: getLeadingMismatches(
      telemetrySilenceIntervals,
      playbackSilenceIntervals,
    ),
  };
}

export function analyzeSilenceOutputGainTelemetry(telemetry) {
  if (!Array.isArray(telemetry) || telemetry.length === 0) {
    return null;
  }
  const silenceSamples = telemetry.filter(sample =>
    sample?.chartSpeedName === 1 && typeof sample?.outputGain === 'number'
  );
  if (silenceSamples.length === 0) {
    return {
      silenceSamples: 0,
      lowGainThreshold: 0.02,
      lowGainSamples: 0,
      lowGainShare: null,
      minOutputGain: null,
      maxOutputGain: null,
      medianOutputGain: null,
    };
  }
  const gains = silenceSamples
    .map(sample => Number(sample.outputGain))
    .filter(value => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (gains.length === 0) {
    return null;
  }
  const lowGainThreshold = 0.02;
  const lowGainSamples = gains.filter(value => value <= lowGainThreshold).length;
  const medianIndex = Math.floor(gains.length / 2);
  const medianOutputGain = gains.length % 2 === 0
    ? (gains[medianIndex - 1] + gains[medianIndex]) / 2
    : gains[medianIndex];
  return {
    silenceSamples: gains.length,
    lowGainThreshold,
    lowGainSamples,
    lowGainShare: Number((lowGainSamples / gains.length).toFixed(3)),
    minOutputGain: Number(gains[0].toFixed(5)),
    maxOutputGain: Number(gains[gains.length - 1].toFixed(5)),
    medianOutputGain: Number(medianOutputGain.toFixed(5)),
  };
}

export function getAudioLevelIssues(audioSummary, settings) {
  if (!audioSummary) {
    return [];
  }
  const issues = [];
  const effectiveSilenceSpeed = settings.silenceSpeed
    ?? (settings.silenceSpeedSpecificationMethod === 'absolute'
      ? settings.silenceSpeedRaw
      : settings.silenceSpeedRaw * settings.soundedSpeed);
  if (settings.muteSilences) {
    if ((audioSummary.silence.rms ?? 0) > 0.005) {
      issues.push(`Muted silence output is still too loud (RMS ${audioSummary.silence.rms})`);
    }
    if ((audioSummary.silence.peak ?? 0) > 0.05) {
      issues.push(`Muted silence output still peaks too high (${audioSummary.silence.peak})`);
    }
    return issues;
  }

  if (effectiveSilenceSpeed >= 8) {
    if ((audioSummary.silenceToSoundRmsRatio ?? 0) > 0.18) {
      issues.push(
        `Accelerated silence stays too loud at ${effectiveSilenceSpeed}x `
        + `(RMS ratio ${audioSummary.silenceToSoundRmsRatio})`
      );
    }
    if ((audioSummary.silence.peak ?? 0) > 0.22) {
      issues.push(
        `Accelerated silence peaks too high at ${effectiveSilenceSpeed}x `
        + `(${audioSummary.silence.peak})`
      );
    }
  }

  return issues;
}
