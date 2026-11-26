/*
 * Launch timing
 * -------------
 * A handful of marks printed once each at launch, so the launch can be measured on a real device
 * instead of guessed at:
 *
 *   [startup] js:root-layout t=118ms
 *   [startup] splash:native-held t=121ms
 *   [startup] splash:mount t=156ms
 *   [startup] splash:first-frame t=540ms
 *   [startup] splash:native-hidden t=560ms
 *   [startup] session:signed_out t=690ms
 *   [startup] home:first-render t=735ms
 *   [startup] splash:gone t=4900ms
 *
 * `t` is `performance.now()`: milliseconds since the JavaScript runtime started, so it already
 * includes loading and evaluating the bundle out of the APK. What happens before that (process
 * start, engine and native module boot) is not visible from JavaScript; Android reports it as its
 * own cold-start figure in logcat — compare the two to see how much of the launch is ours.
 *
 * Printed in release builds on purpose: a launch can only be judged there. The lines carry stage
 * names and the session's status word only — never a token, an id, an address or any content.
 */

/** Records the moment a launch stage was reached. Cheap: one clock read and one console line. */
export function startupMark(label: string): void {
  // `log` rather than `warn`: a warning would raise LogBox over the very screen being measured.
  // eslint-disable-next-line no-console -- the launch trace is the point of this module
  console.log(`[startup] ${label} t=${performance.now().toFixed(0)}ms`);
}
