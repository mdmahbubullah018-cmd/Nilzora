import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { VoiceWaveform } from '@/features/support/voice-waveform';
import {
  WAVEFORM_BARS,
  levelOfMetering,
  peaksOf,
  rememberWaveform,
  useWaveform,
} from '@/features/support/voice-waveforms';
import { theme } from '@/theme';

describe('voice waveform data', () => {
  it('turns recorder metering (dBFS) into a 0–1 level, and ignores missing readings', () => {
    expect(levelOfMetering(0)).toBe(1);
    expect(levelOfMetering(-25)).toBe(0.5);
    expect(levelOfMetering(-80)).toBe(0);
    expect(levelOfMetering(undefined)).toBeNull();
    expect(levelOfMetering(Number.NaN)).toBeNull();
  });

  it('reduces a level series to peaks, keeping the loudest moment of each slice', () => {
    const levels = Array.from({ length: 72 }, (_, i) => (i === 10 ? 0.9 : 0.1));
    const peaks = peaksOf(levels);
    expect(peaks).toHaveLength(WAVEFORM_BARS);
    expect(peaks[5]).toBe(0.9); // 72 readings / 36 bars: reading 10 falls in bar 5
    expect(Math.max(...peaks.filter((_, i) => i !== 5))).toBe(0.1);
    expect(peaksOf([])).toEqual([]);
  });

  it('remembers the waveform of a voice message sent from this phone', async () => {
    function Probe({ id }: { id: string }) {
      const peaks = useWaveform(id);
      return <Text>{peaks === null ? 'none' : String(peaks.length)}</Text>;
    }
    await render(<Probe id="att-1" />);
    expect(await screen.findByText('none')).toBeOnTheScreen();
    await act(async () => {
      await rememberWaveform('att-1', [0.2, 0.6, 0.4]);
    });
    expect(await screen.findByText(String(WAVEFORM_BARS))).toBeOnTheScreen();
  });
});

describe('<VoiceWaveform>', () => {
  it('draws played bars in the strong ink and seeks where it is tapped', async () => {
    const onSeek = jest.fn();
    await render(
      <VoiceWaveform peaks={[0.2, 0.8, 0.5, 1]} progress={0.5} label="Position" onSeek={onSeek} />,
    );
    const control = screen.getByRole('adjustable', { name: 'Position' });
    const bars = screen.getByTestId('voice-waveform').children[0] as never as {
      props: { children: { props: { style: unknown } }[] };
    };
    const colours = bars.props.children.map(
      (bar) => StyleSheet.flatten(bar.props.style as never) as { backgroundColor: string },
    );
    expect(colours.map((c) => c.backgroundColor)).toEqual([
      theme.colors.foreground,
      theme.colors.foreground,
      theme.colors.border,
      theme.colors.border,
    ]);

    await act(async () => {
      await fireEvent(control, 'layout', { nativeEvent: { layout: { width: 200 } } });
    });
    await act(async () => {
      await fireEvent.press(control, { nativeEvent: { locationX: 50 } });
    });
    expect(onSeek).toHaveBeenCalledWith(0.25);
  });

  it('draws even resting bars when no levels were recorded, never an invented shape', async () => {
    await render(
      <VoiceWaveform peaks={null} progress={0} label="Position" onSeek={() => undefined} />,
    );
    const bars = screen.getByTestId('voice-waveform').children[0] as never as {
      props: { children: { props: { style: unknown } }[] };
    };
    const heights = new Set(
      bars.props.children.map(
        (bar) => (StyleSheet.flatten(bar.props.style as never) as { height: number }).height,
      ),
    );
    expect(bars.props.children).toHaveLength(WAVEFORM_BARS);
    expect(heights.size).toBe(1);
  });
});
