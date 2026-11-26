import { render, screen, userEvent } from '@testing-library/react-native';
import { useState } from 'react';
import { QuantityStepper } from '../components/quantity-stepper';

describe('QuantityStepper', () => {
  it('announces the quantity and labels both buttons', async () => {
    await render(<QuantityStepper value={2} onChange={jest.fn()} />);

    expect(screen.getByLabelText('Quantity, 2')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Increase quantity' })).toBeOnTheScreen();
  });

  it('says what each button will do', async () => {
    await render(<QuantityStepper value={2} onChange={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toHaveProp(
      'accessibilityHint',
      'Sets the quantity to 1',
    );
    expect(screen.getByRole('button', { name: 'Increase quantity' })).toHaveProp(
      'accessibilityHint',
      'Sets the quantity to 3',
    );
  });

  it('names the product so a list of steppers is not ambiguous', async () => {
    await render(<QuantityStepper value={1} onChange={jest.fn()} productName="Blue mug" />);

    expect(screen.getByRole('button', { name: 'Decrease quantity of Blue mug' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Increase quantity of Blue mug' })).toBeOnTheScreen();
  });

  it('steps by one and reports the new quantity', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState(2);
      return <QuantityStepper value={value} onChange={setValue} />;
    }
    await render(<Harness />);

    await user.press(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(screen.getByLabelText('Quantity, 3')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Decrease quantity' }));
    await user.press(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(screen.getByLabelText('Quantity, 1')).toBeOnTheScreen();
  });

  it('disables decrease at the minimum and increase at the maximum, saying why', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    const { rerender } = await render(
      <QuantityStepper value={1} min={1} max={3} onChange={onChange} />,
    );

    const decrease = screen.getByRole('button', { name: 'Decrease quantity' });
    expect(decrease).toBeDisabled();
    expect(decrease).toHaveProp('accessibilityHint', 'The minimum is 1');
    await user.press(decrease);

    await rerender(<QuantityStepper value={3} min={1} max={3} onChange={onChange} />);
    const increase = screen.getByRole('button', { name: 'Increase quantity' });
    expect(increase).toBeDisabled();
    expect(increase).toHaveProp('accessibilityHint', 'The most you can order is 3');
    await user.press(increase);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('brings a quantity above a lowered maximum back inside it', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    await render(<QuantityStepper value={8} max={5} onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'Increase quantity' })).toBeDisabled();
    await user.press(screen.getByRole('button', { name: 'Decrease quantity' }));

    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('disables both buttons when disabled', async () => {
    await render(<QuantityStepper value={2} onChange={jest.fn()} disabled />);

    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase quantity' })).toBeDisabled();
  });

  it('keeps both targets at least 48dp', async () => {
    await render(<QuantityStepper value={2} onChange={jest.fn()} />);

    for (const name of ['Decrease quantity', 'Increase quantity']) {
      expect(screen.getByRole('button', { name })).toHaveStyle({ width: 48, height: 48 });
    }
  });
});
