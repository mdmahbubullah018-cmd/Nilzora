import { randomUUID } from 'node:crypto';
import {
  adminProductResponseSchema,
  moderationReviewerListResponseSchema,
  moderationTaskListResponseSchema,
  moderationTaskResponseSchema,
} from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import { adminSetup, errorOf, type AdminSetup, type Who } from './admin-helpers';

function decide(setup: AdminSetup, who: Who, taskId: string, body: object) {
  return setup.call('post', `/moderator/tasks/${taskId}/decision`, who, body);
}

function assign(setup: AdminSetup, who: Who, taskId: string, moderatorId: string) {
  return setup.call('post', `/admin/moderation/${taskId}/assignment`, who, { moderatorId });
}

describe('GET /api/v1/moderator/queue', () => {
  it('lists only the reviews assigned to the caller', async () => {
    const setup = adminSetup();
    const mine = await setup.call('get', '/moderator/queue', 'moderator');
    const theirs = await setup.call('get', '/moderator/queue', 'otherModerator');

    const queue = moderationTaskListResponseSchema.parse(mine.body);
    expect(queue.tasks.map((task) => task.id)).toEqual([setup.tasks.assigned.id]);
    expect(queue.tasks[0]).toMatchObject({
      productName: 'Steel Kettle',
      submittedBy: { id: setup.users.staff.id, name: 'Sadia Staff' },
      assignedTo: { id: setup.users.moderator.id },
    });
    expect(moderationTaskListResponseSchema.parse(theirs.body)).toMatchObject({
      tasks: [],
      total: 0,
    });
  });

  it('serves pending reviews oldest first and filters by status', async () => {
    const setup = adminSetup();
    const later = setup.admin.addTask(setup.products.watch, {
      submittedBy: setup.users.staff.id,
      assignedTo: setup.users.moderator.id,
    });
    setup.admin.addTask(setup.products.lamp, {
      status: 'approved',
      assignedTo: setup.users.moderator.id,
      decidedAt: '2026-10-24T08:00:00.000Z',
    });
    const pending = await setup.call('get', '/moderator/queue?status=pending', 'moderator');
    const approved = await setup.call('get', '/moderator/queue?status=approved', 'moderator');

    expect(
      moderationTaskListResponseSchema.parse(pending.body).tasks.map((task) => task.id),
    ).toEqual([setup.tasks.assigned.id, later.id]);
    expect(moderationTaskListResponseSchema.parse(approved.body).total).toBe(1);
  });

  it('rejects an unknown status', async () => {
    const setup = adminSetup();
    expect((await setup.call('get', '/moderator/queue?status=done', 'moderator')).status).toBe(400);
  });
});

describe('GET /api/v1/moderator/tasks/:taskId', () => {
  it('shows an assigned review with its submitted content', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'get',
      `/moderator/tasks/${setup.tasks.assigned.id}`,
      'moderator',
    );

    expect(response.status).toBe(200);
    expect(moderationTaskResponseSchema.parse(response.body).task).toMatchObject({
      status: 'pending',
      content: { name: 'Steel Kettle', sku: 'STEEL-KETTLE', categoryName: 'Home & Kitchen' },
      product: { status: 'draft', moderationStatus: 'pending' },
      canDecide: true,
    });
  });

  it.each<[string, (setup: AdminSetup) => string]>([
    ["another moderator's review", (s) => s.tasks.assigned.id],
    ['an unassigned review', (s) => s.tasks.unassigned.id],
    ['an unknown review', () => randomUUID()],
  ])('answers 404 for %s', async (_label, taskId) => {
    const setup = adminSetup();
    const response = await setup.call('get', `/moderator/tasks/${taskId(setup)}`, 'otherModerator');

    expect(response.status).toBe(404);
    expect(errorOf(response.body)).toMatchObject({
      code: 'not_found',
      message: 'Review not found',
    });
  });

  it('answers 404 even to an assigner for a review not assigned to them', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'get',
      `/moderator/tasks/${setup.tasks.assigned.id}`,
      'admin',
    );

    expect(response.status).toBe(404);
  });
});

