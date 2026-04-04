export const ControllerKind = {
  STRETCHING: 1,
  CLONING: 2,
};

export const defaultDiagnosticsSettings = {
  enabled: true,
  applyTo: 'both',
  soundedSpeed: 1,
  silenceSpeedSpecificationMethod: 'absolute',
  silenceSpeedRaw: 4,
  volumeThreshold: 0.02,
  marginBefore: 0,
  marginAfter: 0.03,
  muteSilences: true,
  transientNoiseFilterEnabled: true,
  transientNoiseFilterMinSoundedDurationMs: 80,
  dontAttachToCrossOriginMedia: true,
  enableDesyncCorrection: false,
  oppositeDayMode: 'off',
  popupChartLengthInSeconds: 8,
  popupChartHeightPx: 100,
};

export const controllerSuites = [
  {
    id: 'stretching',
    controllerKind: ControllerKind.STRETCHING,
    settings: {},
  },
  {
    id: 'cloning',
    controllerKind: ControllerKind.CLONING,
    settings: {},
  },
];

export const scenarios = [
  {
    id: 'long-silences',
    description: 'Long silent spans should be compressed significantly relative to sounded spans.',
    segments: [
      { kind: 'sound', durationMs: 1000, amplitude: 0.35, frequencyHz: 440 },
      { kind: 'silence', durationMs: 1800 },
      { kind: 'sound', durationMs: 900, amplitude: 0.28, frequencyHz: 660 },
      { kind: 'silence', durationMs: 1600 },
      { kind: 'sound', durationMs: 1100, amplitude: 0.30, frequencyHz: 550 },
    ],
    expectsSilenceCompression: true,
  },
  {
    id: 'transient-spike',
    description: 'A very brief transient inside a silence should not fully break silence compression.',
    segments: [
      { kind: 'sound', durationMs: 1000, amplitude: 0.35, frequencyHz: 440 },
      { kind: 'silence', durationMs: 1000 },
      { kind: 'sound', durationMs: 30, amplitude: 0.45, frequencyHz: 1200 },
      { kind: 'silence', durationMs: 1200 },
      { kind: 'sound', durationMs: 1000, amplitude: 0.30, frequencyHz: 550 },
    ],
    expectsSilenceCompression: true,
  },
  {
    id: 'continuous-quiet-sound',
    description: 'Continuous quiet but above-threshold sound should not be treated as silence.',
    segments: [
      { kind: 'sound', durationMs: 3200, amplitude: 0.06, frequencyHz: 330 },
    ],
    expectsSilenceCompression: false,
  },
];

export function getScenarioById(id) {
  const scenario = scenarios.find(candidate => candidate.id === id);
  if (!scenario) {
    throw new Error(`Unknown diagnostics scenario "${id}"`);
  }
  return scenario;
}
