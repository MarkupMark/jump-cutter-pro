export interface DiagnosticsAudioCaptureStartResult {
  started: boolean,
  reason?: string,
  source?: string,
  mimeType?: string,
}

export interface DiagnosticsAudioCaptureStopResult {
  source: string,
  mimeType: string,
  base64Audio: string,
  startedAtUnixTime: number,
  stoppedAtUnixTime: number,
}

function pickSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return '';
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function getMediaElementCaptureStream(element: HTMLMediaElement): MediaStream | null {
  const elementWithCapture = element as HTMLMediaElement & {
    captureStream?: () => MediaStream,
    mozCaptureStream?: () => MediaStream,
  };
  const captureStream =
    elementWithCapture.captureStream
    || (BUILD_DEFINITIONS.BROWSER === 'gecko' ? elementWithCapture.mozCaptureStream : undefined);
  if (!captureStream) {
    return null;
  }
  try {
    return captureStream.call(elementWithCapture);
  } catch (_error) {
    return null;
  }
}

export default class DiagnosticsAudioCapture {
  private activeRecording?: {
    chunks: Blob[],
    mimeType: string,
    recorder: MediaRecorder,
    source: string,
    startedAtUnixTime: number,
    stream: MediaStream,
  };

  constructor(
    private readonly getStream: () => MediaStream | null,
    private readonly source: string,
    private readonly cleanupStream: (stream: MediaStream) => void = (stream) => {
      stream.getTracks().forEach(track => track.stop());
    }
  ) {}

  async start(): Promise<DiagnosticsAudioCaptureStartResult> {
    await this.stop().catch(() => null);

    if (typeof MediaRecorder === 'undefined') {
      return { started: false, reason: 'media-recorder-unavailable' };
    }

    const stream = this.getStream();
    if (!stream || stream.getAudioTracks().length === 0) {
      return { started: false, reason: 'no-audio-stream' };
    }

    const mimeType = pickSupportedMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.addEventListener('dataavailable', event => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    });
    recorder.start(200);
    this.activeRecording = {
      chunks,
      mimeType: mimeType || recorder.mimeType,
      recorder,
      source: this.source,
      startedAtUnixTime: Date.now() / 1000,
      stream,
    };
    return {
      started: true,
      source: this.source,
      mimeType: this.activeRecording.mimeType,
    };
  }

  async stop(): Promise<DiagnosticsAudioCaptureStopResult | null> {
    const recording = this.activeRecording;
    if (!recording) {
      return null;
    }

    const { recorder } = recording;
    if (recorder.state !== 'inactive') {
      await new Promise<void>((resolve, reject) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.addEventListener('error', () => reject(new Error('audio-capture-error')), { once: true });
        recorder.stop();
      });
    }

    const blob = new Blob(recording.chunks, { type: recording.mimeType });
    const arrayBuffer = await blob.arrayBuffer();
    const result = {
      source: recording.source,
      mimeType: blob.type || recording.mimeType,
      base64Audio: arrayBufferToBase64(arrayBuffer),
      startedAtUnixTime: recording.startedAtUnixTime,
      stoppedAtUnixTime: Date.now() / 1000,
    };

    this.cleanupStream(recording.stream);
    this.activeRecording = undefined;
    return result;
  }

  destroy(): void {
    if (!this.activeRecording) {
      return;
    }
    const { recorder, stream } = this.activeRecording;
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    this.cleanupStream(stream);
    this.activeRecording = undefined;
  }
}
