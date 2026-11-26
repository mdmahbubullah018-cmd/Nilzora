/*
 * Test doubles for the native upload layer. Not imported by the app, so never bundled.
 *
 *   jest.mock('expo-file-system', () => jest.requireActual<object>('@/test-utils/upload-fakes').expoFileSystemMock);
 *   jest.mock('expo-image-picker', () => jest.requireActual<object>('@/test-utils/upload-fakes').expoImagePickerMock);
 *
 * A test drives each upload by hand: `lastTask().progress(sent, total)` is the native layer
 * reporting bytes, `lastTask().answer(status, body)` is the server's answer and `lastTask().fail()`
 * is the connection breaking. Nothing here fakes a percentage.
 */

import { act } from '@testing-library/react-native';

export interface UploadTaskOptions {
  httpMethod?: string;
  uploadType?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: (progress: { bytesSent: number; totalBytes: number }) => void;
}

export class FakeUploadTask {
  static all: FakeUploadTask[] = [];
  readonly release = jest.fn();
  private settle!: {
    resolve: (value: { status: number; body: string }) => void;
    reject: (reason: unknown) => void;
  };
  private readonly promise: Promise<{ status: number; body: string }>;

  constructor(
    readonly uri: string,
    readonly url: string,
    readonly options: UploadTaskOptions,
  ) {
    this.promise = new Promise((resolve, reject) => {
      this.settle = { resolve, reject };
    });
    options.signal?.addEventListener('abort', () => {
      this.settle.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
    FakeUploadTask.all.push(this);
  }

  uploadAsync(): Promise<{ status: number; body: string }> {
    return this.promise;
  }

  /** The native layer reporting how many bytes it has really sent. */
  progress(bytesSent: number, totalBytes: number): void {
    this.options.onProgress?.({ bytesSent, totalBytes });
  }

  /** The server's answer, as the HTTP status and body text. */
  answer(status: number, body: unknown): void {
    this.settle.resolve({ status, body: typeof body === 'string' ? body : JSON.stringify(body) });
  }

  /** The connection breaking. */
  fail(): void {
    this.settle.reject(new Error('Network request failed'));
  }

  static reset(): void {
    FakeUploadTask.all = [];
    FakeFile.deleted.length = 0;
  }
}

export function lastTask(): FakeUploadTask {
  const task = FakeUploadTask.all[FakeUploadTask.all.length - 1];
  if (!task) throw new Error('No upload has started');
  return task;
}

/** The files the app has removed, such as a discarded recording's temporary take. */
export const deletedFiles: string[] = [];

/** `Paths`, as far as the app uses it: two private directories it may write to. */
const fakePaths = {
  cache: 'file:///cache/',
  document: 'file:///documents/',
};

class FakeFile {
  /** Kept for the recorder, which reads a take's size before it uploads it. */
  static readonly deleted = deletedFiles;

  readonly uri: string;
  private removed = false;

  constructor(...parts: (string | { uri: string })[]) {
    this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('');
  }

  /** A cached file exists until it is removed, which is what the real disk looks like. */
  get exists(): boolean {
    return this.uri.startsWith('file:///cache/') && !this.removed;
  }

  get size(): number {
    return 48_000;
  }

  create(): void {
    // Nothing to do: a cache file is created by writing to it.
  }

  write(): Promise<void> {
    return Promise.resolve();
  }

  delete(): void {
    this.removed = true;
    deletedFiles.push(this.uri);
  }

  createUploadTask(url: string, options: UploadTaskOptions): FakeUploadTask {
    return new FakeUploadTask(this.uri, url, options);
  }
}

export const expoFileSystemMock = {
  File: FakeFile,
  Paths: fakePaths,
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
};

/** The picker: tests set what the next `launchImageLibraryAsync` call answers. */
export const launchImageLibraryAsync = jest.fn();
/** The camera: tests set what the next `launchCameraAsync` call answers. */
export const launchCameraAsync = jest.fn();
/** Permission answers, granted unless a test says otherwise. */
export const requestMediaLibraryPermissionsAsync = jest.fn();
export const requestCameraPermissionsAsync = jest.fn();

export const expoImagePickerMock = {
  launchImageLibraryAsync,
  launchCameraAsync,
  requestMediaLibraryPermissionsAsync,
  requestCameraPermissionsAsync,
};

export interface FakeAsset {
  uri: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
}

export function fakeAsset(overrides: Partial<FakeAsset> = {}): FakeAsset {
  return {
    uri: 'file:///cache/me.jpg',
    fileName: 'me.jpg',
    mimeType: 'image/jpeg',
    fileSize: 200_000,
    width: 800,
    height: 800,
    ...overrides,
  };
}

/** The next time the person opens the picker, they choose `assets`. */
export function choose(...assets: FakeAsset[]): void {
  launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets });
}

/** The next time the person opens the picker, they back out. */
export function chooseNothing(): void {
  launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: null });
}

/** The next time the person opens the camera, they take `asset`. */
export function capture(asset: FakeAsset): void {
  launchCameraAsync.mockResolvedValueOnce({ canceled: false, assets: [asset] });
}

/** The next time the person opens the camera, they back out. */
export function captureNothing(): void {
  launchCameraAsync.mockResolvedValueOnce({ canceled: true, assets: null });
}

/** Both permission prompts answer the same way. */
export function permissions(granted: boolean): void {
  requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted });
  requestCameraPermissionsAsync.mockResolvedValue({ granted });
}

export const picture = {
  url: 'https://media.example.test/avatars/u/full.webp',
  thumbUrl: 'https://media.example.test/avatars/u/thumb.webp',
};

/** Runs `change` (a native event, a server answer) inside an awaited act, so React settles first. */
export async function inAct(change: () => void): Promise<void> {
  await act(async () => {
    change();
    await Promise.resolve();
  });
}
