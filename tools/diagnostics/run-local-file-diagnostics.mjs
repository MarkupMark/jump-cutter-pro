import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { controllerSuites, defaultDiagnosticsSettings } from './scenarios.mjs';
import {
  analyzeCapturedAudioLevels,
  analyzeSilenceSpeedAlignment,
  analyzeSilenceOutputGainTelemetry,
  getAudioLevelIssues,
} from './audio-level-analysis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const extensionPath = path.join(repoRoot, 'dist-chromium');
const defaultChromeExecutable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function parseArgs(argv) {
  const args = {
    controller: 'all',
    filePath: null,
    silenceSpeed: null,
    muteSilences: null,
  };
  for (const arg of argv) {
    if (arg.startsWith('--controller=')) {
      args.controller = arg.slice('--controller='.length);
    } else if (arg.startsWith('--file=')) {
      args.filePath = arg.slice('--file='.length);
    } else if (arg.startsWith('--silence-speed=')) {
      args.silenceSpeed = Number(arg.slice('--silence-speed='.length));
    } else if (arg.startsWith('--mute-silences=')) {
      const raw = arg.slice('--mute-silences='.length).toLowerCase();
      args.muteSilences = raw === 'true' || raw === '1' || raw === 'yes';
    }
  }
  return args;
}

function getMediaDurationMs(filePath) {
  const result = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { encoding: 'utf8' }
  );
  const durationSeconds = Number(result.stdout.trim());
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`Could not determine media duration for "${filePath}"`);
  }
  return durationSeconds * 1000;
}

function getSilenceRanges(filePath) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-i',
      filePath,
      '-af',
      'silencedetect=noise=-34dB:d=0.08',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' }
  );
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const starts = [...text.matchAll(/silence_start: ([0-9.]+)/g)].map(match => Number(match[1]) * 1000);
  const ends = [...text.matchAll(/silence_end: ([0-9.]+) \| silence_duration: ([0-9.]+)/g)]
    .map(match => Number(match[1]) * 1000);
  return starts.map((startMs, index) => ({
    startMs,
    endMs: ends[index] ?? startMs,
  }));
}

function getKindAtTime(silenceRanges, timeMs) {
  return silenceRanges.some(range => range.startMs <= timeMs && timeMs < range.endMs)
    ? 'silence'
    : 'sound';
}

function summarizeTelemetry(telemetry, silenceRanges) {
  const byKind = {
    sound: { total: 0, silenceMarked: 0 },
    silence: { total: 0, silenceMarked: 0 },
  };
  for (const sample of telemetry) {
    const kind = getKindAtTime(silenceRanges, sample.intrinsicTime * 1000);
    byKind[kind].total += 1;
    if (sample.chartSpeedName === 1) {
      byKind[kind].silenceMarked += 1;
    }
  }
  const share = entry => entry.total === 0 ? null : entry.silenceMarked / entry.total;
  return {
    silenceShareOnSound: share(byKind.sound),
    silenceShareOnSilence: share(byKind.silence),
    totalSamples: telemetry.length,
  };
}

