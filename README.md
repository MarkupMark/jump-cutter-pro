# <img src="./src/icons/icon.svg" alt="Logo" height="32"/> Jump Cutter Pro

> **Fork** of [Jump Cutter](https://github.com/WofWca/jumpcutter) by WofWca — enhanced with additional features.  
> Licensed under GNU AGPL-3.0. Source code is available in this repository as required by the license.

---

Skips silent parts of videos **in real time**, directly in your browser.

Ideal for: lectures, webinars, podcasts, course recordings and any other unedited video.

## ✨ New features (vs original)

| Feature | Description |
|---|---|
| 🔇 **Mute during silences** | Audio is muted (via GainNode ramp) during sped-up silence parts, eliminating the metallic artifact at high speeds (e.g. 8×) |
| 🛡️ **Transient noise filter** | Ignores brief loud sounds (mic taps, keyboard clicks) shorter than a configurable duration so they don't interrupt silence speedup |
| 📊 **Detachable stats popup** | The extension popup can be detached into a floating window and stays connected to the original video tab |
| ↺ **Reset saved time** | Button to reset the "time saved" counter, useful for tracking per-video savings |
| ⏩ **Silence speed always visible** | The silence speed slider is now always shown in the popup (was previously gated behind "Advanced Mode") |

## 🚀 Installation (Chromium / Brave / Chrome)

1. Download the latest `dist-chromium.zip` from [Releases](../../releases)
2. Unzip it
3. Open `brave://extensions` (or `chrome://extensions`)
4. Enable **Developer mode** (top right toggle)
5. Click **Load unpacked** and select the unzipped folder

## ⚙️ Usage

1. Navigate to any video page (YouTube, Coursera, etc.)
2. Click the extension icon in the toolbar
3. Check **Enable** — the extension will start skipping silences immediately
4. Adjust the sliders to your taste:
   - **Silence speed**: how fast to go during silent parts (default 8×)
   - **Volume threshold**: how loud audio must be to count as "not silence"
   - **Margin before/after**: padding around each speech segment
5. Toggle **Mute during silences** 🔇 to eliminate audio artifacts at high speeds
6. Toggle **Transient noise filter** 🛡️ to prevent mic taps from interrupting speedup

## 🔧 Building from source

```bash
npm install
npm run build:chromium   # output in dist-chromium/
```

Requires Node.js 18+.

## 📄 License & Attribution

This project is a derivative work of **Jump Cutter** by [WofWca](https://github.com/WofWca/jumpcutter),  
licensed under the [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html).

All original copyrights are preserved. This fork is also released under AGPL-3.0.

Original project: https://github.com/WofWca/jumpcutter

## 🙏 Credits

- Original extension: [WofWca/jumpcutter](https://github.com/WofWca/jumpcutter)
- Inspired by [carykh](https://youtu.be/DQ8orIurGxw)
