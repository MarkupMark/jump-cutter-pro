# Chrome Diagnostics

Automated end-to-end diagnostics for the unpacked Chromium build of the extension.

What it does:
- launches Google Chrome with `dist-chromium`
- serves deterministic local audio fixtures on `localhost`
- configures the extension via `chrome.storage.local`
- records the real playback behavior of the media element
- collects extension telemetry
- saves an audio artifact of the extension output when capture is supported
- measures RMS and peak level of the captured audio during accelerated vs normal playback spans
- writes a machine-readable report to `diagnostics-output/latest.json`

Run the full suite:

```bash
npm run diagnostics:chromium
```

Run a subset:

```bash
node tools/diagnostics/run-chromium-diagnostics.mjs --controller=stretching --scenarios=long-silences
node tools/diagnostics/run-chromium-diagnostics.mjs --controller=cloning
node tools/diagnostics/run-chromium-diagnostics.mjs --controller=stretching --scenarios=long-silences --silence-speed=8 --mute-silences=false
```

Run diagnostics against a real local media file:

```bash
npm run diagnostics:local-file -- --file=./sample_audio.mp3
node tools/diagnostics/run-local-file-diagnostics.mjs --file=./sample_audio.mp3 --controller=cloning
node tools/diagnostics/run-local-file-diagnostics.mjs --file=./sample_audio.mp3 --controller=stretching --silence-speed=8 --mute-silences=false
```

Run the standalone WebAudio bypass demo:

```bash
npm run diagnostics:webaudio-demo
```

The page exposes three modes:
- native `audio` element only
- WebAudio graph with `gain=0.01`
- WebAudio graph with `gain=0.01` and `element.muted=true`

If mode 2 is still clearly audible but mode 3 is not, that strongly suggests that the native media-element output is
still being heard alongside the WebAudio graph.

Requirements:
- `dist-chromium` must exist
- Google Chrome must be available at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
  or via `CHROME_EXECUTABLE=/path/to/chrome`

Current scenarios:
- `long-silences`
- `transient-spike`
- `continuous-quiet-sound`

Local-file diagnostics notes:
- writes settings directly to `chrome.storage.local` using the real extension keys
- verifies that the requested controller actually became active (`controllerType`)
- writes a JSON report to `diagnostics-output/<file>.local-diagnostics.json`
- saves an audio artifact to `diagnostics-output/*-audio.webm` or `*.ogg` so you can listen to the processed output
- reports `metrics.audioLevels` and raises an issue when accelerated output stays too loud, especially at high silence speeds
