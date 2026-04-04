import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import {
  analyzeCapturedAudioLevels,
  analyzeSilenceSpeedAlignment,
  analyzeSilenceOutputGainTelemetry,
  getAudioLevelIssues,
} from './audio-level-analysis.mjs';
import { startFixtureServer } from './fixture-server.mjs';
import {
  controllerSuites,
  defaultDiagnosticsSettings,
  getScenarioById,
  scenarios,
} from './scenarios.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const extensionPath = path.join(repoRoot, 'dist-chromium');
const defaultChromeExecutable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function parseArgs(argv) {
  const args = {
    controller: 'all',
    scenarioIds: null,
    silenceSpeed: null,
    muteSilences: null,
  };
  for (const arg of argv) {
    if (arg.startsWith('--controller=')) {
      args.controller = arg.slice('--controller='.length);
    } else if (arg.startsWith('--scenarios=')) {
      args.scenarioIds = arg.slice('--scenarios='.length).split(',').filter(Boolean);
    } else if (arg.startsWith('--silence-speed=')) {
      args.silenceSpeed = Number(arg.slice('--silence-speed='.length));
    } else if (arg.startsWith('--mute-silences=')) {
      const raw = arg.slice('--mute-silences='.length).toLowerCase();
      args.muteSilences = raw === 'true' || raw === '1' || raw === 'yes';
    }
  }
  return args;
}

function buildSegments(scenario) {
  let startMs = 0;
  return scenario.segments.map((segment, index) => {
    const start = startMs;
    startMs += segment.durationMs;
    return {
      ...segment,
      index,
      startMs: start,
      endMs: startMs,
    };
  });
}

function getSegmentAtTime(segments, intrinsicTimeMs) {
  return segments.find(segment => segment.startMs <= intrinsicTimeMs && intrinsicTimeMs < segment.endMs)
    ?? segments[segments.length - 1];
}

function distributeWallTimeAcrossSegments(samples, segments) {
  const totals = new Map(segments.map(segment => [segment.index, 0]));
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    const wallDeltaMs = Math.max(0, curr.wallMs - prev.wallMs);
    if (wallDeltaMs === 0) {
      continue;
    }
    const startMs = prev.currentTimeMs;
    const endMs = curr.currentTimeMs;
    const playedDeltaMs = Math.max(0, endMs - startMs);
    if (playedDeltaMs === 0) {
      const segment = getSegmentAtTime(segments, startMs);
      totals.set(segment.index, (totals.get(segment.index) ?? 0) + wallDeltaMs);
      continue;
    }
    for (const segment of segments) {
      const overlapStart = Math.max(segment.startMs, startMs);
      const overlapEnd = Math.min(segment.endMs, endMs);
      const overlapMs = Math.max(0, overlapEnd - overlapStart);
      if (overlapMs > 0) {
        totals.set(segment.index, (totals.get(segment.index) ?? 0) + wallDeltaMs * (overlapMs / playedDeltaMs));
      }
    }
  }
  return totals;
}

function summarizeTelemetry(telemetry, segments) {
  const byKind = {
    sound: { total: 0, silenceMarked: 0 },
    silence: { total: 0, silenceMarked: 0 },
  };
  for (const sample of telemetry) {
    const segment = getSegmentAtTime(segments, sample.intrinsicTime * 1000);
    byKind[segment.kind].total += 1;
    if (sample.chartSpeedName === 1) {
      byKind[segment.kind].silenceMarked += 1;
    }
  }
  const share = entry => entry.total === 0 ? null : entry.silenceMarked / entry.total;
  return {
    silenceShareOnSound: share(byKind.sound),
    silenceShareOnSilence: share(byKind.silence),
    totalSamples: telemetry.length,
  };
}

