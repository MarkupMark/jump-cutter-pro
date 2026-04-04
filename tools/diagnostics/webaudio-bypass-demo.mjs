import http from 'node:http';

const sampleRate = 48_000;

function clampSample(sample) {
  return Math.max(-1, Math.min(1, sample));
}

function createDemoWavBuffer() {
  const segments = [
    { durationMs: 1200, amplitude: 0.32, frequencyHz: 440 },
    { durationMs: 500, amplitude: 0.0, frequencyHz: 440 },
    { durationMs: 1200, amplitude: 0.32, frequencyHz: 660 },
    { durationMs: 500, amplitude: 0.0, frequencyHz: 660 },
    { durationMs: 1200, amplitude: 0.32, frequencyHz: 550 },
  ];
  const totalSamples = Math.round(
    segments.reduce((sum, segment) => sum + segment.durationMs, 0) * sampleRate / 1000
  );
  const buffer = Buffer.alloc(44 + totalSamples * 2);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.byteLength - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(totalSamples * 2, 40);

  let sampleIndex = 0;
  let byteOffset = 44;
  for (const segment of segments) {
    const segmentSamples = Math.round(segment.durationMs * sampleRate / 1000);
    for (let i = 0; i < segmentSamples; i++) {
      const sample = segment.amplitude === 0
        ? 0
        : segment.amplitude * Math.sin(2 * Math.PI * segment.frequencyHz * sampleIndex / sampleRate);
      buffer.writeInt16LE(Math.round(clampSample(sample) * 0x7fff), byteOffset);
      byteOffset += 2;
      sampleIndex += 1;
    }
  }

  return buffer;
}

function createHtml() {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>WebAudio Bypass Demo</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: ui-sans-serif, system-ui, sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, #25344a, transparent 35%),
          linear-gradient(160deg, #080b12, #121824);
        color: #eef4ff;
      }
      main {
        max-width: 920px;
        margin: 0 auto;
        padding: 32px 20px 48px;
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(28px, 5vw, 44px);
      }
      p {
        line-height: 1.5;
      }
      .panel {
        margin-top: 20px;
        padding: 18px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 18px;
        background: rgba(8, 12, 18, 0.74);
        backdrop-filter: blur(10px);
      }
      .buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 16px 0;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 10px 16px;
        background: #d7e7ff;
        color: #09111e;
        font: inherit;
        cursor: pointer;
      }
      button.secondary {
        background: #1f2c40;
        color: #eef4ff;
      }
      code, pre {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      #log {
        white-space: pre-wrap;
        word-break: break-word;
        min-height: 180px;
        margin: 0;
      }
      .hint {
        color: #b9c8dd;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>WebAudio bypass demo</h1>
      <p>
        Questo demo serve a capire se l'audio nativo del tag <code>&lt;audio&gt;</code> continui a uscire
        anche quando il ramo WebAudio va quasi a zero.
      </p>
      <div class="panel">
        <audio id="demo-audio" controls preload="auto" src="/demo.wav"></audio>
        <div class="buttons">
          <button data-mode="native">1. Native only</button>
          <button data-mode="webaudio-low-gain">2. WebAudio gain 0.01</button>
          <button data-mode="webaudio-muted-element">3. WebAudio gain 0.01 + element muted</button>
          <button class="secondary" id="stop-btn">Stop / reset</button>
        </div>
        <p class="hint">
          Se nel punto 2 senti ancora il tono quasi come prima, ma nel punto 3 sparisce, allora il sospetto di bypass
          del path nativo è forte.
        </p>
      </div>
      <div class="panel">
        <strong>Log</strong>
        <pre id="log"></pre>
      </div>
    </main>
    <script>
      const audio = document.getElementById('demo-audio');
      const logEl = document.getElementById('log');
      const stopBtn = document.getElementById('stop-btn');
      const buttons = [...document.querySelectorAll('button[data-mode]')];
      let audioContext;
      let sourceNode;
      let gainNode;
      let lowPassNode;

      function log(message) {
        const timestamp = new Date().toLocaleTimeString();
        logEl.textContent = '[' + timestamp + '] ' + message + '\\n' + logEl.textContent;
      }

      async function ensureGraph() {
        if (!audioContext) {
          audioContext = new AudioContext();
        }
        if (!sourceNode) {
          sourceNode = audioContext.createMediaElementSource(audio);
          lowPassNode = audioContext.createBiquadFilter();
          lowPassNode.type = 'lowpass';
          lowPassNode.frequency.value = 900;
          gainNode = audioContext.createGain();
          sourceNode.connect(lowPassNode);
          lowPassNode.connect(gainNode);
          gainNode.connect(audioContext.destination);
          log('WebAudio graph created');
        }
        if (audioContext.state !== 'running') {
          await audioContext.resume();
        }
      }

      async function runMode(mode) {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        audio.volume = 1;

        if (mode === 'native') {
          log('Mode native only: audio element unchanged, no WebAudio graph required');
          await audio.play();
          return;
        }

        await ensureGraph();
        gainNode.gain.value = 0.01;
        lowPassNode.frequency.value = 900;

        if (mode === 'webaudio-low-gain') {
          audio.muted = false;
          log('Mode webaudio-low-gain: graph active, gain=0.01, element.muted=false');
        } else if (mode === 'webaudio-muted-element') {
          audio.muted = true;
          log('Mode webaudio-muted-element: graph active, gain=0.01, element.muted=true');
        }

        await audio.play();
      }

      buttons.forEach(button => {
        button.addEventListener('click', () => {
          runMode(button.dataset.mode).catch(error => {
            log('ERROR: ' + String(error));
            console.error(error);
          });
        });
      });

      stopBtn.addEventListener('click', () => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        if (gainNode) {
          gainNode.gain.value = 1;
        }
        log('Reset player state');
      });

      audio.addEventListener('play', () => log('audio.play() started'));
      audio.addEventListener('ended', () => log('audio ended'));
      audio.addEventListener('volumechange', () => {
        log('volumechange: muted=' + audio.muted + ', volume=' + audio.volume);
      });
    </script>
  </body>
</html>`;
}

async function main() {
  const wavBuffer = createDemoWavBuffer();
  const html = createHtml();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (url.pathname === '/demo.wav') {
      res.writeHead(200, {
        'content-type': 'audio/wav',
        'cache-control': 'no-store',
        'content-length': wavBuffer.byteLength,
      });
      res.end(wavBuffer);
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
    throw new Error('Could not determine demo server address');
  }
  const url = `http://127.0.0.1:${address.port}`;

  console.log(`WebAudio bypass demo: ${url}`);
  console.log('Open the page and compare mode 2 vs mode 3.');

  const close = async () => {
    await new Promise(resolve => server.close(resolve));
    process.exit(0);
  };
  process.on('SIGINT', () => void close());
  process.on('SIGTERM', () => void close());
}

await main();