describe('POST /api/v1/moderator/tasks/:taskId/decision', () => {
  it('approves the content, so the product can then be published', async () => {
    const setup = adminSetup();
    const { assigned } = setup.tasks;
    const response = await decide(setup, 'moderator', assigned.id, { decision: 'approved' });

    expect(response.status).toBe(200);
    expect(moderationTaskResponseSchema.parse(response.body).task).toMatchObject({
      status: 'approved',
      decidedBy: { id: setup.users.moderator.id },
      product: { moderationStatus: 'approved' },
      canDecide: false,
      events: [{ kind: 'approved', actor: { id: setup.users.moderator.id }, note: null }],
    });
    expect(setup.admin.audit.at(-1)).toMatchObject({
      action: 'moderation.decided',
      actorId: setup.users.moderator.id,
    });
    const published = await setup.call(
      'post',
      `/admin/products/${setup.products.kettle.id}/status`,
      'admin',
      { status: 'active' },
    );
    expect(adminProductResponseSchema.parse(published.body).product.status).toBe('active');
  });

  it.each([
    ['rejected', 'Photos show a different product.'],
    ['changes_requested', 'Please add the capacity in litres.'],
  ] as const)('records %s with its explanation', async (decision, note) => {
    const setup = adminSetup();
    const response = await decide(setup, 'moderator', setup.tasks.assigned.id, { decision, note });

    expect(response.status).toBe(200);
    expect(moderationTaskResponseSchema.parse(response.body).task).toMatchObject({
      status: decision,
      decisionNote: note,
    });
    expect(setup.products.kettle.moderationStatus).toBe(decision);
  });

  it("answers 404 for another moderator's review and changes nothing (the database decides)", async () => {
    const setup = adminSetup();
    const response = await decide(setup, 'otherModerator', setup.tasks.assigned.id, {
      decision: 'approved',
    });

    expect(response.status).toBe(404);
    expect(errorOf(response.body).code).toBe('not_found');
    expect(setup.admin.calls).toContain('decide');
    expect(setup.tasks.assigned.status).toBe('pending');
    expect(setup.products.kettle.moderationStatus).toBe('pending');
  });

  it('refuses a review already closed (NZ436)', async () => {
    const setup = adminSetup();
    await decide(setup, 'moderator', setup.tasks.assigned.id, { decision: 'approved' });
    const again = await decide(setup, 'moderator', setup.tasks.assigned.id, {
      decision: 'rejected',
      note: 'Changed my mind about it.',
    });

    expect(again.status).toBe(409);
    expect(errorOf(again.body).code).toBe('review_closed');
    expect(setup.tasks.assigned.status).toBe('approved');
  });

  it('refuses a decision on the caller’s own submission (NZ437)', async () => {
    const setup = adminSetup();
    const own = setup.admin.addTask(setup.products.watch, {
      submittedBy: setup.users.moderator.id,
      assignedTo: setup.users.moderator.id,
    });
    const shown = await setup.call('get', `/moderator/tasks/${own.id}`, 'moderator');
    const response = await decide(setup, 'moderator', own.id, { decision: 'approved' });

    expect(moderationTaskResponseSchema.parse(shown.body).task.canDecide).toBe(false);
    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('own_submission');
    expect(own.status).toBe('pending');
  });

  it.each([
    ['a rejection without a note', { decision: 'rejected' }],
    ['a change request with a short note', { decision: 'changes_requested', note: 'Fix it' }],
    ['a withdrawal', { decision: 'withdrawn' }],
    ['a pending decision', { decision: 'pending' }],
    ['a decider', { decision: 'approved', decidedBy: randomUUID() }],
    ['a product status', { decision: 'approved', productStatus: 'active' }],
    ['an oversized note', { decision: 'approved', note: 'x'.repeat(1001) }],
  ])('rejects %s', async (_label, body) => {
    const setup = adminSetup();
    const response = await decide(setup, 'moderator', setup.tasks.assigned.id, body);

    expect(response.status).toBe(400);
    expect(errorOf(response.body).code).toBe('validation_failed');
    expect(setup.admin.calls).toEqual([]);
  });

  it('maps a note the database refuses (NZ412) to 400', async () => {
    const setup = adminSetup();
    setup.admin.nextFailure = { code: 'NZ412' };
    const response = await decide(setup, 'moderator', setup.tasks.assigned.id, {
      decision: 'approved',
    });

    expect(response.status).toBe(400);
    expect(errorOf(response.body)).toMatchObject({
      code: 'bad_request',
      message: 'Explain the decision in 10 to 1,000 characters',
    });
  });
});

