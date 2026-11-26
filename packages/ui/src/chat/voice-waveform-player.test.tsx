import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { peaksFromSamples, VOICE_BARS, VoiceWaveformPlayer } from './voice-waveform-player';

describe('peaksFromSamples', () => {
  it('takes the loudest sample of each slice and scales the loudest bar to 1', () => {
    const samples = new Float32Array(400).fill(0.1);
    samples[15] = -0.5; // in the first slice of ten
    const peaks = peaksFromSamples(samples);
    expect(peaks).toHaveLength(VOICE_BARS);
    expect(peaks[1]).toBe(1);
    expect(peaks[0]).toBe(0.2);
    expect(peaksFromSamples(new Float32Array(0))).toEqual([]);
    expect(peaksFromSamples(new Float32Array(80))).toEqual(Array(VOICE_BARS).fill(0));
  });
});

describe('<VoiceWaveformPlayer>', () => {
  it('shows even resting bars when the audio cannot be decoded, never an invented shape', () => {
    render(<VoiceWaveformPlayer url="/media/voice.webm" durationMs={10_000} />);
    const bars = screen.getByRole('slider').querySelectorAll('span');
    expect(bars).toHaveLength(VOICE_BARS);
    expect(new Set(Array.from(bars, (bar) => bar.style.height)).size).toBe(1);
  });

  it('seeks with the keyboard', () => {
    render(<VoiceWaveformPlayer url="/media/voice.webm" durationMs={60_000} />);
    const audio = document.querySelector('audio') as HTMLAudioElement;
    const slider = screen.getByRole('slider', { name: 'Position in the voice message' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(audio.currentTime).toBe(5);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(audio.currentTime).toBe(60);
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(audio.currentTime).toBe(0);
  });
});
