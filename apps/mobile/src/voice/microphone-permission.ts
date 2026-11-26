/*
 * The microphone permission, asked for only when the customer taps the microphone.
 * `expo-audio` is loaded here, at the moment it is needed, rather than when the search screen
 * loads: screens that merely offer the microphone never pay for (or depend on) the audio module.
 */

export interface MicrophoneAccess {
  granted: boolean;
  /** Whether the system will still show its prompt (else only Settings can turn it on). */
  canAskAgain: boolean;
}

interface PermissionModule {
  getRecordingPermissionsAsync: () => Promise<MicrophoneAccess>;
  requestRecordingPermissionsAsync: () => Promise<MicrophoneAccess>;
}

/** The current answer, then — only if it is not yet allowed and can still be asked — the prompt. */
export async function ensureMicrophone(): Promise<MicrophoneAccess> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const audio = require('expo-audio') as PermissionModule;
    const current = await audio.getRecordingPermissionsAsync();
    if (current.granted || !current.canAskAgain) return current;
    return await audio.requestRecordingPermissionsAsync();
  } catch {
    return { granted: false, canAskAgain: true };
  }
}
