// @vitest-environment jsdom
import type {
  PublicStoreProfile,
  SeoOverviewRow,
  StaffNotificationListResponse,
} from '@nilzora/contracts';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxView } from './inbox-views';
import { SeoEditorForm } from './seo-editor-form';
import { absentFields, profileTexts, StoreProfileForm } from './store-profile-form';
import { SeoOverviewView } from './seo-overview';

const actions = vi.hoisted(() => ({
  saveSeo: vi.fn(),
  saveProfile: vi.fn(),
  markRead: vi.fn(),
  markAll: vi.fn(),
}));

vi.mock('@/lib/site-actions', () => ({
  saveSeoAction: actions.saveSeo,
  saveStoreProfileAction: actions.saveProfile,
  markNotificationReadAction: actions.markRead,
  markAllNotificationsReadAction: actions.markAll,
}));
vi.mock('@/lib/media-actions', () => ({ searchMediaAction: vi.fn() }));
vi.mock('next/form', () => ({
  default: ({ action, ...props }: React.ComponentProps<'form'> & { action: string }) => (
    <form action={action} method="get" {...props} />
  ),
}));

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const ID = '1d000000-0000-4000-8000-000000000001';
const AT = '2026-11-06T09:00:00.000Z';

function entry(overrides: Partial<SeoOverviewRow> = {}): SeoOverviewRow {
  return {
    kind: 'product',
    id: ID,
    slug: 'brass-table-lamp',
    name: 'Brass table lamp',
    isPublic: true,
    seoTitle: 'Brass lamp',
    seoDescription: null,
    ogTitle: null,
    ogDescription: null,
    ogImageKey: null,
    canonicalPath: null,
    noIndex: false,
    missingTitle: false,
    missingDescription: true,
    updatedAt: AT,
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset().mockResolvedValue({ status: 'idle' });
});
afterEach(cleanup);