function summarizeChartCoverage(chartState, segments) {
  const render = chartState?.lastRenderDiagnostics;
  const silenceSeries = chartState?.series?.silenceSpeed;
  const soundedSeries = chartState?.series?.soundedSpeed;
  if (!render || !Array.isArray(silenceSeries) || !Array.isArray(soundedSeries)) {
    return null;
  }
  const visibleStartMs = render.chartEdgeTimeMs - chartState.widthPx * render.millisPerPixel;
  const coverage = {
    sound: { totalMs: 0, redMs: 0, greenMs: 0 },
    silence: { totalMs: 0, redMs: 0, greenMs: 0 },
  };
  const addCoverage = (series, key) => {
    for (let i = 0; i < series.length; i++) {
      const [startMs, value] = series[i];
      const nextPoint = series[i + 1];
      const endMs = nextPoint?.[0] ?? render.chartEdgeTimeMs;
      if (!(value > 0) || endMs <= startMs) {
        continue;
      }
      const clippedStartMs = Math.max(startMs, visibleStartMs);
      const clippedEndMs = Math.min(endMs, render.chartEdgeTimeMs);
      if (clippedEndMs <= clippedStartMs) {
        continue;
      }
      for (const segment of segments) {
        const overlapStart = Math.max(clippedStartMs, segment.startMs);
        const overlapEnd = Math.min(clippedEndMs, segment.endMs);
        const overlapMs = Math.max(0, overlapEnd - overlapStart);
        if (overlapMs <= 0) {
          continue;
        }
        const bucket = coverage[segment.kind];
        bucket[`${key}Ms`] += overlapMs;
      }
    }
  };
  for (const segment of segments) {
    const overlapStart = Math.max(visibleStartMs, segment.startMs);
    const overlapEnd = Math.min(render.chartEdgeTimeMs, segment.endMs);
    const overlapMs = Math.max(0, overlapEnd - overlapStart);
    if (overlapMs > 0) {
      coverage[segment.kind].totalMs += overlapMs;
    }
  }
  addCoverage(silenceSeries, 'red');
  addCoverage(soundedSeries, 'green');
  const share = (part, total) => total === 0 ? null : part / total;
  return {
    redShareOnSound: share(coverage.sound.redMs, coverage.sound.totalMs),
    redShareOnSilence: share(coverage.silence.redMs, coverage.silence.totalMs),
    greenShareOnSound: share(coverage.sound.greenMs, coverage.sound.totalMs),
    greenShareOnSilence: share(coverage.silence.greenMs, coverage.silence.totalMs),
    visibleStartMs,
    visibleEndMs: render.chartEdgeTimeMs,
    topColorRuns: render.topColorRuns,
  };
}

