import http from 'node:http';
import { getScenarioById, scenarios } from './scenarios.mjs';

const sampleRate = 48000;

function clampSample(sample) {
  return Math.max(-1, Math.min(1, sample));
}

function createWavBuffer(scenario) {
  const totalSamples = Math.round(
    scenario.segments.reduce((sum, segment) => sum + segment.durationMs, 0) * sampleRate / 1000
  );
  const bytesPerSample = 2;
  const dataSize = totalSamples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let sampleIndex = 0;
  let byteOffset = 44;
  for (const segment of scenario.segments) {
    const segmentSamples = Math.round(segment.durationMs * sampleRate / 1000);
    for (let i = 0; i < segmentSamples; i++) {
      let sample = 0;
      if (segment.kind === 'sound') {
        const frequencyHz = segment.frequencyHz ?? 440;
        const amplitude = segment.amplitude ?? 0.25;
        sample = amplitude * Math.sin(2 * Math.PI * frequencyHz * (sampleIndex / sampleRate));
      }
      buffer.writeInt16LE(Math.round(clampSample(sample) * 0x7fff), byteOffset);
      byteOffset += 2;
      sampleIndex += 1;
    }
  }

  return buffer;
}

function parseByteRange(rangeHeader, size) {
  if (!rangeHeader?.startsWith('bytes=')) {
    return null;
  }
  const [startRaw, endRaw] = rangeHeader.slice('bytes='.length).split('-', 2);
  if (!startRaw && !endRaw) {
    return null;
  }

  let start;
  let end;
  if (!startRaw) {
    const suffixLength = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number.parseInt(startRaw, 10);
    end = endRaw ? Number.parseInt(endRaw, 10) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  if (start < 0 || end < start || start >= size) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

function createFixtureHtml(scenario, wavUrlPath) {
  const scenarioJson = JSON.stringify(scenario);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Jump Cutter Diagnostics Fixture</title>
    <style>
      body {
        margin: 24px;
        font: 14px/1.4 sans-serif;
      }
      audio {
        width: min(720px, 100%);
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: #f3f3f3;
        padding: 12px;
      }
    </style>
  </head>
  <body>
    <h1>Jump Cutter Diagnostics Fixture</h1>
    <audio id="fixture-media" controls preload="auto" src="${wavUrlPath}"></audio>
    <pre id="scenario-json"></pre>
    <script>
      const scenario = ${scenarioJson};
      document.getElementById('scenario-json').textContent = JSON.stringify(scenario, null, 2);
      const media = document.getElementById('fixture-media');
      const state = {
        scenario,
        started: false,
        ended: false,
        failedToPlay: false,
        samples: [],
        events: [],
      };
      const t0 = performance.now();
      const toMs = value => Math.round(value * 1000) / 1000;
      const sample = () => {
        state.currentTimeMs = toMs(media.currentTime * 1000);
        state.samples.push({
          wallMs: toMs(performance.now() - t0),
          currentTimeMs: state.currentTimeMs,
          playbackRate: media.playbackRate,
          paused: media.paused,
          muted: media.muted,
          ended: media.ended,
        });
      };
      const logEvent = name => {
        state.events.push({
          name,
          wallMs: toMs(performance.now() - t0),
          currentTimeMs: toMs(media.currentTime * 1000),
          playbackRate: media.playbackRate,
        });
      };
      ['play', 'playing', 'pause', 'ratechange', 'seeking', 'seeked', 'ended', 'timeupdate', 'waiting']
        .forEach(name => media.addEventListener(name, () => {
          if (name === 'play' || name === 'playing') {
            state.started = true;
          }
          if (name === 'ended') {
            state.ended = true;
          }
          logEvent(name);
        }));
      setInterval(sample, 50);
      sample();
      window.__jumpCutterFixture = state;
      window.__jumpCutterPlayFixture = async () => {
        try {
          await media.play();
        } catch (error) {
          state.failedToPlay = true;
          state.events.push({
            name: 'play-error',
            wallMs: toMs(performance.now() - t0),
            message: String(error),
          });
          throw error;
        }
      };
    </script>
  </body>
</html>`;
}

export async function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Diagnostics fixture server. Available scenarios: ${scenarios.map(({ id }) => id).join(', ')}`);
      return;
    }

    if (url.pathname === '/fixture.html') {
      const scenario = getScenarioById(url.searchParams.get('scenario') ?? '');
      const wavPath = `/fixture.wav?scenario=${encodeURIComponent(scenario.id)}`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(createFixtureHtml(scenario, wavPath));
      return;
    }

    if (url.pathname === '/fixture.wav') {
      const scenario = getScenarioById(url.searchParams.get('scenario') ?? '');
      const wav = createWavBuffer(scenario);
      const maybeRange = parseByteRange(req.headers.range, wav.byteLength);
      if (req.headers.range && !maybeRange) {
        res.writeHead(416, {
          'content-type': 'text/plain; charset=utf-8',
          'content-range': `bytes */${wav.byteLength}`,
        });
        res.end('Requested range not satisfiable');
        return;
      }
      if (maybeRange) {
        const { start, end } = maybeRange;
        res.writeHead(206, {
          'content-type': 'audio/wav',
          'cache-control': 'no-store',
          'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${wav.byteLength}`,
          'content-length': end - start + 1,
        });
        res.end(wav.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, {
        'content-type': 'audio/wav',
        'cache-control': 'no-store',
        'accept-ranges': 'bytes',
        'content-length': wav.byteLength,
      });
      res.end(wav);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not determine fixture server address');
  }

  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