describe('GET /api/v1/admin/moderation', () => {
  it.each([
    ['all', '', ['vase', 'kettle']],
    ['unassigned', '?scope=unassigned', ['vase']],
    ['mine', '?scope=mine', []],
  ])('lists %s reviews', async (_label, query, products) => {
    const setup = adminSetup();
    const response = await setup.call('get', `/admin/moderation${query}`, 'admin');

    const ids = { vase: setup.tasks.unassigned.id, kettle: setup.tasks.assigned.id };
    expect(
      moderationTaskListResponseSchema.parse(response.body).tasks.map((task) => task.id),
    ).toEqual(products.map((product) => ids[product as keyof typeof ids]));
  });

  it('rejects an unknown scope', async () => {
    const setup = adminSetup();
    expect((await setup.call('get', '/admin/moderation?scope=team', 'admin')).status).toBe(400);
  });

  it('shows any review to an assigner, without offering the decision', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'get',
      `/admin/moderation/${setup.tasks.assigned.id}`,
      'admin',
    );

    expect(moderationTaskResponseSchema.parse(response.body).task).toMatchObject({
      id: setup.tasks.assigned.id,
      canDecide: false,
    });
  });

  it('answers 404 for an unknown review', async () => {
    const setup = adminSetup();
    expect((await setup.call('get', `/admin/moderation/${randomUUID()}`, 'admin')).status).toBe(
      404,
    );
  });
});

describe('POST /api/v1/admin/moderation/:taskId/assignment', () => {
  it('hands a review to a moderator, whose queue then holds it', async () => {
    const setup = adminSetup();
    const { unassigned } = setup.tasks;
    const response = await assign(setup, 'admin', unassigned.id, setup.users.otherModerator.id);
    const queue = await setup.call('get', '/moderator/queue', 'otherModerator');

    expect(response.status).toBe(200);
    expect(moderationTaskResponseSchema.parse(response.body).task).toMatchObject({
      assignedTo: { id: setup.users.otherModerator.id, name: 'Rafi Reviewer' },
      events: [{ kind: 'assigned', actor: { id: setup.users.admin.id } }],
    });
    expect(moderationTaskListResponseSchema.parse(queue.body).tasks.map((task) => task.id)).toEqual(
      [unassigned.id],
    );
  });

  it('reassigns a review: the previous moderator then gets 404', async () => {
    const setup = adminSetup();
    const { assigned } = setup.tasks;
    await assign(setup, 'admin', assigned.id, setup.users.otherModerator.id);
    const previous = await decide(setup, 'moderator', assigned.id, { decision: 'approved' });
    const current = await decide(setup, 'otherModerator', assigned.id, { decision: 'approved' });

    expect(previous.status).toBe(404);
    expect(current.status).toBe(200);
  });

  it.each<[string, (setup: AdminSetup) => string, number, string]>([
    [
      'an account that cannot review (NZ436)',
      (s) => s.users.staff.id,
      409,
      'review_not_assignable',
    ],
    [
      'a suspended moderator (NZ436)',
      (s) => {
        s.users.otherModerator.status = 'suspended';
        return s.users.otherModerator.id;
      },
      409,
      'review_not_assignable',
    ],
    [
      'a moderator whose content.approve is denied (NZ436)',
      (s) => {
        s.deny('otherModerator', 'content.approve');
        return s.users.otherModerator.id;
      },
      409,
      'review_not_assignable',
    ],
    [
      'the submitter (NZ437)',
      (s) => {
        s.tasks.unassigned.submittedBy = s.users.owner.id;
        return s.users.owner.id;
      },
      409,
      'own_submission',
    ],
  ])('refuses %s', async (_label, moderator, status, code) => {
    const setup = adminSetup();
    const moderatorId = moderator(setup);
    const response = await assign(setup, 'admin', setup.tasks.unassigned.id, moderatorId);

    expect(response.status).toBe(status);
    expect(errorOf(response.body).code).toBe(code);
    expect(setup.tasks.unassigned.assignedTo).toBeNull();
  });

  it('refuses a closed review (NZ436) and an unknown one (NZ404)', async () => {
    const setup = adminSetup();
    setup.tasks.unassigned.status = 'withdrawn';
    const closed = await assign(
      setup,
      'admin',
      setup.tasks.unassigned.id,
      setup.users.moderator.id,
    );
    const missing = await assign(setup, 'admin', randomUUID(), setup.users.moderator.id);

    expect(closed.status).toBe(409);
    expect(errorOf(closed.body).code).toBe('review_not_assignable');
    expect(missing.status).toBe(404);
  });

  it.each([
    ['a malformed moderator id', { moderatorId: 'mitu' }],
    ['no moderator', {}],
    ['an assigning account', { moderatorId: randomUUID(), assignedBy: randomUUID() }],
  ])('rejects %s', async (_label, body) => {
    const setup = adminSetup();
    const response = await setup.call(
      'post',
      `/admin/moderation/${setup.tasks.unassigned.id}/assignment`,
      'admin',
      body,
    );

    expect(response.status).toBe(400);
    expect(setup.admin.calls).toEqual([]);
  });
});

