import { claimVoiceAudio, releaseVoiceAudio } from '@/features/support/voice-playback';

describe('one voice message at a time', () => {
  it('pauses whatever was already playing before something else starts', () => {
    const first = jest.fn();
    const second = jest.fn();

    claimVoiceAudio(first);
    expect(first).not.toHaveBeenCalled();

    claimVoiceAudio(second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('only the player that still holds the slot can release it', () => {
    const first = jest.fn();
    const second = jest.fn();

    claimVoiceAudio(first);
    claimVoiceAudio(second);
    // The first player is stale now; releasing it must not free the slot for a third one.
    releaseVoiceAudio(first);
    claimVoiceAudio(first);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
