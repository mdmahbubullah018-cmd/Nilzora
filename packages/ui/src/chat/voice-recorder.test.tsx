// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceRecorder } from './voice-recorder';

/*
 * The recorder, driven by a hand-played MediaRecorder
 * ---------------------------------------------------
 * jsdom has neither a microphone nor a recorder, so both are stubbed: the recording is started,
 * paused, resumed and stopped exactly as a browser would do it, and the component's reaction is
 * what is asserted. The point of these tests is not the audio — it is that permission is asked
 * for only when recording starts, that the microphone is released however the take ends, and
 * that a take which breaks a limit is refused before anything is uploaded.
 */

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  tracks: FakeTrack[] = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static supported: string[] = ['audio/webm'];
  static isTypeSupported = (type: string) => FakeRecorder.supported.includes(type);
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  stream: FakeStream;
  constructor(stream: FakeStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType ?? 'audio/webm';
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  emit(bytes: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: this.mimeType }) });
  }
  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }
}

const getUserMedia = vi.fn();
const createObjectURL = vi.fn(() => 'blob:voice');
const revokeObjectURL = vi.fn();

function installBrowser(options: { recorders?: string[]; deny?: boolean } = {}) {
  FakeRecorder.instances = [];
  FakeRecorder.supported = options.recorders ?? ['audio/webm'];
  getUserMedia.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  getUserMedia.mockImplementation(() =>
    options.deny === true
      ? Promise.reject(new Error('NotAllowedError'))
      : Promise.resolve(new FakeStream()),
  );
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
}

const onRecorded = vi.fn();
const onDiscard = vi.fn();

function renderRecorder(disabled = false) {
  render(<VoiceRecorder onRecorded={onRecorded} onDiscard={onDiscard} disabled={disabled} />);
}

