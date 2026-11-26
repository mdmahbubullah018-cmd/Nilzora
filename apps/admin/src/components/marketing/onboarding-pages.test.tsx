// @vitest-environment jsdom
import type { OnboardingCampaignSummary, PublicOnboarding } from '@nilzora/contracts';
import type { ApiClient } from '@nilzora/web-session';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingCampaignPage from '@/app/admin/marketing/onboarding/[campaignId]/page';
import OnboardingPreviewPage from '@/app/admin/marketing/onboarding/[campaignId]/preview/page';
import NewOnboardingCampaignPage from '@/app/admin/marketing/onboarding/new/page';
import OnboardingListPage from '@/app/admin/marketing/onboarding/page';
import { testUser } from '@/test/fixtures';

/*
 * The Marketing → Onboarding pages. The API is faked: these tests are about what an admin
 * sees and what the forms carry, not about the database rules (which live in the migration
 * draft and the API route tests).
 */

const api = vi.hoisted(() => ({
  adminOnboardingCampaigns: vi.fn(),
  adminOnboardingCampaign: vi.fn(),
  previewOnboardingCampaign: vi.fn(),
}));
const read = vi.hoisted((): { outcome: 'ok' | 'signed_out' | 'unavailable' | 'not_found' } => ({
  outcome: 'ok',
}));
const gate = vi.hoisted((): { user: unknown; csrf: unknown } => ({
  user: undefined,
  csrf: undefined,
}));
const actions = vi.hoisted(() => ({
  saveOnboardingCampaignAction: vi.fn(),
  setOnboardingActiveAction: vi.fn(),
  deleteOnboardingCampaignAction: vi.fn(),
  saveOnboardingSlideAction: vi.fn(),
  deleteOnboardingSlideAction: vi.fn(),
  moveOnboardingSlideAction: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  session: {
    read: async (call: (client: ApiClient, token: string) => Promise<unknown>) => {
      if (read.outcome !== 'ok') return { kind: read.outcome };
      return { kind: 'ok', value: await call(api as unknown as ApiClient, 'access-token') };
    },
  },
}));
vi.mock('@/lib/access', () => ({
  workspaceGate: () => Promise.resolve({ access: 'allowed', user: gate.user, csrf: gate.csrf }),
}));
vi.mock('@/lib/actions', () => ({ signInAction: vi.fn(), signOutAction: vi.fn() }));
vi.mock('@/lib/onboarding-actions', () => actions);
vi.mock('@/components/shell/workspace-shell', () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('next/navigation', async () => {
  const { throwNotFound, throwRedirect } = await import('@/test/redirect');
  return { redirect: vi.fn(throwRedirect), notFound: vi.fn(throwNotFound), usePathname: () => '/' };
});
vi.mock('next/form', () => ({
  default: ({ action, ...props }: ComponentProps<'form'> & { action: string }) => (
    <form action={action} method="get" {...props} />
  ),
}));

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const CAMPAIGN_ID = '0d000000-0000-4000-8000-000000000001';
const SLIDE_ID = '0d000000-0000-4000-8000-000000000002';
const AT = '2026-11-07T09:00:00.000Z';

const summary: OnboardingCampaignSummary = {
  id: CAMPAIGN_ID,
  internalName: 'Welcome sequence',
  kind: 'welcome',
  audience: 'all',
  frequency: 'first_launch',
  repeatDays: null,
  slideSeconds: 5,
  startsAt: null,
  endsAt: null,
  isActive: true,
  slideCount: 2,
  activeSlideCount: 1,
  updatedAt: AT,
};

const campaign = {
  id: CAMPAIGN_ID,
  internalName: 'Welcome sequence',
  kind: 'welcome' as const,
  audience: 'all' as const,
  frequency: 'first_launch' as const,
  repeatDays: null,
  slideSeconds: 5 as const,
  startsAt: null,
  endsAt: null,
  isActive: true,
  updatedAt: AT,
  slides: [
    {
      id: SLIDE_ID,
      campaignId: CAMPAIGN_ID,
      internalName: 'Welcome / discover',
      heading: 'Discover Nilzora',
      description: 'One shop, carefully chosen things.',
      imageKey: 'seo/welcome',
      icon: 'shop' as const,
      ctaLabel: 'Browse products',
      ctaPath: '/products',
      altText: 'A shop front',
      position: 1,
      isActive: true,
    },
    {
      id: '0d000000-0000-4000-8000-000000000003',
      campaignId: CAMPAIGN_ID,
      internalName: 'Welcome / delivery',
      heading: 'Delivered to your door',
      description: 'Cash on delivery across Bangladesh.',
      imageKey: null,
      icon: 'delivery' as const,
      ctaLabel: null,
      ctaPath: null,
      altText: null,
      position: 2,
      isActive: false,
    },
  ],
};

const preview: PublicOnboarding = {
  id: CAMPAIGN_ID,
  kind: 'welcome',
  frequency: 'first_launch',
  repeatDays: null,
  slideSeconds: 5,
  endsAt: null,
  slides: [
    {
      id: SLIDE_ID,
      heading: 'Discover Nilzora',
      description: 'One shop, carefully chosen things.',
      imageUrl: 'https://media.nilzora.test/seo/welcome/full.webp',
      icon: 'shop',
      ctaLabel: 'Browse products',
      ctaPath: '/products',
      altText: 'A shop front',
      position: 1,
    },
  ],
};

beforeEach(() => {
  gate.user = testUser('super_admin');
  gate.csrf = csrf;
  read.outcome = 'ok';
  for (const mock of Object.values(api)) mock.mockReset();
  for (const mock of Object.values(actions)) mock.mockReset();
  api.adminOnboardingCampaigns.mockResolvedValue({ campaigns: [summary] });
  api.adminOnboardingCampaign.mockResolvedValue({ campaign });
  api.previewOnboardingCampaign.mockResolvedValue({ campaign: preview });
});

afterEach(cleanup);

const params = (campaignId = CAMPAIGN_ID) => Promise.resolve({ campaignId });
const searchParams = (values: Record<string, string> = {}) => Promise.resolve(values);

describe('the campaign list', () => {
  it('shows the campaign, its audience, frequency, window and slide counts', async () => {
    render(<>{await OnboardingListPage()}</>);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Onboarding');
    expect(screen.getByRole('link', { name: 'Welcome sequence' }).getAttribute('href')).toBe(
      `/admin/marketing/onboarding/${CAMPAIGN_ID}`,
    );
    expect(screen.getByText('Everyone')).toBeTruthy();
    expect(screen.getByText('First launch only')).toBeTruthy();
    expect(screen.getByText('Always available')).toBeTruthy();
    expect(screen.getByText('1/2 shown')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('offers preview, deactivate and a confirmed delete per campaign', async () => {
    render(<>{await OnboardingListPage()}</>);

    expect(screen.getByRole('link', { name: 'Preview' }).getAttribute('href')).toBe(
      `/admin/marketing/onboarding/${CAMPAIGN_ID}/preview`,
    );
    const deactivate = screen.getByRole('button', { name: 'Deactivate' });
    expect(
      deactivate.closest('form')?.querySelector('input[name="active"]')?.getAttribute('value'),
    ).toBe('false');
    // Deleting asks for confirmation first (ConfirmForm); the trigger is always present.
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('explains an empty list and points at creating the first campaign', async () => {
    api.adminOnboardingCampaigns.mockResolvedValue({ campaigns: [] });
    render(<>{await OnboardingListPage()}</>);

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('No campaigns yet');
    expect(
      screen.getByRole('link', { name: 'Create the first campaign' }).getAttribute('href'),
    ).toBe('/admin/marketing/onboarding/new');
  });

  it('refuses a staff account that may not manage settings', async () => {
    gate.user = testUser('staff');
    render(<>{await OnboardingListPage()}</>);

    expect(screen.getByText(/This needs the .Manage store settings. permission/)).toBeTruthy();
    expect(api.adminOnboardingCampaigns).not.toHaveBeenCalled();
  });

  it('says so when the list cannot be read', async () => {
    read.outcome = 'unavailable';
    render(<>{await OnboardingListPage()}</>);

    expect(screen.getByText('This information is unavailable right now')).toBeTruthy();
  });
});

describe('the new campaign page', () => {
  it('starts as an inactive welcome sequence with 5-second slides', async () => {
    render(<>{await NewOnboardingCampaignPage()}</>);

    expect(screen.getByLabelText<HTMLSelectElement>('Kind').value).toBe('welcome');
    expect(screen.getByLabelText(/Seconds per slide/).textContent).toContain('5 seconds');
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: /Active/ }).checked).toBe(false);
    expect(screen.getByRole('button', { name: 'Create campaign' })).toBeTruthy();
    expect(screen.getByText(/nothing is shown to a customer until it is active/)).toBeTruthy();
  });
});

describe('the campaign editor', () => {
  it('prefills the campaign and lists its slides in order', async () => {
    render(<>{await OnboardingCampaignPage({ params: params(), searchParams: searchParams() })}</>);

    expect(screen.getByLabelText<HTMLInputElement>('Internal name').value).toBe('Welcome sequence');
    expect(screen.getByRole('heading', { level: 2, name: 'Slides (2)' })).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]!).getByText('Discover Nilzora')).toBeTruthy();
    expect(within(items[1]!).getByText('Delivered to your door')).toBeTruthy();
    // Disabled slides are marked, so an admin can see what customers would not.
    expect(screen.getByText('Not shown')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add slide' }).getAttribute('href')).toBe(
      `/admin/marketing/onboarding/${CAMPAIGN_ID}?slide=new`,
    );
  });

  it('shows no slide editor until one is chosen', async () => {
    render(<>{await OnboardingCampaignPage({ params: params(), searchParams: searchParams() })}</>);

    expect(screen.queryByRole('heading', { level: 2, name: 'New slide' })).toBeNull();
    expect(screen.queryByLabelText('Heading (optional)')).toBeNull();
  });

  it('opens the selected slide prefilled for editing', async () => {
    render(
      <>
        {await OnboardingCampaignPage({
          params: params(),
          searchParams: searchParams({ slide: SLIDE_ID }),
        })}
      </>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Edit “Discover Nilzora”' })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Heading (optional)').value).toBe(
      'Discover Nilzora',
    );
    expect(screen.getByLabelText<HTMLInputElement>('Image').value).toBe('seo/welcome');
    expect(screen.getByLabelText<HTMLInputElement>('Action destination').value).toBe('/products');
    expect(screen.getByRole('button', { name: 'Save slide' })).toBeTruthy();
  });

  it('opens an empty editor for a new slide', async () => {
    render(
      <>
        {await OnboardingCampaignPage({
          params: params(),
          searchParams: searchParams({ slide: 'new' }),
        })}
      </>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'New slide' })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Heading (optional)').value).toBe('');
    expect(screen.getByRole('button', { name: 'Add slide' })).toBeTruthy();
  });

  it('answers an unknown campaign with not found', async () => {
    read.outcome = 'not_found';

    await expect(
      OnboardingCampaignPage({ params: params(), searchParams: searchParams() }),
    ).rejects.toMatchObject({ digest: 'NEXT_NOT_FOUND' });
  });
});

describe('the preview', () => {
  it('shows the customer-facing slide with its resolved image', async () => {
    const { container } = render(<>{await OnboardingPreviewPage({ params: params() })}</>);

    expect(screen.getByText('Discover Nilzora')).toBeTruthy();
    expect(screen.getByText('One shop, carefully chosen things.')).toBeTruthy();
    expect(screen.getByText('Browse products')).toBeTruthy();
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://media.nilzora.test/seo/welcome/full.webp');
    expect(image?.getAttribute('alt')).toBe('A shop front');
    expect(screen.getByText(/Skip after 3 seconds/)).toBeTruthy();
  });

  it('never shows an internal field in the preview', async () => {
    const { container } = render(<>{await OnboardingPreviewPage({ params: params() })}</>);

    expect(container.textContent).not.toContain('internalName');
    expect(container.textContent).not.toContain('Welcome / discover');
  });
});
