/*
 * Test stand-ins for the two expo-router pieces checkout uses to keep the customer on the
 * screen while an order is on its way: usePreventRemove and <Stack.Screen options>. Not
 * imported by the app, so never bundled. Spread them over the router mock:
 *
 *   jest.mock('expo-router', () => ({
 *     ...jest.requireActual<object>('@/test-utils/expo-router-mock'),
 *     ...jest.requireActual<{ leaveGuardMock: object }>('@/test-utils/leave-guard-mock').leaveGuardMock,
 *   }));
 *
 * and read what the screen asked for through `leaveGuard`.
 */

export interface StackScreenOptions {
  gestureEnabled?: boolean;
  headerBackVisible?: boolean;
}

export const leaveGuard = {
  /** Every value the screen passed to usePreventRemove, in render order. */
  prevented: [] as boolean[],
  /** The callback given to the latest usePreventRemove call (runs when leaving was blocked). */
  onBlocked: undefined as (() => void) | undefined,
  /** What usePreventRemove hands back to the screen so it can leave on purpose. */
  disablePrevention: jest.fn(),
  /** Every options object rendered through <Stack.Screen options={...} />. */
  stackOptions: [] as StackScreenOptions[],
};

export function resetLeaveGuard(): void {
  leaveGuard.prevented.length = 0;
  leaveGuard.onBlocked = undefined;
  leaveGuard.disablePrevention.mockClear();
  leaveGuard.stackOptions.length = 0;
}

/** Whether the screen is currently protected from being left. */
export function isLeavingBlocked(): boolean {
  return leaveGuard.prevented.at(-1) === true;
}

export const leaveGuardMock = {
  usePreventRemove(prevent: boolean, onBlocked?: () => void) {
    leaveGuard.prevented.push(prevent);
    leaveGuard.onBlocked = onBlocked;
    return leaveGuard.disablePrevention;
  },
  Stack: {
    Screen({ options }: { options?: StackScreenOptions }) {
      if (options) leaveGuard.stackOptions.push(options);
      return null;
    },
  },
};
