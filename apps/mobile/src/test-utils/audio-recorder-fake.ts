/**
 * A stand-in for `expo-audio`. It reports the same surface the recorder hook uses
 * (`useAudioRecorder`, `requestRecordingPermissionsAsync`, `setAudioModeAsync`,
 * `RecordingPresets`) plus the player hooks, which a rendering test can leave unused.
 *
 * Nothing is guessed: a test says whether permission is granted, what file the recorder writes,
 * and how long the take is, and the hook must react to exactly that.
 */

interface RecorderStatus {
  canRecord: boolean;
  isRecording: boolean;
  durationMillis: number;
  isFinished: boolean;
  hasError: boolean;
  url: string | null;
}

let permissionGranted = true;
let uri = 'file:///cache/voice.m4a';
let durationMillis = 4_200;
let running = false;

export const FakeAudioRecorder = {
  permissionRequests: 0,
  stopped: false,
  deleted: [] as string[],
  /** Every position a player was asked to jump to, in seconds. */
  seeks: [] as number[],
  reset(): void {
    permissionGranted = true;
    uri = 'file:///cache/voice.m4a';
    durationMillis = 4_200;
    running = false;
    this.permissionRequests = 0;
    this.stopped = false;
    this.deleted = [];
    this.seeks = [];
  },
  denyPermission(): void {
    permissionGranted = false;
  },
  recordTo(next: string): void {
    uri = next;
  },
  recordDuration(next: number): void {
    durationMillis = next;
  },
};

class FakeAudioRecorderInstance {
  uri: string | null = null;
  prepareToRecordAsync = () => {
    this.uri = null;
    return Promise.resolve();
  };
  record = () => {
    running = true;
  };
  pause = () => {
    running = false;
  };
  stop = () => {
    FakeAudioRecorder.stopped = true;
    running = false;
    this.uri = uri;
    return Promise.resolve();
  };
  getStatus = (): RecorderStatus => ({
    canRecord: true,
    isRecording: running,
    durationMillis,
    isFinished: false,
    hasError: false,
    url: running ? null : uri,
  });
  release = () => undefined;
}

/** `expo-file-system`'s File, as far as the recorder uses it (existence, size, delete). */
class FakeFile {
  constructor(private readonly path: string) {}
  get exists(): boolean {
    return this.path.startsWith('file:///cache/');
  }
  get size(): number {
    return 48_000;
  }
  delete(): void {
    FakeAudioRecorder.deleted.push(this.path);
  }
}

export const expoAudioMock = {
  RecordingPresets: {
    HIGH_QUALITY: {
      extension: '.m4a',
      sampleRate: 44100,
      numberOfChannels: 2,
      bitRate: 128000,
      android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
      ios: { outputFormat: 'aac ' },
      web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
    },
  },
  requestRecordingPermissionsAsync: () => {
    FakeAudioRecorder.permissionRequests += 1;
    return Promise.resolve({
      granted: permissionGranted,
      status: permissionGranted ? 'granted' : 'denied',
    });
  },
  setAudioModeAsync: () => Promise.resolve(),
  useAudioRecorder: () => new FakeAudioRecorderInstance(),
  useAudioPlayer: () => ({
    play: () => undefined,
    pause: () => undefined,
    release: () => undefined,
    seekTo: (seconds: number) => {
      FakeAudioRecorder.seeks.push(seconds);
      return Promise.resolve();
    },
  }),
  useAudioPlayerStatus: () => ({
    playing: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
  }),
};

export const fileSystemMock = { File: FakeFile };