describe('POST /api/v1/admin/moderation/:taskId/withdraw', () => {
  it('withdraws an open review, returning the product to its editors', async () => {
    const setup = adminSetup();
    const response = await setup.call(
      'post',
      `/admin/moderation/${setup.tasks.assigned.id}/withdraw`,
      'staff',
    );

    expect(response.status).toBe(200);
    expect(moderationTaskResponseSchema.parse(response.body).task).toMatchObject({
      status: 'withdrawn',
      product: { moderationStatus: 'not_submitted' },
    });
    expect(
      (await decide(setup, 'moderator', setup.tasks.assigned.id, { decision: 'approved' })).status,
    ).toBe(409);
  });

  it('refuses a closed review (NZ436), an unknown one (NZ404) and any body field', async () => {
    const setup = adminSetup();
    setup.tasks.unassigned.status = 'approved';
    const closed = await setup.call(
      'post',
      `/admin/moderation/${setup.tasks.unassigned.id}/withdraw`,
      'staff',
    );
    const missing = await setup.call('post', `/admin/moderation/${randomUUID()}/withdraw`, 'staff');
    const withBody = await setup.call(
      'post',
      `/admin/moderation/${setup.tasks.assigned.id}/withdraw`,
      'staff',
      { status: 'withdrawn' },
    );

    expect(closed.status).toBe(409);
    expect(errorOf(closed.body).code).toBe('review_closed');
    expect(missing.status).toBe(404);
    expect(withBody.status).toBe(400);
  });
});

describe('GET /api/v1/admin/moderation/reviewers', () => {
  it('lists active accounts that hold content.approve, with their open reviews', async () => {
    const setup = adminSetup();
    setup.users.otherModerator.status = 'suspended';
    setup.deny('owner', 'content.approve');
    const response = await setup.call('get', '/admin/moderation/reviewers', 'admin');

    const { reviewers } = moderationReviewerListResponseSchema.parse(response.body);
    expect(
      reviewers
        .map((reviewer) => [reviewer.email, reviewer.name, reviewer.openReviews])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ['admin@example.com', 'Arif Admin', 0],
      ['moderator@example.com', 'Mitu Moderator', 1],
    ]);
  });

  it('serves an assigner who holds moderation.assign and no staff-management permission', async () => {
    const setup = adminSetup();
    setup.users.staff.overrides.set('moderation.assign', 'grant');
    const response = await setup.call('get', '/admin/moderation/reviewers', 'staff');

    expect(response.status).toBe(200);
    expect(
      moderationReviewerListResponseSchema.parse(response.body).reviewers.map((r) => r.id),
    ).toContain(setup.users.moderator.id);
  });

  it('answers 403 when moderation.assign is withdrawn before the database is asked (NZ403)', async () => {
    const setup = adminSetup();
    setup.admin.nextFailure = { code: 'NZ403' };
    const response = await setup.call('get', '/admin/moderation/reviewers', 'admin');

    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('forbidden');
  });
});