function summarizeChartCoverage(chartState, silenceRanges, durationMs) {
  const render = chartState?.lastRenderDiagnostics;
  const silenceSeries = chartState?.series?.silenceSpeed;
  if (!render || !Array.isArray(silenceSeries)) {
    return null;
  }

  const visibleStartMs = render.chartEdgeTimeMs - chartState.widthPx * render.millisPerPixel;
  const parts = [];
  let cursor = 0;
  for (const range of silenceRanges) {
    if (cursor < range.startMs) {
      parts.push({ startMs: cursor, endMs: range.startMs, kind: 'sound' });
    }
    parts.push({ startMs: range.startMs, endMs: range.endMs, kind: 'silence' });
    cursor = range.endMs;
  }
  if (cursor < durationMs) {
    parts.push({ startMs: cursor, endMs: durationMs, kind: 'sound' });
  }

  const coverage = {
    sound: { totalMs: 0, redMs: 0 },
    silence: { totalMs: 0, redMs: 0 },
  };
  for (const part of parts) {
    const overlapMs = Math.max(
      0,
      Math.min(render.chartEdgeTimeMs, part.endMs) - Math.max(visibleStartMs, part.startMs)
    );
    if (overlapMs > 0) {
      coverage[part.kind].totalMs += overlapMs;
    }
  }

  for (let i = 0; i < silenceSeries.length; i++) {
    const [startMs, value] = silenceSeries[i];
    const endMs = silenceSeries[i + 1]?.[0] ?? render.chartEdgeTimeMs;
    if (!(value > 0) || endMs <= startMs) {
      continue;
    }
    for (const part of parts) {
      const overlapMs = Math.max(0, Math.min(endMs, part.endMs) - Math.max(startMs, part.startMs));
      if (overlapMs > 0) {
        coverage[part.kind].redMs += overlapMs;
      }
    }
  }

  const share = (value, total) => total === 0 ? null : value / total;
  return {
    redShareOnSound: share(coverage.sound.redMs, coverage.sound.totalMs),
    redShareOnSilence: share(coverage.silence.redMs, coverage.silence.totalMs),
    visibleStartMs,
    visibleEndMs: render.chartEdgeTimeMs,
  };
}

async function requestDiagnosticsAudio(controlPage, tabId, messageType) {
  return controlPage.evaluate(async ({ tabId, messageType }) => {
    const port = chrome.tabs.connect(tabId, { name: 'diagnostics' });
    try {
      const response = await new Promise(resolve => {
        const expectedType = `${messageType}Result`;
        const listener = message => {
          if (message?.type === expectedType) {
            port.onMessage.removeListener(listener);
            resolve(message.result ?? null);
          }
        };
        port.onMessage.addListener(listener);
        port.postMessage({ type: messageType });
      });
      return response;
    } finally {
      port.disconnect();
    }
  }, { tabId, messageType });
}

async function writeAudioArtifact(outputDir, basename, captureResult) {
  if (!captureResult?.base64Audio) {
    return null;
  }
  const extensionByMime = captureResult.mimeType.includes('ogg') ? 'ogg' : 'webm';
  const audioPath = path.join(outputDir, `${basename}.${extensionByMime}`);
  await fs.writeFile(audioPath, Buffer.from(captureResult.base64Audio, 'base64'));
  return audioPath;
}