async function requestDiagnosticsAudio(extensionPage, tabId, messageType, frameId) {
  return extensionPage.evaluate(async ({ tabId, messageType, frameId }) => {
    const port = chrome.tabs.connect(tabId, { name: 'diagnostics', frameId });
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
  }, { tabId, messageType, frameId });
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

function analyzeRun({
  suiteId,
  scenario,
  fixtureState,
  telemetry,
  popupDiagnostics,
  screenshotPath,
  audioLevels,
  speedupSilenceAlignment,
  silenceOutputGainTelemetry,
  settings,
}) {
  const seekingEvents = fixtureState?.events?.filter(event => event.name === 'seeking').length ?? 0;
  const failureDebug = {
    fixtureSampleTail: fixtureState?.samples?.slice(-15) ?? null,
    fixtureEventTail: fixtureState?.events?.slice(-20) ?? null,
    telemetryTail: telemetry.slice(-20).map(sample => ({
      intrinsicTime: sample.intrinsicTime,
      chartSpeedName: sample.chartSpeedName,
      lastActualPlaybackRateChange: sample.lastActualPlaybackRateChange,
      lastSilenceSkippingSeek: sample.lastSilenceSkippingSeek,
      elementPlaybackActive: sample.elementPlaybackActive,
      inputVolume: sample.inputVolume,
    })),
    popupDiagnostics,
  };
  const debug = {
    telemetrySamples: telemetry.length,
    fixtureStarted: fixtureState?.started ?? false,
    fixtureEnded: fixtureState?.ended ?? false,
    fixtureCurrentTimeMs: fixtureState?.currentTimeMs ?? null,
    fixtureSamples: fixtureState?.samples?.length ?? 0,
    popupConnected: popupDiagnostics?.connected ?? false,
    popupTelemetryPresent: popupDiagnostics?.telemetryPresent ?? false,
    chartRenderPresent: !!popupDiagnostics?.chart?.lastRenderDiagnostics,
    screenshotPath,
  };
  if (!fixtureState) {
    return {
      passed: false,
      findings: ['Fixture state missing'],
      metrics: {
        ...debug,
        ...failureDebug,
      },
    };
  }
  if (fixtureState.failedToPlay) {
    return {
      passed: false,
      findings: ['Fixture media failed to start playback'],
      metrics: {
        ...debug,
        ...failureDebug,
      },
    };
  }
  if (!fixtureState.ended) {
    return {
      passed: false,
      findings: ['Fixture playback did not finish before timeout'],
      metrics: {
        ...debug,
        ...failureDebug,
      },
    };
  }
  if (!telemetry.length) {
    return {
      passed: false,
      findings: ['No telemetry received from the extension'],
      metrics: {
        ...debug,
        ...failureDebug,
      },
    };
  }

  const segments = buildSegments(scenario);
  const wallTimeBySegment = distributeWallTimeAcrossSegments(fixtureState.samples, segments);
  const telemetrySummary = summarizeTelemetry(telemetry, segments);
  const chartSummary = summarizeChartCoverage(popupDiagnostics?.chart, segments);
  const segmentSummaries = segments.map(segment => ({
    ...segment,
    observedWallMs: Number((wallTimeBySegment.get(segment.index) ?? 0).toFixed(1)),
    compressionRatio: Number((((wallTimeBySegment.get(segment.index) ?? 0) / segment.durationMs) || 0).toFixed(3)),
  }));

  const soundedSegments = segmentSummaries.filter(segment => segment.kind === 'sound');
  const silentSegments = segmentSummaries.filter(segment => segment.kind === 'silence');
  const meanRatio = items =>
    items.length === 0
      ? null
      : items.reduce((sum, item) => sum + item.compressionRatio, 0) / items.length;
  const soundedRatio = meanRatio(soundedSegments);
  const silentRatio = meanRatio(silentSegments);

  const findings = [];
  if (scenario.expectsSilenceCompression) {
    if (silentRatio == null || soundedRatio == null) {
      findings.push('Missing sound or silence samples for compression comparison');
    } else if (silentRatio >= soundedRatio * 0.75) {
      findings.push(
        `Silent parts were not compressed enough (${silentRatio.toFixed(2)} vs sounded ${soundedRatio.toFixed(2)})`
      );
    }
    const telemetryShouldDirectlyShowSilence = !(suiteId === 'cloning' && seekingEvents > 0);
    if (
      telemetryShouldDirectlyShowSilence
      && telemetrySummary.silenceShareOnSilence != null
      && telemetrySummary.silenceShareOnSilence < 0.2
    ) {
      findings.push(
        `Telemetry rarely marked silent regions as silence (${(telemetrySummary.silenceShareOnSilence * 100).toFixed(1)}%)`
      );
    }
  } else {
    if (telemetrySummary.silenceShareOnSound != null && telemetrySummary.silenceShareOnSound > 0.1) {
      findings.push(
        `Telemetry marked sounded regions as silence too often (${(telemetrySummary.silenceShareOnSound * 100).toFixed(1)}%)`
      );
    }
  }

  if (telemetrySummary.silenceShareOnSound != null && telemetrySummary.silenceShareOnSound > 0.25) {
    findings.push(
      `False silent markings on sounded regions are too frequent (${(telemetrySummary.silenceShareOnSound * 100).toFixed(1)}%)`
    );
  }
  if (!popupDiagnostics?.connected) {
    findings.push('Popup diagnostics did not connect to the target tab');
  } else if (!popupDiagnostics?.chart?.lastRenderDiagnostics) {
    findings.push('Popup chart diagnostics were not captured');
  } else if (chartSummary) {
    if (scenario.expectsSilenceCompression) {
      if (chartSummary.redShareOnSilence != null && chartSummary.redShareOnSilence < 0.12) {
        findings.push(
          `Chart shows too little red over silent regions (${(chartSummary.redShareOnSilence * 100).toFixed(1)}%)`
        );
      }
    }
    if (chartSummary.redShareOnSound != null && chartSummary.redShareOnSound > 0.18) {
      findings.push(
        `Chart shows too much red over sounded regions (${(chartSummary.redShareOnSound * 100).toFixed(1)}%)`
      );
    }
  }

  const suspiciousSoundCompression = soundedSegments
    .filter(segment => segment.durationMs >= 500 && segment.compressionRatio < 0.45);
  if (suspiciousSoundCompression.length > 0) {
    findings.push(
      `Some sounded segments were compressed unexpectedly (${suspiciousSoundCompression.map(segment => segment.index).join(', ')})`
    );
  }
  if (
    suiteId === 'stretching'
    && speedupSilenceAlignment.playbackSpeedupDurationMs >= 250
    && speedupSilenceAlignment.speedupMatchedShare != null
    && speedupSilenceAlignment.speedupMatchedShare < 0.65
  ) {
    findings.push(
      `Speedup happens without SILENCE telemetry too often `
      + `(${(speedupSilenceAlignment.speedupMatchedShare * 100).toFixed(1)}% overlap)`
    );
  }
  if (
    suiteId === 'stretching'
    && speedupSilenceAlignment.telemetrySilenceDurationMs >= 250
    && speedupSilenceAlignment.silenceMatchedShare != null
    && speedupSilenceAlignment.silenceMatchedShare < 0.65
  ) {
    findings.push(
      `SILENCE telemetry does not align with actual speedup often enough `
      + `(${(speedupSilenceAlignment.silenceMatchedShare * 100).toFixed(1)}% overlap)`
    );
  }
  if (
    suiteId === 'stretching'
    && silenceOutputGainTelemetry?.silenceSamples
    && silenceOutputGainTelemetry.lowGainShare != null
    && silenceOutputGainTelemetry.lowGainShare < 0.8
  ) {
    findings.push(
      `Processed output gain stays too high during SILENCE `
      + `(${(silenceOutputGainTelemetry.lowGainShare * 100).toFixed(1)}% low-gain samples)`
    );
  }
  findings.push(...getAudioLevelIssues(audioLevels, settings));

  return {
    passed: findings.length === 0,
    findings,
    metrics: {
      ...debug,
      soundedRatio,
      silentRatio,
      telemetry: telemetrySummary,
      chart: chartSummary,
      popupDiagnostics,
      segmentSummaries,
      seekingEvents,
      audioLevels,
      speedupSilenceAlignment,
      silenceOutputGainTelemetry,
    },
  };
}

async function waitForExtensionId(browser) {
  const existingTarget = browser.targets().find(target =>
    target.type() === 'service_worker' && target.url().startsWith('chrome-extension://')
  );
  const target = existingTarget ?? await browser.waitForTarget(candidate =>
    candidate.type() === 'service_worker' && candidate.url().startsWith('chrome-extension://'),
    { timeout: 15000 }
  ).catch(error => {
    const visibleTargets = browser.targets().map(target => ({
      type: target.type(),
      url: target.url(),
    }));
    throw new Error(
      `Extension service worker not found. Visible targets: ${JSON.stringify(visibleTargets, null, 2)}`,
      { cause: error }
    );
  });
  const match = /^chrome-extension:\/\/([a-z]{32})\//.exec(target.url());
  if (!match) {
    throw new Error(`Could not extract extension ID from target URL "${target.url()}"`);
  }
  return match[1];
}

async function startScenarioSession(extensionPage, fixtureUrl, settings) {
  return extensionPage.evaluate(async ({ fixtureUrl, settings }) => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    await chrome.storage.local.set(settings);
    const tab = await chrome.tabs.create({ url: fixtureUrl, active: true });
    await new Promise(resolve => {
      if (tab.status === 'complete') {
        resolve();
        return;
      }
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        window.__jumpCutterPlayFixture().catch(() => {});
      },
    });

    const frameId = await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(onMessage);
        reject(new Error('Timed out waiting for active contentStatus'));
      }, 10000);
      const onMessage = (message, sender) => {
        if (
          sender.tab?.id !== tab.id
          || message?.type !== 'contentStatus'
          || !message.elementLastActivatedAt
        ) {
          return;
        }
        clearTimeout(timeoutId);
        chrome.runtime.onMessage.removeListener(onMessage);
        resolve(sender.frameId ?? 0);
      };
      chrome.runtime.onMessage.addListener(onMessage);
      const trySend = () => {
        chrome.tabs.sendMessage(tab.id, 'checkContentStatus').catch(() => {
          setTimeout(trySend, 200);
        });
      };
      trySend();
    });

    const popupUrl = chrome.runtime.getURL(`popup/popup.html?tabId=${tab.id}&diagnostics=1`);
    await chrome.tabs.update(tab.id, { active: true });
    await sleep(100);
    return {
      tabId: tab.id,
      frameId,
      popupUrl,
    };
  }, { fixtureUrl, settings });
}