describe('who may review, assign and withdraw', () => {
  const ownContent =
    'Reviews go to someone who neither submitted nor last edited the content, and only an owner can take a review themselves';

  it('refuses an assigner taking a review themselves, unless they are an owner (NZ437)', async () => {
    const setup = adminSetup();
    const byAdmin = await assign(setup, 'admin', setup.tasks.unassigned.id, setup.users.admin.id);
    const byOwner = await assign(setup, 'owner', setup.tasks.unassigned.id, setup.users.owner.id);

    expect(byAdmin.status).toBe(409);
    expect(errorOf(byAdmin.body)).toMatchObject({ code: 'own_submission', message: ownContent });
    expect(byOwner.status).toBe(200);
  });

  it('refuses assigning or deciding a review by whoever last edited the content (NZ437)', async () => {
    const setup = adminSetup();
    setup.tasks.unassigned.contentEditor = setup.users.otherModerator.id;
    setup.tasks.assigned.contentEditor = setup.users.moderator.id;
    const assigned = await assign(
      setup,
      'admin',
      setup.tasks.unassigned.id,
      setup.users.otherModerator.id,
    );
    const decided = await decide(setup, 'moderator', setup.tasks.assigned.id, {
      decision: 'approved',
    });

    for (const response of [assigned, decided]) {
      expect(response.status).toBe(409);
      expect(errorOf(response.body)).toMatchObject({ code: 'own_submission', message: ownContent });
    }
    expect(setup.tasks.assigned.status).toBe('pending');
  });

  it('records the content editor when a draft is submitted', async () => {
    const setup = adminSetup();
    const { watch } = setup.products;
    await setup.call('put', `/admin/products/${watch.id}`, 'admin', {
      categoryId: watch.categoryId,
      slug: watch.slug,
      name: 'Smart Watch Pro',
      priceMinor: watch.priceMinor,
    });
    await setup.call('post', `/admin/products/${watch.id}/submit`, 'staff');

    expect(setup.admin.tasks.at(-1)).toMatchObject({
      submittedBy: setup.users.staff.id,
      contentEditor: setup.users.admin.id,
    });
  });

  it('lets the submitter or an assigner withdraw, and nobody else (NZ403)', async () => {
    const setup = adminSetup();
    const ownersTask = setup.admin.addTask(setup.products.watch, {
      submittedBy: setup.users.owner.id,
    });
    const byOtherStaff = await setup.call(
      'post',
      `/admin/moderation/${ownersTask.id}/withdraw`,
      'staff',
    );
    const byAssigner = await setup.call(
      'post',
      `/admin/moderation/${ownersTask.id}/withdraw`,
      'admin',
    );
    const bySubmitter = await setup.call(
      'post',
      `/admin/moderation/${setup.tasks.unassigned.id}/withdraw`,
      'staff',
    );

    expect(byOtherStaff.status).toBe(403);
    expect(errorOf(byOtherStaff.body)).toMatchObject({
      code: 'forbidden',
      message: 'Only the submitter or a review assigner can withdraw this review',
    });
    expect(byAssigner.status).toBe(200);
    expect(bySubmitter.status).toBe(200);
  });

  it('keeps the standard permission answer for decisions', async () => {
    const setup = adminSetup();
    setup.admin.nextFailure = { code: 'NZ403' };
    const response = await decide(setup, 'moderator', setup.tasks.assigned.id, {
      decision: 'approved',
    });

    expect(response.status).toBe(403);
    expect(errorOf(response.body).message).toBe('You do not have permission to do this');
  });
});
