// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageSearchJobControls } from './job-controls';
import { ImageSearchSettingsForm } from './settings-form';

const actions = vi.hoisted(() => ({
  save: vi.fn(),
  startJob: vi.fn(),
}));

vi.mock('@/lib/image-search-actions', () => ({
  saveImageSearchSettingsAction: actions.save,
  startImageSearchJobAction: actions.startJob,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

const csrf = { name: 'csrf_token', token: 'signed-test-token' };

const field = (label: string | RegExp): HTMLInputElement =>
  screen.getByLabelText<HTMLInputElement>(label);
const jobButton = (name: RegExp): HTMLButtonElement =>
  screen.getByRole('button', { name });

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset().mockResolvedValue({ status: 'idle' });
});
afterEach(cleanup);

/*
 * These render the real panels with the values the page read from the database, so the fields
 * an operator sees are the stored settings rather than anything hard-coded. The server actions
 * are stubbed here: the page's own permission gate and the API's authorization are covered by
 * the API tests and the database integration tests.
 */

describe('ImageSearchSettingsForm', () => {
  it('shows the stored settings, with the model left to the server', () => {
    render(
      <ImageSearchSettingsForm enabled similarityThreshold={0.7} maxResults={24} csrf={csrf} />,
    );

    expect(field(/Image search is available to customers/).checked).toBe(true);
    expect(field('Similarity threshold').value).toBe('0.7');
    expect(field('Similarity threshold').min).toBe('0.3');
    expect(field('Similarity threshold').max).toBe('0.99');
    expect(field('Maximum results').value).toBe('24');
    // The model is information, not a control: no input carries it.
    expect(screen.queryByLabelText(/model/i)).toBeNull();
  });

  it('renders a switched-off feature as unchecked without hiding the numbers', () => {
    render(
      <ImageSearchSettingsForm
        enabled={false}
        similarityThreshold={0.82}
        maxResults={12}
        csrf={csrf}
      />,
    );

    expect(field(/Image search is available to customers/).checked).toBe(false);
    expect(field('Similarity threshold').value).toBe('0.82');
    expect(field('Maximum results').value).toBe('12');
  });
});

describe('ImageSearchJobControls', () => {
  it('offers all three jobs while nothing is running', () => {
    render(<ImageSearchJobControls csrf={csrf} busy={false} failedCount={2} />);

    expect(jobButton(/Backfill new pictures/i).disabled).toBe(false);
    expect(jobButton(/Reindex everything/i).disabled).toBe(false);
    expect(jobButton(/Retry failed \(2\)/i).disabled).toBe(false);
  });

  it('disables every job while one is running, so two cannot work on the same rows', () => {
    render(<ImageSearchJobControls csrf={csrf} busy failedCount={2} />);

    for (const item of screen.getAllByRole('button')) {
      expect((item as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('keeps retry unavailable when no picture failed', () => {
    render(<ImageSearchJobControls csrf={csrf} busy={false} failedCount={0} />);

    // Still shown, so the job set never changes shape, but nothing can be retried.
    expect(jobButton(/Retry failed/i).disabled).toBe(true);
  });
});
