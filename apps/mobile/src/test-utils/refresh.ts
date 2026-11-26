import { fireEvent, screen } from '@testing-library/react-native';

/**
 * Refreshes a list the way a screen-reader user does: through its "Refresh" accessibility
 * action. The branded pull gesture itself needs the native gesture handler, which Jest does not
 * have; both paths call the same refresh.
 */
export async function refreshList(testID: string): Promise<void> {
  await fireEvent(screen.getByTestId(testID), 'accessibilityAction', {
    nativeEvent: { actionName: 'refresh' },
  });
}

/** The accessibility actions a list offers (empty when it cannot be refreshed). */
export function listActions(testID: string): readonly { name: string }[] {
  const props = screen.getByTestId(testID).props as {
    accessibilityActions?: readonly { name: string }[];
  };
  return props.accessibilityActions ?? [];
}
