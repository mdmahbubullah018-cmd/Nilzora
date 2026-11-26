import { render, screen, userEvent } from '@testing-library/react-native';
import { useState } from 'react';
import { PasswordField } from '../components/password-field';

/** A controlled field, as the screens use it. */
function Harness({ error }: { error?: string }) {
  const [value, setValue] = useState('');
  return (
    <PasswordField
      label="Password"
      value={value}
      onChangeText={setValue}
      error={error}
      autoComplete="current-password"
      textContentType="password"
    />
  );
}

describe('PasswordField', () => {
  it('starts hidden and keeps the autofill hints the screens give it', async () => {
    await render(<Harness />);

    const input = screen.getByLabelText('Password');
    expect(input).toHaveProp('secureTextEntry', true);
    expect(input).toHaveProp('autoComplete', 'current-password');
    expect(input).toHaveProp('textContentType', 'password');
  });

  it('reveals and hides the password without losing its value', async () => {
    const user = userEvent.setup();
    await render(<Harness />);
    await user.type(screen.getByLabelText('Password'), 'correct-password1');

    await user.press(screen.getByRole('button', { name: 'Show password' }));

    const revealed = screen.getByLabelText('Password');
    expect(revealed).toHaveProp('secureTextEntry', false);
    expect(revealed).toHaveDisplayValue('correct-password1');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Hide password' }));

    expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
    expect(screen.getByLabelText('Password')).toHaveDisplayValue('correct-password1');
  });

  it('still shows a validation error underneath', async () => {
    await render(<Harness error="Enter your password." />);

    expect(screen.getByRole('alert')).toHaveTextContent('Enter your password.');
    expect(screen.getByLabelText('Password')).toHaveProp(
      'accessibilityHint',
      'Enter your password.',
    );
  });
});
