// @vitest-environment jsdom
import type { ModerationTaskDetail, ModerationTaskSummary } from '@nilzora/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ModeratorQueuePage from '@/app/moderator/page';
import { ROLE_PERMISSIONS, testUser } from '@/test/fixtures';
import { ManageReview } from './admin-review';
import { ModerationTable } from './moderation-views';
import { QueueView, TaskDetailView } from './moderator-views';

const gate = vi.hoisted((): { value: unknown } => ({ value: undefined }));
vi.mock('@/lib/access', () => ({ workspaceGate: () => Promise.resolve(gate.value) }));
vi.mock('@/lib/moderation-actions', () => ({
  assignReviewAction: vi.fn(),
  withdrawReviewAction: vi.fn(),
  decideReviewAction: vi.fn(),
}));
vi.mock('@/lib/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));
vi.mock('@/lib/session', () => ({ session: {} }));
vi.mock('@/components/shell/workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), usePathname: () => '/' }));

afterEach(cleanup);

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const now = new Date('2026-10-25T12:00:00.000Z');
const SUBMITTER = { id: '44444444-4444-4444-8444-444444444444', name: 'Sadia', email: null };
const REVIEWER = { id: '55555555-5555-4555-8555-555555555555', name: 'Rafi', email: null };

function task(overrides: Partial<ModerationTaskSummary> = {}): ModerationTaskSummary {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    productId: '77777777-7777-4777-8777-777777777777',
    productName: 'Test Lamp',
    productSku: 'TL-1',
    status: 'pending',
    submittedBy: SUBMITTER,
    submittedAt: '2026-10-24T08:00:00.000Z',
    assignedTo: null,
    assignedAt: null,
    decidedAt: null,
    ...overrides,
  };
}

function detail(overrides: Partial<ModerationTaskDetail> = {}): ModerationTaskDetail {
  return {
    ...task({ assignedTo: REVIEWER, assignedAt: '2026-10-24T09:00:00.000Z' }),
    content: {
      name: 'Test Lamp',
      summary: 'A lamp',
      description: '<img src=x onerror=alert(1)>',
      slug: 'test-lamp',
      sku: 'TL-1',
      categoryId: '88888888-8888-4888-8888-888888888888',
      categoryName: 'Lighting',
      priceMinor: 150_000,
      compareAtPriceMinor: null,
    },
    decidedBy: null,
    decisionNote: null,
    events: [
      { kind: 'submitted', actor: SUBMITTER, note: null, at: '2026-10-24T08:00:00.000Z' },
      { kind: 'assigned', actor: REVIEWER, note: null, at: '2026-10-24T09:00:00.000Z' },
    ],
    product: { status: 'draft', moderationStatus: 'pending' },
    canDecide: true,
    ...overrides,
  };
}

const page = { page: 1, pageSize: 25, total: 1, totalPages: 1 };
const ADMIN = { id: '00000000-0000-4000-8000-000000000001', role: 'admin' };

describe('ModerationTable', () => {
  it('offers reviewers with their open counts, never the submitter', () => {
    render(
      <ModerationTable
        data={{ tasks: [task()], ...page }}
        filters={{ scope: 'unassigned' }}
        reviewers={{
          kind: 'ok',
          value: {
            reviewers: [
              { ...SUBMITTER, openReviews: 0 },
              { ...REVIEWER, openReviews: 3 },
            ],
          },
        }}
        actor={ADMIN}
        csrf={csrf}
        now={now}
      />,
    );
    const select = screen.getByLabelText('Reviewer for Test Lamp');
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Choose a reviewer', 'Rafi (3 open)']);
    expect(screen.getByRole('link', { name: 'Test Lamp' }).getAttribute('href')).toBe(
      '/admin/moderation/66666666-6666-4666-8666-666666666666',
    );
  });

  it('does not offer the assigner themselves unless an owner', () => {
    const me = { id: ADMIN.id, name: 'Me', email: null, openReviews: 0 };
    const { unmount } = render(
      <ModerationTable
        data={{ tasks: [task()], ...page }}
        filters={{ scope: 'all' }}
        reviewers={{ kind: 'ok', value: { reviewers: [me, { ...REVIEWER, openReviews: 1 }] } }}
        actor={ADMIN}
        csrf={csrf}
        now={now}
      />,
    );
    expect(screen.queryByRole('option', { name: 'Me (0 open)' })).toBeNull();
    unmount();
    render(
      <ModerationTable
        data={{ tasks: [task()], ...page }}
        filters={{ scope: 'all' }}
        reviewers={{ kind: 'ok', value: { reviewers: [me] } }}
        actor={{ ...ADMIN, role: 'super_admin' }}
        csrf={csrf}
        now={now}
      />,
    );
    expect(screen.getByRole('option', { name: 'Me (0 open)' })).toBeTruthy();
    // The form returns to this exact list view.
    expect(document.querySelector('input[name="returnTo"]')?.getAttribute('value')).toBe(
      '/admin/moderation',
    );
  });

  it('explains missing reviewers', () => {
    render(
      <ModerationTable
        data={{ tasks: [task()], ...page }}
        filters={{ scope: 'all' }}
        reviewers={{ kind: 'unavailable' }}
        actor={ADMIN}
        csrf={csrf}
        now={now}
      />,
    );
    expect(screen.getByText('Reviewers could not be loaded.')).toBeTruthy();
  });
});

describe('TaskDetailView', () => {
  it('shows the submitted content as text and the three decisions', () => {
    render(<TaskDetailView task={detail()} csrf={csrf} />);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    for (const label of ['Approve', 'Request changes', 'Reject']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    const reject = screen.getByLabelText(/Note for the submitter/, {
      selector: '#note-rejected',
    });
    expect(reject.getAttribute('minlength')).toBe('10');
    expect(screen.getByRole('list', { name: 'Review history' })).toBeTruthy();
  });

  it('shows the outcome and note of a decided review instead of the decisions', () => {
    render(
      <TaskDetailView
        task={detail({
          status: 'rejected',
          canDecide: false,
          decidedBy: REVIEWER,
          decidedAt: '2026-10-24T10:00:00.000Z',
          decisionNote: 'Photos are missing.',
        })}
        csrf={csrf}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText('Photos are missing.')).toBeTruthy();
  });
});

describe('ManageReview', () => {
  it('assigns and withdraws for assigners who may edit products', () => {
    render(
      <TaskDetailView
        task={detail({ canDecide: false })}
        csrf={csrf}
        manage={
          <ManageReview
            task={detail()}
            reviewers={{ kind: 'ok', value: { reviewers: [{ ...SUBMITTER, openReviews: 1 }] } }}
            permissions={ROLE_PERMISSIONS.admin}
            actor={ADMIN}
            csrf={csrf}
          />
        }
      />,
    );
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
    // The only reviewer is the submitter, so nobody else can take it.
    expect(screen.getByText('No other reviewer is available.')).toBeTruthy();
    expect(screen.getByText('Waiting for Rafi to decide.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByRole('link', { name: /Open the product/ }).getAttribute('href')).toBe(
      '/admin/products/77777777-7777-4777-8777-777777777777',
    );
  });

  it('offers withdrawal to every assigner', () => {
    render(
      <ManageReview
        task={detail()}
        reviewers={{ kind: 'unavailable' }}
        permissions={['admin_workspace.access', 'moderation.assign']}
        actor={ADMIN}
        csrf={csrf}
      />,
    );
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
    expect(screen.getByText('Reviewers could not be loaded.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Open the product/ })).toBeNull();
  });
});

describe('moderator queue', () => {
  const base = {
    decided: 7,
    approved: 5,
    changesRequested: 1,
    rejected: 1,
    recent: [] as ReturnType<typeof task>[],
    reviewsWaiting: null,
  };

  it('shows the figures, the queue first and the oldest waiting review', () => {
    render(
      <QueueView
        data={{ ...base, pending: { kind: 'ok', value: { tasks: [task()], ...page } } }}
        now={now}
      />,
    );
    expect(screen.getByText('Waiting for you')).toBeTruthy();
    expect(screen.getByText('Decided by you')).toBeTruthy();
    expect(screen.getByText('5 approved · 1 changes · 1 rejected')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Test Lamp' }).getAttribute('href')).toBe(
      '/moderator/tasks/66666666-6666-4666-8666-666666666666',
    );
    // The queue is the first section: what needs action comes before the chart and the history.
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(headings.indexOf('Needs your action')).toBeLessThan(headings.indexOf('Recent activity'));
  });

  it('guides a new moderator with empty states instead of blanks', () => {
    render(
      <QueueView
        data={{
          ...base,
          decided: 0,
          pending: { kind: 'ok', value: { tasks: [], ...page, total: 0 } },
        }}
        now={now}
      />,
    );
    expect(screen.getByText('Nothing is waiting for you')).toBeTruthy();
    expect(screen.getByText(/No decisions yet/)).toBeTruthy();
    expect(screen.getByText('You are all caught up')).toBeTruthy();
  });

  it('shows a moderator without the review permission a clear no-access state, not the queue', async () => {
    gate.value = {
      access: 'allowed',
      user: testUser('moderator', { permissions: ['moderator_workspace.access'] }),
      csrf,
    };

    render(await ModeratorQueuePage());

    expect(screen.getByText(/needs the .* permission/i)).toBeTruthy();
    expect(screen.queryByText('Needs your action')).toBeNull();
  });

  it('shows the customer-review count only for an account that may see it', () => {
    const { rerender } = render(
      <QueueView
        data={{ ...base, pending: { kind: 'ok', value: { tasks: [], ...page } } }}
        now={now}
      />,
    );
    expect(screen.getByText('Not part of your permissions')).toBeTruthy();
    rerender(
      <QueueView
        data={{
          ...base,
          reviewsWaiting: 4,
          pending: { kind: 'ok', value: { tasks: [], ...page } },
        }}
        now={now}
      />,
    );
    expect(screen.getByText('Awaiting moderation')).toBeTruthy();
  });
});