beforeEach(() => {
  onRecorded.mockReset();
  onDiscard.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the support voice recorder', () => {
  it('asks for the microphone only when recording starts, then previews the take', async () => {
    installBrowser();
    renderRecorder();

    // Nothing has touched the microphone while the composer was merely open.
    expect(getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await waitFor(() => {
      expect(FakeRecorder.instances).toHaveLength(1);
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    const recorder = FakeRecorder.instances[0]!;
    recorder.emit(2048);
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));

    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledTimes(1);
    });
    const voice = onRecorded.mock.calls[0]![0] as {
      contentType: string;
      blob: Blob;
      durationMs: number;
      fileName: string;
    };
    expect(voice.contentType).toBe('audio/webm');
    expect(voice.fileName.endsWith('.webm')).toBe(true);
    expect(voice.durationMs).toBeGreaterThan(0);
    // The preview is the blob's own URL, and the microphone has already been released.
    expect(screen.getByLabelText('Discard the recording')).toBeTruthy();
    expect(recorder.stream.tracks[0]?.stopped).toBe(true);
  });

  it('pauses, resumes and still reports a length', async () => {
    installBrowser();
    renderRecorder();
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await waitFor(() => {
      expect(FakeRecorder.instances).toHaveLength(1);
    });
    const recorder = FakeRecorder.instances[0]!;

    fireEvent.click(screen.getByRole('button', { name: 'Pause recording' }));
    expect(recorder.state).toBe('paused');
    fireEvent.click(screen.getByRole('button', { name: 'Resume recording' }));
    expect(recorder.state).toBe('recording');

    recorder.emit(1024);
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledTimes(1);
    });
  });

  it('discards a take, releasing the microphone and the preview URL', async () => {
    installBrowser();
    renderRecorder();
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await waitFor(() => {
      expect(FakeRecorder.instances).toHaveLength(1);
    });
    const recorder = FakeRecorder.instances[0]!;
    recorder.emit(1024);
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Discard the recording' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:voice');
    // The next take starts from a clean bar rather than re-sending the discarded one.
    expect(screen.getByRole('button', { name: 'Record a voice message' })).toBeTruthy();
  });

  it('cancels a recording in progress and closes the microphone', async () => {
    installBrowser();
    renderRecorder();
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await waitFor(() => {
      expect(FakeRecorder.instances).toHaveLength(1);
    });
    const recorder = FakeRecorder.instances[0]!;

    fireEvent.click(screen.getByRole('button', { name: 'Cancel the recording' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(recorder.state).toBe('inactive');
    expect(recorder.stream.tracks[0]?.stopped).toBe(true);
    expect(screen.getByRole('button', { name: 'Record a voice message' })).toBeTruthy();
  });

  it('says so plainly when the browser cannot record at all', async () => {
    installBrowser();
    vi.stubGlobal('MediaRecorder', undefined);
    renderRecorder();

    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('cannot record audio');
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('says so plainly when the browser records in a format Nilzora does not accept', async () => {
    installBrowser({ recorders: [] });
    renderRecorder();

    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('cannot record audio');
    });
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('treats a refused microphone permission as a refusal, not a crash', async () => {
    installBrowser({ deny: true });
    renderRecorder();

    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('permission');
    });
    expect(onRecorded).not.toHaveBeenCalled();
    // The button is back, so the operator can try again after granting permission.
    expect(screen.getByRole('button', { name: 'Record a voice message' })).toBeTruthy();
  });

  it('refuses a take larger than the audio limit instead of uploading it', async () => {
    installBrowser();
    renderRecorder();
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await waitFor(() => {
      expect(FakeRecorder.instances).toHaveLength(1);
    });
    const recorder = FakeRecorder.instances[0]!;
    // One byte past the contract's 10 MB audio ceiling.
    recorder.emit(10 * 1024 * 1024 + 1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('larger than');
    });
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('stops itself at the ceiling', async () => {
    installBrowser();
    // Real timers and a 60 ms ceiling: the same code path a five-minute take follows, without
    // five minutes of wall clock.
    render(
      <VoiceRecorder
        onRecorded={onRecorded}
        onDiscard={onDiscard}
        disabled={false}
        maxDurationMs={60}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await waitFor(() => {
      expect(FakeRecorder.instances).toHaveLength(1);
    });
    const recorder = FakeRecorder.instances[0]!;
    recorder.emit(1024);

    await waitFor(
      () => {
        expect(recorder.state).toBe('inactive');
      },
      { timeout: 3000 },
    );
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('five minutes');
    });
    expect(recorder.stream.tracks[0]?.stopped).toBe(true);
  });

  it('does not open the microphone when the composer is busy', () => {
    installBrowser();
    renderRecorder(true);
    const button = screen.getByRole('button', { name: 'Record a voice message' });
    expect(button.getAttribute('disabled')).not.toBeNull();
    fireEvent.click(button);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('begins recording at once only for a recorder the person summoned (autoStart)', async () => {
    installBrowser();
    render(
      <VoiceRecorder autoStart onRecorded={onRecorded} onDiscard={onDiscard} disabled={false} />,
    );
    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByRole('button', { name: 'Stop recording' })).toBeTruthy();
    // Without the prop nothing starts by itself (covered above): permission follows a press.
  });

  it('keeps the take on screen with Send and Discard when a Send handler is given', async () => {
    installBrowser();
    const onSend = vi.fn();
    render(
      <VoiceRecorder
        autoStart
        onRecorded={onRecorded}
        onDiscard={onDiscard}
        onSend={onSend}
        disabled={false}
      />,
    );
    await screen.findByRole('button', { name: 'Stop recording' });
    FakeRecorder.instances[0]!.emit(1024);
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));

    // The preview stays: a player, the length, Send and Discard.
    const send = await screen.findByRole('button', { name: 'Send the voice message' });
    expect(document.querySelector('audio')?.getAttribute('src')).toBe('blob:voice');
    expect(screen.getByLabelText('Discard the recording')).toBeTruthy();
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('keeps every preview control a full-size target on its own row, with the player on a row above', async () => {
    installBrowser();
    render(
      <VoiceRecorder
        autoStart
        onRecorded={onRecorded}
        onDiscard={onDiscard}
        onSend={vi.fn()}
        disabled={false}
      />,
    );
    await screen.findByRole('button', { name: 'Stop recording' });
    FakeRecorder.instances[0]!.emit(1024);
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    const send = await screen.findByRole('button', { name: 'Send the voice message' });
    const discard = screen.getByRole('button', { name: 'Discard the recording' });

    // Layout is not computed in jsdom, so the classes that guarantee it are asserted: 44px
    // (size-11) from the smallest screen, never shrunk by a neighbour, 44px again on touch
    // screens at any width, and only a mouse at `sm`+ gets the compact 36px.
    for (const button of [send, discard]) {
      expect(button.className).toContain('size-11');
      expect(button.className).toContain('shrink-0');
      expect(button.className).toContain('sm:size-9');
      expect(button.className).toContain('sm:pointer-coarse:size-11');
      expect(button.className).not.toMatch(/(^|\s)size-(8|9|10)(\s|$)/);
    }

    // The player is full width, outside the control row, so it can never push Send off screen.
    const audio = document.querySelector('audio');
    expect(audio?.className).toContain('w-full');
    expect(audio?.className).toContain('min-w-0');
    expect(audio?.className).not.toContain('max-w-');
    expect(audio?.parentElement).not.toBe(send.parentElement);
    // The control row wraps instead of overflowing on a 320px screen.
    expect(send.parentElement?.className).toContain('flex-wrap');
    expect(send.parentElement).toBe(discard.parentElement);
  });

  it('keeps the recording-state buttons 44px and wrapping too', async () => {
    installBrowser();
    renderRecorder();
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    const pause = await screen.findByRole('button', { name: 'Pause recording' });
    const stopButton = screen.getByRole('button', { name: 'Stop recording' });
    const cancel = screen.getByRole('button', { name: 'Cancel the recording' });
    for (const button of [pause, stopButton, cancel]) {
      expect(button.className).toContain('size-11');
      expect(button.className).toContain('shrink-0');
    }
    expect(pause.parentElement?.className).toContain('flex-wrap');
    fireEvent.click(pause);
    const resume = await screen.findByRole('button', { name: 'Resume recording' });
    expect(resume.className).toContain('size-11');
  });

  it('offers no Send button when the host form owns the decision', async () => {
    installBrowser();
    renderRecorder();
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await waitFor(() => {
      expect(FakeRecorder.instances).toHaveLength(1);
    });
    FakeRecorder.instances[0]!.emit(1024);
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    await screen.findByLabelText('Discard the recording');
    expect(screen.queryByRole('button', { name: 'Send the voice message' })).toBeNull();
  });

  it('closes an auto-started recorder after a refusal, and names a missing microphone', async () => {
    installBrowser();
    getUserMedia.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('none'), { name: 'NotFoundError' })),
    );
    render(
      <VoiceRecorder autoStart onRecorded={onRecorded} onDiscard={onDiscard} disabled={false} />,
    );
    expect((await screen.findByRole('alert')).textContent).toContain('No microphone was found');
    fireEvent.click(screen.getByRole('button', { name: 'Close the recorder' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('releases a microphone that was granted after the recorder had already gone', async () => {
    installBrowser();
    const stream = new FakeStream();
    let grant!: (value: FakeStream) => void;
    getUserMedia.mockImplementation(
      () =>
        new Promise<FakeStream>((resolve) => {
          grant = resolve;
        }),
    );
    const view = render(
      <VoiceRecorder autoStart onRecorded={onRecorded} onDiscard={onDiscard} disabled={false} />,
    );
    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalled();
    });
    view.unmount();
    grant(stream);
    await waitFor(() => {
      expect(stream.tracks[0]?.stopped).toBe(true);
    });
    expect(FakeRecorder.instances).toHaveLength(0);
  });
});
