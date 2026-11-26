import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { OtpField } from '../components/otp-field';

function Harness({ onComplete }: { onComplete?: (code: string) => void }) {
  const [value, setValue] = useState('');
  return <OtpField value={value} onChange={setValue} onComplete={onComplete} />;
}

const box = (index: number) =>
  screen.getByLabelText(`Verification code, digit ${String(index)} of 6`);

describe('OtpField', () => {
  it('shows six separately named boxes with a numeric keyboard', async () => {
    await render(<Harness />);

    for (let index = 1; index <= 6; index += 1) {
      expect(box(index)).toBeOnTheScreen();
    }
    expect(box(1)).toHaveProp('keyboardType', 'number-pad');
    // Each box names itself inside the group, because the group label is not announced.
    expect(box(1)).toHaveProp('accessibilityLabel', 'Verification code, digit 1 of 6');
    expect(box(6)).toHaveProp('accessibilityLabel', 'Verification code, digit 6 of 6');
    // The first box is the one the keyboard's one-time-code autofill targets.
    expect(box(1)).toHaveProp('autoComplete', 'one-time-code');
    expect(box(2)).toHaveProp('autoComplete', 'off');
  });

  it('reaches a 44dp touch target without overlapping its neighbour', async () => {
    await render(<Harness />);

    // 2dp a side fills the 4dp gap exactly, so neighbouring targets never overlap.
    expect(box(3)).toHaveProp('hitSlop', { top: 8, bottom: 8, left: 2, right: 2 });
  });

  it('accepts one digit per box', async () => {
    await render(<Harness />);

    await fireEvent.changeText(box(1), '4');

    expect(box(1)).toHaveDisplayValue('4');
    expect(box(2)).toHaveDisplayValue('');
  });

  it('ignores anything that is not a digit', async () => {
    await render(<Harness />);

    await fireEvent.changeText(box(1), 'a');
    await fireEvent.changeText(box(1), '-');

    expect(box(1)).toHaveDisplayValue('');
  });

  it('spreads a pasted six-digit code across the boxes and reports it once', async () => {
    const onComplete = jest.fn();
    await render(<Harness onComplete={onComplete} />);

    await fireEvent.changeText(box(1), '123456');

    for (let index = 1; index <= 6; index += 1) {
      expect(box(index)).toHaveDisplayValue(String(index));
    }
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('does not report the same complete code twice', async () => {
    const onComplete = jest.fn();
    await render(<Harness onComplete={onComplete} />);

    await fireEvent.changeText(box(1), '123456');
    await fireEvent.changeText(box(6), '6');

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('moves back to the previous box when backspace is pressed in an empty one', async () => {
    await render(<Harness />);
    await fireEvent.changeText(box(1), '12');

    await fireEvent(box(3), 'keyPress', { nativeEvent: { key: 'Backspace' } });

    expect(box(1)).toHaveDisplayValue('1');
    expect(box(2)).toHaveDisplayValue('');
  });

  it('shows the error instead of the hint when the code was refused', async () => {
    const { rerender } = await render(<Harness />);
    await rerender(
      <OtpField
        value=""
        onChange={() => undefined}
        error="That code has expired."
        hint="Six digits."
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('That code has expired.');
    expect(screen.queryByText('Six digits.')).not.toBeOnTheScreen();
  });
});