async function collectScenarioResults(extensionPage, tabId, frameId, expectedDurationMs) {
  return extensionPage.evaluate(async ({ tabId, frameId, expectedDurationMs }) => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const telemetry = [];
    const telemetryPort = chrome.tabs.connect(tabId, { name: 'telemetry', frameId });
    telemetryPort.onMessage.addListener(message => {
      if (message) {
        telemetry.push(message);
      }
    });
    const telemetryIntervalId = setInterval(() => {
      try {
        telemetryPort.postMessage(undefined);
      } catch (_error) {
        clearInterval(telemetryIntervalId);
      }
    }, 50);

    let fixtureState = null;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => JSON.parse(JSON.stringify(window.__jumpCutterFixture ?? null)),
      });
      fixtureState = result?.result ?? null;
      if (fixtureState && fixtureState.currentTimeMs >= expectedDurationMs - 50) {
        fixtureState.ended = true;
      }
      if (fixtureState?.ended || fixtureState?.failedToPlay) {
        break;
      }
      await sleep(100);
    }

    clearInterval(telemetryIntervalId);
    telemetryPort.disconnect();
    return {
      telemetry,
      fixtureState,
    };
  }, { tabId, frameId, expectedDurationMs });
}

async function restartScenarioPlayback(extensionPage, tabId) {
  await extensionPage.evaluate(async ({ tabId }) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async () => {
        const media = document.getElementById('fixture-media');
        const state = window.__jumpCutterFixture;
        if (state) {
          state.started = false;
          state.ended = false;
          state.failedToPlay = false;
          state.samples = [];
          state.events = [];
        }
        if (!media) {
          return;
        }
        media.pause();
        media.currentTime = 0;
        await new Promise(resolve => media.addEventListener('seeked', resolve, { once: true }));
        await media.play();
      },
    });
  }, { tabId });
}

