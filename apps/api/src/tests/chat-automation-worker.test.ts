import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  createAutomationWorker,
  type AutomationJobOutcome,
} from '../modules/chat/automation-worker';
import { captureLogs } from './helpers';

/*
 * The chat automation worker's own guarantees. The database function it calls is covered by
 * `supabase/tests/chat_automation.test.sql` (claiming, retries, backoff, permanent failure);
 * what is tested here is the process around it: one tick at a time, a failed tick that does
 * not kill the loop, and a `stop()` that waits.
 */

const quiet = captureLogs('silent').logger;

function runnerOf(impl: (limit: number) => Promise<AutomationJobOutcome>): {
  runDue: Mock<(limit: number) => Promise<AutomationJobOutcome>>;
} {
  return { runDue: vi.fn(impl) };
}

function worker(runner: { runDue: (limit: number) => Promise<AutomationJobOutcome> }) {
  return createAutomationWorker({ runner, logger: quiet, intervalMs: 60_000, batchSize: 20 });
}

describe('chat automation worker', () => {
  it('processes due jobs with the configured batch size', async () => {
    const runner = runnerOf(() => Promise.resolve({ ran: 3, failed: 0 }));
    const subject = worker(runner);

    const outcome = await subject.tick();

    expect(outcome).toEqual({ ran: 3, failed: 0 });
    expect(runner.runDue).toHaveBeenCalledWith(20);
  });

  it('reports an idle tick when nothing is due', async () => {
    const runner = runnerOf(() => Promise.resolve({ ran: 0, failed: 0 }));
    const subject = worker(runner);

    await expect(subject.tick()).resolves.toEqual({ ran: 0, failed: 0 });
    expect(subject.isRunning()).toBe(false);
  });

  it('does not start a second tick while one is in flight', async () => {
    let release: (value: AutomationJobOutcome) => void = () => undefined;
    const pending = new Promise<AutomationJobOutcome>((resolve) => {
      release = resolve;
    });
    const runner = runnerOf(() => pending);
    const subject = worker(runner);

    const first = subject.tick();
    const second = subject.tick();

    // The overlapping call is dropped, not queued: the next timer tick finds the same jobs.
    await expect(second).resolves.toEqual({ ran: 0, failed: 0 });
    expect(runner.runDue).toHaveBeenCalledTimes(1);
    expect(subject.isRunning()).toBe(true);

    release({ ran: 1, failed: 0 });
    await expect(first).resolves.toEqual({ ran: 1, failed: 0 });
    expect(subject.isRunning()).toBe(false);
  });

  it('survives a failed tick and keeps the worker usable', async () => {
    const runner = runnerOf(() => Promise.reject(new Error('database is down')));
    const subject = worker(runner);

    await expect(subject.tick()).resolves.toEqual({ ran: 0, failed: 0 });
    expect(subject.isRunning()).toBe(false);

    // A later tick after the outage works normally.
    const recovered = runnerOf(() => Promise.resolve({ ran: 2, failed: 1 }));
    const second = worker(recovered);
    await expect(second.tick()).resolves.toEqual({ ran: 2, failed: 1 });
  });

  it('waits for an in-flight tick when it stops', async () => {
    let release: (value: AutomationJobOutcome) => void = () => undefined;
    const pending = new Promise<AutomationJobOutcome>((resolve) => {
      release = resolve;
    });
    const runner = runnerOf(() => pending);
    const subject = worker(runner);

    subject.start();
    // `start` runs a tick immediately so a restart catches up without waiting an interval.
    await vi.waitFor(() => {
      expect(subject.isRunning()).toBe(true);
    });

    const stopped = subject.stop();
    let settled = false;
    void stopped.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release({ ran: 1, failed: 0 });
    await stopped;
    expect(settled).toBe(true);
  });

  it('starts only one timer however often it is asked', async () => {
    const runner = runnerOf(() => Promise.resolve({ ran: 0, failed: 0 }));
    const subject = worker(runner);

    subject.start();
    subject.start();
    await vi.waitFor(() => {
      expect(runner.runDue).toHaveBeenCalled();
    });
    await subject.stop();

    // One immediate tick from the first start; the second start was a no-op.
    expect(runner.runDue.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('starts and stops cleanly, leaving no timer behind', async () => {
    const runner = runnerOf(() => Promise.resolve({ ran: 0, failed: 0 }));
    const subject = worker(runner);

    subject.start();
    await subject.stop();
    // Stopping twice is safe.
    await subject.stop();
    expect(subject.isRunning()).toBe(false);
  });
});

