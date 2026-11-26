import type { PublicStoreProfile } from '@nilzora/contracts';
import { FAQ_ENTRIES, FAQ_SUMMARY, FAQ_TITLE } from '@nilzora/contracts';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FaqPage from './page';

const seo = vi.hoisted(() => ({
  storeProfile: vi.fn(),
  siteUrl: () => new URL('https://shop.example.test'),
}));
vi.mock('@/lib/seo', () => seo);

afterEach(() => {
  vi.clearAllMocks();
});

function profile(overrides: Partial<PublicStoreProfile> = {}): PublicStoreProfile {
  return {
    displayName: 'Nilzora',
    tagline: null,
    description: null,
    logoKey: null,
    logoUrl: null,
    codAvailable: true,
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
    updatedAt: '2026-11-06T09:00:00.000Z',
    ...overrides,
  };
}

async function renderPage() {
  seo.storeProfile.mockResolvedValue(profile());
  return render(await FaqPage());
}

const search = () => screen.getByLabelText('Search the questions');

describe('FaqPage', () => {
  it('answers the shared questions, each folded into an accordion', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(FAQ_TITLE);
    expect(screen.getByText(FAQ_SUMMARY)).not.toBeNull();
    for (const entry of FAQ_ENTRIES) {
      expect(screen.getByText(entry.question)).not.toBeNull();
    }
    // A native <details> element per question: keyboard operable and works without JavaScript.
    expect(document.querySelectorAll('details')).toHaveLength(FAQ_ENTRIES.length);
  });

  it('filters the questions as the customer types, and opens the answers', async () => {
    await renderPage();
    fireEvent.change(search(), { target: { value: 'bKash' } });

    expect(screen.getByText('Do you take cards, bKash or Nagad?')).not.toBeNull();
    expect(screen.queryByText('How do I place an order?')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('1 question');

    const shown = document.querySelector('details');
    expect(shown?.hasAttribute('open')).toBe(true);
  });

  it('narrows to one topic at a time', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Payment' }));

    const payment = screen.getByRole('heading', { name: 'Payment' }).closest('section');
    expect(payment).not.toBeNull();
    expect(within(payment as HTMLElement).getByText('How can I pay for my order?')).not.toBeNull();
    expect(screen.queryByText('How do I place an order?')).toBeNull();
    // Pressing the same topic again returns to everything.
    fireEvent.click(screen.getByRole('button', { name: 'Payment' }));
    expect(screen.getByText('How do I place an order?')).not.toBeNull();
  });

  it('says plainly when nothing matches, and offers a person instead', async () => {
    await renderPage();
    fireEvent.change(search(), { target: { value: 'helicopter' } });

    expect(screen.getByText('No questions match')).not.toBeNull();
    expect(screen.getByText(/Nothing matches/)).not.toBeNull();
    expect(
      screen
        .getByRole('link', { name: 'Ask the store through Help & support' })
        .getAttribute('href'),
    ).toBe('/contact');
  });

  it('does not answer a question the store has not decided', async () => {
    await renderPage();
    const text = document.body.textContent ?? '';

    expect(text).not.toMatch(/free delivery|delivered in \d+|money back guarantee/i);
    expect(text).not.toMatch(/\d{2,} (taka|৳) delivery/i);
  });
});
