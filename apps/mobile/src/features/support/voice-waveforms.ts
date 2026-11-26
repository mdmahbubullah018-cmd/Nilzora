import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

/*
 * Waveforms of voice messages recorded on this phone
 * --------------------------------------------------
 * A voice message's bars are drawn from the input level the recorder measured while it was being
 * recorded (see `levelOfMetering`). Those levels exist only on the phone that recorded it, so they
 * are kept here, keyed by the stored attachment's id, and survive a restart of the app.
 *
 * A voice message recorded elsewhere (by the support team, or on another device) has no levels on
 * this phone; its player shows plain, even bars instead of a made-up shape. Persisting the levels
 * with the attachment on the server is the follow-up that would give every device the real shape.
 */

/** The recorder's metering is in dBFS (about -160 silent … 0 loudest); speech sits above -50. */
const METER_FLOOR_DB = -50;

/** One metering reading as a level between 0 and 1. */
export function levelOfMetering(db: number | undefined): number | null {
  if (db === undefined || !Number.isFinite(db)) return null;
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
}

/** How many bars a waveform is reduced to: enough for a 220 dp bubble at 3 dp per bar. */
export const WAVEFORM_BARS = 36;
const STORAGE_KEY = 'nilzora.voice-waveforms.v1';
/** The newest waveforms kept; older ones fall back to even bars. */
const MAX_KEPT = 200;

type Store = Record<string, number[]>;

let memory: Store | null = null;
let loading: Promise<Store> | null = null;
const listeners = new Set<() => void>();

/** Reduces a level series to `bars` peaks, each the loudest reading in its slice (0–1). */
export function peaksOf(levels: readonly number[], bars = WAVEFORM_BARS): number[] {
  if (levels.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    const from = Math.floor((i * levels.length) / bars);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / bars));
    let peak = 0;
    for (let j = from; j < to && j < levels.length; j += 1) peak = Math.max(peak, levels[j] ?? 0);
    out.push(Math.round(Math.min(1, Math.max(0, peak)) * 100) / 100);
  }
  return out;
}

function load(): Promise<Store> {
  if (memory !== null) return Promise.resolve(memory);
  loading ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      const parsed: unknown = raw === null ? {} : JSON.parse(raw);
      memory = parsed !== null && typeof parsed === 'object' ? (parsed as Store) : {};
      return memory;
    })
    .catch(() => {
      memory = {};
      return memory;
    });
  return loading;
}

/** Keeps the recorded levels of a voice message this phone just uploaded. */
export async function rememberWaveform(
  attachmentId: string,
  levels: readonly number[],
): Promise<void> {
  const peaks = peaksOf(levels);
  if (peaks.length === 0) return;
  const store = await load();
  store[attachmentId] = peaks;
  const ids = Object.keys(store);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_KEPT))) delete store[id];
  for (const listener of listeners) listener();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store)).catch(() => undefined);
}

/** The recorded peaks of one voice message, or null when this phone has none for it. */
export function useWaveform(attachmentId: string): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(() => memory?.[attachmentId] ?? null);
  useEffect(() => {
    let alive = true;
    const read = () => {
      void load().then((store) => {
        if (alive) setPeaks(store[attachmentId] ?? null);
      });
    };
    read();
    listeners.add(read);
    return () => {
      alive = false;
      listeners.delete(read);
    };
  }, [attachmentId]);
  return peaks;
}
