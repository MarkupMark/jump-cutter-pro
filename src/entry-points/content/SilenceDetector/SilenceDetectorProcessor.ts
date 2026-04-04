/**
 * @license
 * Copyright (C) 2020, 2021, 2022, 2025  WofWca <wofwca@protonmail.com>
 *
 * This file is part of Jump Cutter Browser Extension.
 *
 * Jump Cutter Browser Extension is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Jump Cutter Browser Extension is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Jump Cutter Browser Extension.  If not, see <https://www.gnu.org/licenses/>.
 */

import WorkaroundAudioWorkletProcessor from '../WorkaroundAudioWorkletProcessor';
import { SilenceDetectorMessage, SilenceDetectorEventType } from './SilenceDetectorMessage';
import type { AudioContextTime } from "@/helpers";

const assumeSoundedWhenUnknown = true;

let devErrorShown = false;

/**
 * Takes volume data (e.g. from `VolumeFilter`) as input. Sends `SILENCE_START` when there has been silence for the
 * last `durationThreshold`, or `SILENCE_END` when loud samples have been sustained for at least `minSoundedDuration`
 * (to filter out transient noises like mic taps or keyboard clicks).
 */
class SilenceDetectorProcessor extends WorkaroundAudioWorkletProcessor {
  _lastLoudSampleInd: AudioContextTime;
  _lastEmitedEventIsSilenceStartEvent: boolean;
  /** How many consecutive loud samples we have seen since the last quiet sample. */
  _consecutiveLoudSamples: number;
  /** Grace period after SILENCE_END to avoid bouncing back to silence inside speech onset. */
  _silenceStartSuppressedUntilSampleInd: number;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  constructor(options: any) {
    super(options);
    const initialDuration = options.processorOptions?.initialDuration ?? 0;

    // There is not really one particular sample, only a frame,
    // so let's consider the start of the current frame that one sample.
    const currSampleInd = currentFrame;

    this._lastLoudSampleInd = currSampleInd - initialDuration * sampleRate;
    this._lastEmitedEventIsSilenceStartEvent = false;
    this._consecutiveLoudSamples = 0;
    this._silenceStartSuppressedUntilSampleInd = currSampleInd;
  }
  static get parameterDescriptors() {
    return [
      {
        name: 'volumeThreshold',
        defaultValue: 0.10, // TODO DRY.
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate',
      },
      {
        // Don't do anything if silence lasts shorter than this.
        name: 'durationThreshold',
        minValue: 0,
        automationRate: 'k-rate',
      },
      {
        // How long loud audio must be sustained (in seconds) before it is truly treated as "sounded" (transient filter).
        // 0 = disabled (behave like before - immediately emit SILENCE_END on first loud sample).
        name: 'minSoundedDuration',
        defaultValue: 0,
        minValue: 0,
        automationRate: 'k-rate',
      },
    ];
  }

  // Just so we don't mess up `>=` and `>` somewhere.
  isPastDurationThreshold(saimpleInd: number, durationThresholdSamples: number) {
    return saimpleInd >= this._lastLoudSampleInd + durationThresholdSamples;
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    const volumeThreshold = parameters.volumeThreshold[0];
    const minSoundedDurationSamples = Math.round(parameters.minSoundedDuration[0] * sampleRate);
    const input = inputs[0];
    // TODO perf: can we stop checking this every time after we get an input connected?
    if (input.length === 0) {
      if (!assumeSoundedWhenUnknown) {
        throw new Error('The below code assumes video parts to be sounded when it is unknown');
      }
      // This technically should be `currentFrame + currentFrameIncrement - 1`,
      // but we don't have a way to get the latter, and it doesn't matter
      // too much here.
      this._lastLoudSampleInd = currentFrame;
      return this.keepAlive;
    }

    if (IS_DEV_MODE) {
      const numChannels = input.length;
      if (numChannels !== 1 && !devErrorShown) {
        // See `VolumeFilterProcessor`. It funnels all the channels into a single one.
        // If it's no longer the case, revert the commit that introduced this check.
        console.error('SilenceDetectorProcessor assumes that there\'s only one channel on its input');
        devErrorShown = true;
      }
    }

    const channel = input[0];
    const numSamples = input[0].length;
    const durationThresholdSamples = parameters.durationThreshold[0] * sampleRate;
    for (let sampleI = 0; sampleI < numSamples; sampleI++) {
      const sampleIGlobal = currentFrame + sampleI;
      const sample = channel[sampleI];
      const sampleIsLoud = sample >= volumeThreshold;
      if (sampleIsLoud) {
        this._consecutiveLoudSamples++;

        // Always emit SILENCE_END on the very first loud sample so real speech starts immediately.
        // We do NOT delay this by minSoundedDuration, so there is no "clipping" of speech starts.
        if (this._lastEmitedEventIsSilenceStartEvent) {
          const m: SilenceDetectorMessage = [
            SilenceDetectorEventType.SILENCE_END,
            sampleIGlobal / sampleRate,
          ];
          this.port.postMessage(m);
          this._lastEmitedEventIsSilenceStartEvent = false;
          this._silenceStartSuppressedUntilSampleInd = sampleIGlobal + minSoundedDurationSamples;
        }

        // However, only update _lastLoudSampleInd once loud audio has been sustained for
        // minSoundedDuration. This means brief transient noises (e.g. mic taps < N ms) do NOT
        // reset the silence timer. Once the transient ends and silence returns,
        // isPastDurationThreshold will be true almost immediately (because _lastLoudSampleInd
        // was never updated) and SILENCE_START re-fires quickly, so the interruption is minimal.
        // With muteSilences enabled the brief SILENCE_END→SILENCE_START cycle is mostly inaudible.
        const isTrulySounded =
          minSoundedDurationSamples === 0
          || this._consecutiveLoudSamples >= minSoundedDurationSamples;
        if (isTrulySounded) {
          this._lastLoudSampleInd = sampleIGlobal;
        }
      } else {
        this._consecutiveLoudSamples = 0;
        if (
          !this._lastEmitedEventIsSilenceStartEvent
          && sampleIGlobal >= this._silenceStartSuppressedUntilSampleInd
          && this.isPastDurationThreshold(sampleIGlobal, durationThresholdSamples)
        ) {
          const m: SilenceDetectorMessage = [
            SilenceDetectorEventType.SILENCE_START,
            sampleIGlobal / sampleRate,
          ];
          this.port.postMessage(m);
          this._lastEmitedEventIsSilenceStartEvent = true;
        }
      }
    }
    return this.keepAlive;
  }
}

registerProcessor('SilenceDetectorProcessor', SilenceDetectorProcessor);