async function cleanupScenarioSession(extensionPage, tabId) {
  return extensionPage.evaluate(async ({ tabId }) => {
    await chrome.tabs.remove(tabId).catch(() => {});
  }, { tabId });
}

async function waitForPopupDiagnosticsPage(browser, popupUrl) {
  const popupPage = await browser.newPage();
  await popupPage.setViewport({ width: 1280, height: 520 });
  await popupPage.goto(popupUrl, { waitUntil: 'networkidle0' });
  await popupPage.waitForFunction(
    () => !!window.__jumpCutterPopupDiagnostics?.getState,
    { timeout: 15000 }
  ).catch(async () => {
    const url = popupPage.url();
    const title = await popupPage.title().catch(() => '');
    const diagnosticsPresence = await popupPage.evaluate(() => ({
      popup: typeof window.__jumpCutterPopupDiagnostics,
      chart: typeof window.__jumpCutterChartDiagnostics,
      search: window.location.search,
      bodyText: document.body?.innerText?.slice(0, 400) ?? '',
    })).catch(() => null);
    console.warn('Popup diagnostics hook not ready', { url, title, diagnosticsPresence });
  });
  return popupPage;
}

async function getPopupDiagnostics(popupPage) {
  return popupPage.evaluate(() =>
    window.__jumpCutterPopupDiagnostics?.getState?.() ?? null
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const executablePath = process.env.CHROME_EXECUTABLE ?? defaultChromeExecutable;
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jump-cutter-diagnostics-'));
  const fixtureServer = await startFixtureServer();
  console.log(`Starting Chrome diagnostics with extension at ${extensionPath}`);
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

  try {
    const extensionId = await waitForExtensionId(browser);
    console.log(`Loaded extension ${extensionId}`);
    const extensionPage = await browser.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/options/index.html`, {
      waitUntil: 'networkidle0',
    });

    const selectedSuites = controllerSuites.filter(suite =>
      args.controller === 'all' || suite.id === args.controller
    );
    const selectedScenarios = args.scenarioIds
      ? args.scenarioIds.map(getScenarioById)
      : scenarios;

    const report = {
      createdAt: new Date().toISOString(),
      extensionId,
      executablePath,
      fixtureOrigin: fixtureServer.origin,
      runs: [],
      passed: true,
    };

    for (const suite of selectedSuites) {
      for (const scenario of selectedScenarios) {
        const fixtureUrl = `${fixtureServer.origin}/fixture.html?scenario=${encodeURIComponent(scenario.id)}`;
        const settings = {
          ...defaultDiagnosticsSettings,
          experimentalControllerType: suite.controllerKind,
          ...suite.settings,
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
        const expectedDurationMs = scenario.segments.reduce((sum, segment) => sum + segment.durationMs, 0);
        const session = await startScenarioSession(extensionPage, fixtureUrl, settings);
        const popupPage = await waitForPopupDiagnosticsPage(browser, session.popupUrl);
        await popupPage.waitForFunction(() => {
          const state = window.__jumpCutterPopupDiagnostics?.getState?.();
          return state?.connected && state?.latestTelemetryRecord?.controllerType !== undefined;
        }, { timeout: 10000 }).catch(() => {});
        await extensionPage.evaluate(async ({ tabId }) => {
          await chrome.tabs.update(tabId, { active: true });
        }, { tabId: session.tabId });
        let rawRun;
        let popupDiagnostics;
        const outputDir = path.join(repoRoot, 'diagnostics-output');
        await fs.mkdir(outputDir, { recursive: true });
        const screenshotPath = path.join(outputDir, `${suite.id}-${scenario.id}-popup.png`);
        try {
          const audioCaptureStart = await requestDiagnosticsAudio(
            extensionPage,
            session.tabId,
            'startAudioCapture',
            session.frameId,
          );
          await restartScenarioPlayback(extensionPage, session.tabId);
          rawRun = await collectScenarioResults(
            extensionPage,
            session.tabId,
            session.frameId,
            expectedDurationMs,
          );
          const audioCapture = await requestDiagnosticsAudio(
            extensionPage,
            session.tabId,
            'stopAudioCapture',
            session.frameId,
          );
          await popupPage.bringToFront().catch(() => {});
          await new Promise(resolve => setTimeout(resolve, 700));
          await popupPage.waitForFunction(() => {
            const state = window.__jumpCutterPopupDiagnostics?.getState?.();
            return state?.connected && state?.chart?.lastRenderDiagnostics;
          }, { timeout: 5000 }).catch(() => {});
          popupDiagnostics = await getPopupDiagnostics(popupPage);
          await popupPage.screenshot({ path: screenshotPath });
          rawRun.audioCaptureStart = audioCaptureStart;
          rawRun.audioCapture = audioCapture;
          rawRun.audioPath = await writeAudioArtifact(
            outputDir,
            `${suite.id}-${scenario.id}-audio`,
            audioCapture,
          );
        } finally {
          await popupPage.close().catch(() => {});
          await cleanupScenarioSession(extensionPage, session.tabId).catch(() => {});
        }
        const analysis = analyzeRun({
          suiteId: suite.id,
          scenario,
          fixtureState: rawRun.fixtureState,
          telemetry: rawRun.telemetry,
          popupDiagnostics,
          screenshotPath,
          audioLevels: analyzeCapturedAudioLevels({
            audioPath: rawRun.audioPath,
            playbackSamples: rawRun.fixtureState?.samples ?? [],
            soundedSpeed: settings.soundedSpeed,
            telemetry: rawRun.telemetry,
            audioCaptureStartedAtUnixTime: rawRun.audioCapture?.startedAtUnixTime,
          }),
          speedupSilenceAlignment: analyzeSilenceSpeedAlignment({
            playbackSamples: rawRun.fixtureState?.samples ?? [],
            soundedSpeed: settings.soundedSpeed,
            telemetry: rawRun.telemetry,
          }),
          silenceOutputGainTelemetry: analyzeSilenceOutputGainTelemetry(rawRun.telemetry),
          settings,
        });
        report.runs.push({
          controller: suite.id,
          scenario: scenario.id,
          description: scenario.description,
          passed: analysis.passed,
          findings: analysis.findings,
          metrics: analysis.metrics,
          screenshotPath,
          audioPath: rawRun.audioPath ?? null,
          audioCaptureStart: rawRun.audioCaptureStart ?? null,
          audioCaptureMimeType: rawRun.audioCapture?.mimeType ?? null,
        });
        if (!analysis.passed) {
          report.passed = false;
        }
      }
    }
    const outputDir = path.join(repoRoot, 'diagnostics-output');
    await fs.mkdir(outputDir, { recursive: true });
    const latestPath = path.join(outputDir, 'latest.json');
    await fs.writeFile(latestPath, JSON.stringify(report, null, 2));

    const summary = report.runs.map(run => {
      const status = run.passed ? 'PASS' : 'FAIL';
      const findingSummary = run.findings.length === 0 ? '' : ` - ${run.findings.join('; ')}`;
      return `${status} ${run.controller}/${run.scenario}${findingSummary}`;
    }).join('\n');
    console.log(summary);
    console.log(`\nReport: ${latestPath}`);
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
    await fixtureServer.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
}

await main();