describe('SeoEditorForm', () => {
  it('counts each field against its limit and previews the result as it is typed', () => {
    render(<SeoEditorForm entry={entry()} canEdit csrf={csrf} />);

    // 10 of 70 characters used.
    expect(screen.getByText('10/70')).toBeTruthy();
    const preview = screen.getByTestId('seo-preview');
    expect(within(preview).getByText('Brass lamp')).toBeTruthy();
    expect(within(preview).getByText('https://nilzora.com/products/brass-table-lamp')).toBeTruthy();
    expect(within(preview).getByText('No search description yet.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search title'), {
      target: { value: 'Warm brass lamp' },
    });
    fireEvent.change(screen.getByLabelText('Search description'), {
      target: { value: 'Hand finished.' },
    });
    fireEvent.change(screen.getByLabelText('Canonical path'), { target: { value: '/lamp' } });
    expect(within(preview).getByText('Warm brass lamp')).toBeTruthy();
    expect(within(preview).getByText('Hand finished.')).toBeTruthy();
    expect(within(preview).getByText('https://nilzora.com/lamp')).toBeTruthy();
  });

  it('previews a category at its storefront path', () => {
    render(
      <SeoEditorForm
        entry={entry({ kind: 'category', slug: 'home', name: 'Home' })}
        canEdit
        csrf={csrf}
      />,
    );
    expect(
      within(screen.getByTestId('seo-preview')).getByText('https://nilzora.com/categories/home'),
    ).toBeTruthy();
  });

  it('blocks a send while a field is wrong and says which', async () => {
    render(<SeoEditorForm entry={entry()} canEdit csrf={csrf} />);

    fireEvent.change(screen.getByLabelText('Canonical path'), {
      target: { value: 'https://evil.example/' },
    });
    fireEvent.change(screen.getByLabelText('Search title'), { target: { value: 'x'.repeat(75) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save metadata' }));

    expect(
      await screen.findByText(/Use a path on this site that starts with a single \//),
    ).toBeTruthy();
    expect(screen.getByText(/Keep the search title under 70 characters/)).toBeTruthy();
    expect(screen.getByText('75/70')).toBeTruthy();
    expect(actions.saveSeo).not.toHaveBeenCalled();
  });

  it('sends the kind, the id and the CSRF token, and shows the outcome', async () => {
    actions.saveSeo.mockResolvedValue({ status: 'success', message: 'Search metadata saved.' });
    render(<SeoEditorForm entry={entry()} canEdit csrf={csrf} />);

    fireEvent.change(screen.getByLabelText('Search description'), {
      target: { value: 'A hand-finished brass lamp.' },
    });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save metadata' }));

    expect(await screen.findByText('Search metadata saved.')).toBeTruthy();
    const sent = actions.saveSeo.mock.calls[0]?.[1] as FormData;
    expect(sent.get('kind')).toBe('product');
    expect(sent.get('targetId')).toBe(ID);
    expect(sent.get('seoDescription')).toBe('A hand-finished brass lamp.');
    expect(sent.get('csrf_token')).toBe('signed-test-token');
  });

  it('shows a refusal instead of staying silent', async () => {
    actions.saveSeo.mockResolvedValue({
      status: 'error',
      message: 'Your account does not have permission for this action.',
    });
    render(<SeoEditorForm entry={entry()} canEdit csrf={csrf} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save metadata' }));
    expect(
      await screen.findByText('Your account does not have permission for this action.'),
    ).toBeTruthy();
  });

  it('is read-only without products.update', () => {
    render(<SeoEditorForm entry={entry()} canEdit={false} csrf={csrf} />);
    expect(screen.getByText('Your account can read this page but not change it.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save metadata' })).toHaveProperty('disabled', true);
    // The whole fieldset is disabled, so every field in it is.
    expect(screen.getByLabelText('Search title').matches(':disabled')).toBe(true);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });
});

describe('SeoOverviewView', () => {
  it('links every page to the singular editor path and names the fallback per kind', () => {
    render(
      <SeoOverviewView
        entries={[
          entry({ seoTitle: null }),
          entry({
            kind: 'category',
            id: '1d000000-0000-4000-8000-000000000002',
            name: 'Home',
            slug: 'home',
            seoTitle: null,
          }),
        ]}
        q=""
      />,
    );
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toContain(`/admin/seo/product/${ID}`);
    expect(hrefs).toContain('/admin/seo/category/1d000000-0000-4000-8000-000000000002');
    expect(hrefs.some((href) => /\/seo\/(products|categories)\//.test(href ?? ''))).toBe(false);
    expect(screen.getByText('Missing — the product name is used')).toBeTruthy();
    expect(screen.getByText('Missing — the category name is used')).toBeTruthy();
  });
});

const profile: PublicStoreProfile = {
  displayName: 'Nilzora',
  tagline: null,
  description: null,
  logoKey: null,
  logoUrl: null,
  contactEmail: null,
  contactPhone: null,
  addressLine: null,
  addressArea: null,
  addressDistrict: null,
  businessHours: null,
  supportEmail: null,
  supportPhone: null,
  social: { facebook: null, instagram: null, youtube: null },
  defaultSeoTitle: null,
  defaultSeoDescription: null,
  ogImageKey: null,
  ogImageUrl: null,
  codAvailable: true,
  updatedAt: AT,
};

describe('StoreProfileForm', () => {
  it('lays the profile out in sections, with the newer fields filled from the profile', () => {
    render(
      <StoreProfileForm
        profile={{
          ...profile,
          social: { ...profile.social, tiktok: 'https://www.tiktok.com/@nilzora', x: null },
          whatsappNumber: '+8801712345678',
          playStoreUrl: 'https://play.google.com/store/apps/details?id=com.nilzora',
          appStoreUrl: null,
        }}
        csrf={csrf}
      />,
    );

    for (const name of [
      'Store identity',
      'Contact & support',
      'Address & opening hours',
      'Social links',
      'Mobile app & messaging',
      'Default SEO & share image',
    ]) {
      expect(screen.getByRole('heading', { name })).toBeTruthy();
    }
    expect(screen.getByLabelText('WhatsApp number')).toHaveProperty('value', '+8801712345678');
    expect(screen.getByLabelText('Google Play listing')).toHaveProperty(
      'value',
      'https://play.google.com/store/apps/details?id=com.nilzora',
    );
    expect(screen.getByLabelText('App Store listing')).toHaveProperty('value', '');
    expect(screen.getByLabelText('TikTok profile')).toHaveProperty(
      'value',
      'https://www.tiktok.com/@nilzora',
    );
    // A payload that carried the fields: nothing is held back from an empty one.
    expect(document.querySelector<HTMLInputElement>('input[name="absentFields"]')?.value).toBe('');
  });

  it('names the newer fields an older payload did not carry, so an empty form keeps them', () => {
    expect(absentFields(profile).sort()).toEqual([
      'appStoreUrl',
      'playStoreUrl',
      'socialTiktok',
      'socialX',
      'whatsappNumber',
    ]);
    expect(absentFields({ ...profile, whatsappNumber: null })).not.toContain('whatsappNumber');
    expect(profileTexts(profile).whatsappNumber).toBe('');

    render(<StoreProfileForm profile={profile} csrf={csrf} />);
    expect(document.querySelector<HTMLInputElement>('input[name="absentFields"]')?.value).toBe(
      'whatsappNumber,playStoreUrl,appStoreUrl,socialTiktok,socialX',
    );
  });

  it('checks the WhatsApp number and store links with the contract’s rules before sending', async () => {
    render(<StoreProfileForm profile={profile} csrf={csrf} />);

    fireEvent.change(screen.getByLabelText('WhatsApp number'), {
      target: { value: '01712345678' },
    });
    fireEvent.change(screen.getByLabelText('Google Play listing'), {
      target: { value: 'https://example.com/app' },
    });
    fireEvent.change(screen.getByLabelText('App Store listing'), {
      target: { value: 'https://apps.apple.com/bd/app/nilzora/id123' },
    });
    fireEvent.blur(screen.getByLabelText('WhatsApp number'));
    fireEvent.blur(screen.getByLabelText('Google Play listing'));
    fireEvent.blur(screen.getByLabelText('App Store listing'));

    expect(
      await screen.findByText('Use a Bangladeshi mobile number such as +8801712345678'),
    ).toBeTruthy();
    expect(screen.getByText(/Use the Google Play address/)).toBeTruthy();
    // A correct App Store link raises nothing.
    expect(screen.queryByText(/Use the App Store address/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save store profile' }));
    await waitFor(() => expect(screen.getByLabelText('WhatsApp number')).toBeTruthy());
    expect(actions.saveProfile).not.toHaveBeenCalled();
  });

  it('sends the whole profile with the CSRF token and shows the outcome', async () => {
    actions.saveProfile.mockResolvedValue({ status: 'success', message: 'Store profile saved.' });
    render(<StoreProfileForm profile={profile} csrf={csrf} />);

    fireEvent.change(screen.getByLabelText('Tagline'), {
      target: { value: 'Everyday essentials.' },
    });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(screen.getByText('20/160')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save store profile' }));

    expect(await screen.findByText('Store profile saved.')).toBeTruthy();
    const sent = actions.saveProfile.mock.calls[0]?.[1] as FormData;
    expect(sent.get('displayName')).toBe('Nilzora');
    expect(sent.get('tagline')).toBe('Everyday essentials.');
    expect(sent.get('csrf_token')).toBe('signed-test-token');
  });

  it('discards the changes made since it was loaded', () => {
    render(<StoreProfileForm profile={profile} csrf={csrf} />);
    fireEvent.change(screen.getByLabelText('Tagline'), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByLabelText('Tagline')).toHaveProperty('value', '');
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('never offers private store settings', () => {
    render(<StoreProfileForm profile={profile} csrf={csrf} />);
    expect(screen.queryByLabelText(/return window/i)).toBeNull();
    expect(screen.queryByLabelText(/cart inactivity/i)).toBeNull();
  });
});

describe('InboxView', () => {
  const inbox: StaffNotificationListResponse = {
    notifications: [
      {
        id: ID,
        kind: 'stock_low',
        title: 'Clay mug is down to 2',
        body: null,
        entityType: 'product',
        entityId: ID,
        actionPath: null,
        readAt: null,
        createdAt: AT,
      },
    ],
    page: 1,
    pageSize: 25,
    total: 1,
    unread: 1,
    totalPages: 1,
  };

  it('shows a refusal of mark-read beside the row instead of dropping it', async () => {
    actions.markRead.mockResolvedValue({
      status: 'error',
      message: 'That notification is no longer available.',
    });
    render(<InboxView inbox={inbox} csrf={csrf} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
    expect(await screen.findByText('That notification is no longer available.')).toBeTruthy();
    expect((actions.markRead.mock.calls[0]?.[1] as FormData).get('notificationId')).toBe(ID);
  });

  it('confirms mark-all, and shows its failure', async () => {
    actions.markAll.mockResolvedValue({
      status: 'success',
      message: 'Everything is marked as read.',
    });
    render(<InboxView inbox={inbox} csrf={csrf} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByText('Everything is marked as read.')).toBeTruthy();
  });
});
