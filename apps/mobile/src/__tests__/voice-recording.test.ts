import { renderHook, act } from '@testing-library/react-native';
import { CHAT_AUDIO_MAX_DURATION_MS } from '@nilzora/contracts';
import { FakeAudioRecorder } from '@/test-utils/audio-recorder-fake';
import { useVoiceRecorder } from '@/features/support/use-voice-recording';

jest.mock(
  'expo-audio',
  () =>
    jest.requireActual<{ expoAudioMock: object }>('@/test-utils/audio-recorder-fake').expoAudioMock,
);

jest.mock(
  'expo-file-system',
  () =>
    jest.requireActual<{ fileSystemMock: object }>('@/test-utils/audio-recorder-fake')
      .fileSystemMock,
);

beforeEach(() => FakeAudioRecorder.reset());

async function startRecording() {
  const rendered = await renderHook(() => useVoiceRecorder());
  await act(async () => {
    await rendered.result.current.start();
  });
  return rendered;
}

describe('useVoiceRecorder', () => {
  it('asks for the microphone only when recording starts', async () => {
    const rendered = await renderHook(() => useVoiceRecorder());
    expect(FakeAudioRecorder.permissionRequests).toBe(0);

    await act(async () => {
      await rendered.result.current.start();
    });

    expect(FakeAudioRecorder.permissionRequests).toBe(1);
    expect(rendered.result.current.phase).toBe('recording');
    await rendered.unmount();
  });

  it('reports a denied permission as a sentence and stays idle', async () => {
    FakeAudioRecorder.denyPermission();
    const rendered = await renderHook(() => useVoiceRecorder());

    await act(async () => {
      await rendered.result.current.start();
    });

    expect(rendered.result.current.phase).toBe('idle');
    expect(rendered.result.current.failure).toContain('permission to use your microphone');
    await rendered.unmount();
  });

  it('pauses and resumes', async () => {
    const rendered = await startRecording();

    await act(() => {
      rendered.result.current.pause();
    });
    expect(rendered.result.current.phase).toBe('paused');

    await act(() => {
      rendered.result.current.resume();
    });
    expect(rendered.result.current.phase).toBe('recording');
    await rendered.unmount();
  });

  it('stops and answers the recording it produced', async () => {
    const rendered = await startRecording();

    let recorded: { contentType: string; durationMs: number; byteSize: number } | null = null;
    await act(async () => {
      recorded = await rendered.result.current.stop();
    });

    // A plain comparison rather than `not.toBeNull()`: the assertion narrows a variable that
    // TypeScript cannot see being assigned inside the callback, which makes the later property
    // reads unrepresentable instead of merely unchecked.
    const voice = recorded as { contentType: string; durationMs: number; byteSize: number } | null;
    expect(voice === null).toBe(false);
    expect(voice?.contentType).toBe('audio/mp4');
    expect(voice?.byteSize).toBeGreaterThan(0);
    expect(voice?.durationMs).toBeGreaterThan(0);
    expect(rendered.result.current.phase).toBe('recorded');
    await rendered.unmount();
  });

  it('refuses a format the server does not accept, and deletes the file', async () => {
    FakeAudioRecorder.recordTo('file:///cache/voice.amr');
    const rendered = await startRecording();

    let recorded: unknown = 'unset';
    await act(async () => {
      recorded = await rendered.result.current.stop();
    });

    expect(recorded).toBeNull();
    expect(rendered.result.current.failure).toContain('format Nilzora cannot send');
    expect(FakeAudioRecorder.deleted).toContain('file:///cache/voice.amr');
    await rendered.unmount();
  });

  it('cancels back to idle and releases the microphone', async () => {
    const rendered = await startRecording();

    await act(() => {
      rendered.result.current.cancel();
    });

    expect(rendered.result.current.phase).toBe('idle');
    expect(rendered.result.current.failure).toBeNull();
    expect(FakeAudioRecorder.stopped).toBe(true);
    await rendered.unmount();
  });

  it('deletes its temporary file when the screen goes away', async () => {
    const rendered = await startRecording();
    await act(async () => {
      await rendered.result.current.stop();
    });

    await rendered.unmount();

    expect(FakeAudioRecorder.deleted).toContain('file:///cache/voice.m4a');
  });

  it('shows the length of the take as a clock a person reads', async () => {
    FakeAudioRecorder.recordDuration(65_000);
    const rendered = await startRecording();

    await act(async () => {
      await rendered.result.current.stop();
    });

    expect(rendered.result.current.clock).toMatch(/^\d+:\d{2}$/);
    await rendered.unmount();
  });

  it('ends the recording at the length ceiling and keeps what was said, rather than run on', async () => {
    // The length check runs on the recorder's own interval. Driving that callback directly keeps
    // this a test of the rule rather than of the timer plumbing.
    const ticks: (() => void)[] = [];
    const interval = jest
      .spyOn(global, 'setInterval')
      .mockImplementation((callback: () => void) => {
        ticks.push(callback);
        return 0 as unknown as ReturnType<typeof setInterval>;
      });
    try {
      FakeAudioRecorder.recordDuration(CHAT_AUDIO_MAX_DURATION_MS + 1_000);
      const rendered = await startRecording();

      await act(async () => {
        ticks[0]?.();
        await Promise.resolve();
      });

      expect(rendered.result.current.failure).toContain('at most five minutes');
      expect(FakeAudioRecorder.stopped).toBe(true);
      // The take is offered back, so the customer can send what they did say.
      expect(rendered.result.current.finished).not.toBeNull();
      expect(rendered.result.current.finished?.durationMs).toBeGreaterThan(0);
      await rendered.unmount();
    } finally {
      interval.mockRestore();
    }
  });
});