async function waitForExtensionId(browser) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    for (const target of browser.targets()) {
      const match = target.url().match(/^chrome-extension:\/\/([a-z]{32})\//);
      if (match) {
        return match[1];
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Extension id not found');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.filePath) {
    throw new Error('Use --file=/absolute/or/relative/path/to/media');
  }

  const filePath = path.resolve(args.filePath);
  await fs.access(filePath);

  const executablePath = process.env.CHROME_EXECUTABLE ?? defaultChromeExecutable;
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jump-cutter-local-diagnostics-'));
  const browser = await puppeteer.launch({
    executablePath,
    headless: false,
    userDataDir,
    pipe: true,
    enableExtensions: [extensionPath],
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  try {
    const extensionId = await waitForExtensionId(browser);
    const controlPage = await browser.newPage();
    await controlPage.goto(`chrome-extension://${extensionId}/options/index.html`, {
      waitUntil: 'networkidle0',
    });

    const durationMs = getMediaDurationMs(filePath);
    const silenceRanges = getSilenceRanges(filePath);
    const localPlayerUrl = `chrome-extension://${extensionId}/local-file-player/index.html`;
    const suites = controllerSuites.filter(suite =>
      args.controller === 'all' || suite.id === args.controller
    );

    const report = {
      createdAt: new Date().toISOString(),
      extensionId,
      executablePath,
      filePath,
      durationMs,
      silenceRanges,
      runs: [],
      passed: true,
    };

    for (const suite of suites) {
      const settings = {
        ...defaultDiagnosticsSettings,
        applyTo: 'both',
        experimentalControllerType: suite.controllerKind,
        ...(args.silenceSpeed != null
          ? {
            silenceSpeedSpecificationMethod: 'absolute',
            silenceSpeedRaw: args.silenceSpeed,
          }
          : {}),
        ...(args.muteSilences != null
          ? { muteSilences: args.muteSilences }
          : {}),
      };
      await controlPage.evaluate(async newSettings => {
        await chrome.storage.local.set(newSettings);
      }, settings);

      const playerPage = await browser.newPage();
      await playerPage.setViewport({ width: 1280, height: 900 });
      await playerPage.goto(localPlayerUrl, { waitUntil: 'networkidle0' });
      await playerPage.evaluate(() => {
        const media = document.querySelector('video');
        const t0 = performance.now();
        const toMs = value => Math.round(value * 1000) / 1000;
        const diagnostics = {
          state: {
            started: false,
            ended: false,
            samples: [],
            events: [],
          },
          reset() {
            this.state = {
              started: false,
              ended: false,
              samples: [],
              events: [],
            };
          },
          getState() {
            return JSON.parse(JSON.stringify(this.state));
          },
        };
        const sample = () => {
          diagnostics.state.samples.push({
            wallMs: toMs(performance.now() - t0),
            currentTimeMs: toMs((media?.currentTime ?? 0) * 1000),
            playbackRate: media?.playbackRate ?? null,
            paused: media?.paused ?? true,
            muted: media?.muted ?? false,
            ended: media?.ended ?? false,
          });
        };
        const logEvent = name => {
          diagnostics.state.events.push({
            name,
            wallMs: toMs(performance.now() - t0),
            currentTimeMs: toMs((media?.currentTime ?? 0) * 1000),
            playbackRate: media?.playbackRate ?? null,
          });
        };
        ['play', 'playing', 'pause', 'ratechange', 'seeking', 'seeked', 'ended', 'timeupdate', 'waiting']
          .forEach(name => media?.addEventListener(name, () => {
            if (name === 'play' || name === 'playing') {
              diagnostics.state.started = true;
            }
            if (name === 'ended') {
              diagnostics.state.ended = true;
            }
            logEvent(name);
          }));
        setInterval(sample, 50);
        sample();
        window.__jumpCutterLocalDiagnostics = diagnostics;
      });

      const input = await playerPage.$('input[type=file]');
      await input.uploadFile(filePath);
      await playerPage.bringToFront();
      await sleep(300);
      const tabId = await controlPage.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return tab?.id ?? null;
      });

      const popupPage = await browser.newPage();
      await popupPage.setViewport({ width: 1280, height: 640 });
      await popupPage.goto(
        `chrome-extension://${extensionId}/popup/popup.html?tabId=${tabId}&diagnostics=1`,
        { waitUntil: 'networkidle0' }
      );
      await popupPage.waitForFunction(() => !!window.__jumpCutterPopupDiagnostics?.getState, {
        timeout: 10_000,
      }).catch(() => {});
      await popupPage.waitForFunction(() => {
        const state = window.__jumpCutterPopupDiagnostics?.getState?.();
        return state?.connected && state?.latestTelemetryRecord?.controllerType !== undefined;
      }, {
        timeout: 10_000,
      }).catch(() => {});

      await playerPage.evaluate(async () => {
        const media = document.querySelector('video');
        if (!media) {
          return;
        }
        media.pause();
        await new Promise(resolve => setTimeout(resolve, 50));
        window.__jumpCutterLocalDiagnostics?.reset?.();
      });
      const audioCaptureStart = await requestDiagnosticsAudio(controlPage, tabId, 'startAudioCapture');
      await playerPage.evaluate(async () => {
        const media = document.querySelector('video');
        if (!media) {
          return;
        }
        media.currentTime = 0;
        await new Promise(resolve => media.addEventListener('seeked', resolve, { once: true }));
        await media.play();
      });

      const telemetry = [];
      let lastTelemetrySignature = '';
      let playerState = null;
      let popupState = null;
      const deadline = Date.now() + Math.max(30_000, durationMs * 4);
      while (Date.now() < deadline) {
        playerState = await playerPage.evaluate(() =>
          window.__jumpCutterLocalDiagnostics?.getState?.() ?? null
        );
        popupState = await popupPage.evaluate(() =>
          window.__jumpCutterPopupDiagnostics?.getState?.() ?? null
        ).catch(() => null);

        const latestTelemetry = popupState?.latestTelemetryRecord;
        if (latestTelemetry) {
          const signature =
            `${latestTelemetry.intrinsicTime}|${latestTelemetry.chartSpeedName}|${latestTelemetry.inputVolume}`;
          if (signature !== lastTelemetrySignature) {
            telemetry.push(latestTelemetry);
            lastTelemetrySignature = signature;
          }
        }

        const lastSample = playerState?.samples?.[playerState.samples.length - 1];
        if (playerState && lastSample && lastSample.currentTimeMs >= durationMs - 50) {
          playerState.ended = true;
        }
        if (playerState?.ended) {
          break;
        }
        await sleep(100);
      }

      popupState = await popupPage.evaluate(() =>
        window.__jumpCutterPopupDiagnostics?.getState?.() ?? null
      ).catch(() => null);
      const audioCapture = await requestDiagnosticsAudio(controlPage, tabId, 'stopAudioCapture');
      const outputDir = path.join(repoRoot, 'diagnostics-output');
      await fs.mkdir(outputDir, { recursive: true });
      const artifactBaseName =
        `${path.basename(filePath).replace(/\W+/g, '-').replace(/^-|-$/g, '')}-${suite.id}-audio`;
      const audioPath = await writeAudioArtifact(outputDir, artifactBaseName, audioCapture);
      const latestTelemetryRecord = popupState?.latestTelemetryRecord ?? null;
      const screenshotPath = path.join(
        repoRoot,
        'diagnostics-output',
        `${path.basename(filePath).replace(/\W+/g, '-').replace(/^-|-$/g, '')}-${suite.id}-popup.png`
      );
      await popupPage.screenshot({ path: screenshotPath });

      const lastSample = playerState?.samples?.[playerState.samples.length - 1] ?? null;
      const wallElapsedMs = lastSample?.wallMs ?? null;
      const telemetrySummary = summarizeTelemetry(telemetry, silenceRanges);
      const chartSummary = summarizeChartCoverage(popupState?.chart, silenceRanges, durationMs);
      const seekingEvents = (playerState?.events ?? []).filter(event => event.name === 'seeking').length;
      const issues = [];
      if (!playerState?.ended) {
        issues.push('Playback did not finish before timeout');
      }
      if (!popupState?.connected) {
        issues.push('Popup diagnostics did not connect');
      }
      if (latestTelemetryRecord?.controllerType !== suite.controllerKind) {
        issues.push(
          `Expected controllerType ${suite.controllerKind}, got ${latestTelemetryRecord?.controllerType ?? 'none'}`
        );
      }
      if (latestTelemetryRecord?.clonePlaybackError) {
        issues.push('clonePlaybackError reported');
      }
      if (
        suite.id === 'stretching'
        && telemetrySummary.silenceShareOnSilence != null
        && telemetrySummary.silenceShareOnSilence < 0.15
      ) {
        issues.push(
          `Stretching telemetry marks too little silence (${(telemetrySummary.silenceShareOnSilence * 100).toFixed(1)}%)`
        );
      }
      if (chartSummary?.redShareOnSilence != null && chartSummary.redShareOnSilence < 0.1) {
        issues.push(
          `Chart shows too little red on silence (${(chartSummary.redShareOnSilence * 100).toFixed(1)}%)`
        );
      }
      if (chartSummary?.redShareOnSound != null && chartSummary.redShareOnSound > 0.35) {
        issues.push(
          `Chart shows too much red on sounded regions (${(chartSummary.redShareOnSound * 100).toFixed(1)}%)`
        );
      }
      const audioLevelSummary = analyzeCapturedAudioLevels({
        audioPath,
        playbackSamples: playerState?.samples ?? [],
        soundedSpeed: settings.soundedSpeed,
        telemetry,
        audioCaptureStartedAtUnixTime: audioCapture?.startedAtUnixTime,
      });
      const speedupSilenceAlignment = analyzeSilenceSpeedAlignment({
        playbackSamples: playerState?.samples ?? [],
        soundedSpeed: settings.soundedSpeed,
        telemetry,
      });
      const silenceOutputGainTelemetry = analyzeSilenceOutputGainTelemetry(telemetry);
      issues.push(...getAudioLevelIssues(audioLevelSummary, settings));
      if (
        suite.id === 'stretching'
        && speedupSilenceAlignment.playbackSpeedupDurationMs >= 250
        && speedupSilenceAlignment.speedupMatchedShare != null
        && speedupSilenceAlignment.speedupMatchedShare < 0.65
      ) {
        issues.push(
          `Speedup happens without SILENCE telemetry too often `
          + `(${(speedupSilenceAlignment.speedupMatchedShare * 100).toFixed(1)}% overlap)`
        );
      }
      if (
        suite.id === 'stretching'
        && speedupSilenceAlignment.telemetrySilenceDurationMs >= 250
        && speedupSilenceAlignment.silenceMatchedShare != null
        && speedupSilenceAlignment.silenceMatchedShare < 0.65
      ) {
        issues.push(
          `SILENCE telemetry does not align with actual speedup often enough `
          + `(${(speedupSilenceAlignment.silenceMatchedShare * 100).toFixed(1)}% overlap)`
        );
      }
      if (
        suite.id === 'stretching'
        && silenceOutputGainTelemetry?.silenceSamples
        && silenceOutputGainTelemetry.lowGainShare != null
        && silenceOutputGainTelemetry.lowGainShare < 0.8
      ) {
        issues.push(
          `Processed output gain stays too high during SILENCE `
          + `(${(silenceOutputGainTelemetry.lowGainShare * 100).toFixed(1)}% low-gain samples)`
        );
      }

      report.runs.push({
        controller: suite.id,
        passed: issues.length === 0,
        issues,
        metrics: {
          playbackEnded: !!playerState?.ended,
          wallElapsedMs,
          mediaDurationMs: durationMs,
          wallToMediaRatio: wallElapsedMs == null ? null : Number((wallElapsedMs / durationMs).toFixed(3)),
          seekingEvents,
          telemetrySamples: telemetry.length,
          telemetry: telemetrySummary,
          chart: chartSummary,
          popupConnected: popupState?.connected ?? false,
          latestTelemetryRecord,
          audioCaptureStart,
          audioCaptureMimeType: audioCapture?.mimeType ?? null,
          audioLevels: audioLevelSummary,
          speedupSilenceAlignment,
          silenceOutputGainTelemetry,
        },
        screenshotPath,
        audioPath,
      });
      if (issues.length > 0) {
        report.passed = false;
      }

      await popupPage.close().catch(() => {});
      await playerPage.close().catch(() => {});
    }

    const outputPath = path.join(
      repoRoot,
      'diagnostics-output',
      `${path.basename(filePath).replace(/\W+/g, '-').replace(/^-|-$/g, '')}.local-diagnostics.json`
    );
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(`\nReport: ${outputPath}`);
    if (!report.passed) {
      process.exitCode = 1;
    }
  } finally {
    await Promise.race([
      browser.close(),
      new Promise(resolve => setTimeout(resolve, 3000)).then(() => {
        browser.process()?.kill('SIGKILL');
      }),
    ]).catch(() => {
      browser.process()?.kill('SIGKILL');
    });
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
}

await main();
