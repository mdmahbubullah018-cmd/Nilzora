import {
  FAQ_ENTRIES,
  INFO_PAGES,
  INFO_PAGES_UPDATED_ON,
  type PublicStoreProfile,
} from '@nilzora/contracts';
import { act, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import AboutScreen from '../../app/about';
import FaqRoute from '../../app/faq';
import PrivacyScreen from '../../app/privacy';
import TermsScreen from '../../app/terms';
import { formatDate } from '../lib/dates';
import { createFakeApiClient, fakeStoreProfile, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

/*
 * The four information screens. The wording is shared with the storefront, so these tests check
 * that the screens show it, that the FAQ is searchable and expandable, and that contact details
 * only ever come from the store's published profile.
 */


function infoApi(profile: PublicStoreProfile | null = fakeStoreProfile()): FakeApiClient {
  const api = createFakeApiClient();
  if (profile === null) {
    api.publicStoreProfile.mockReturnValue(new Promise(() => undefined));
  } else {
    api.publicStoreProfile.mockResolvedValue({ profile });
  }
  return api;
}

beforeEach(() => {
  resetRouterMock();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Lets the store-profile query settle, so a test never ends mid-update. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('AboutScreen', () => {
  it('shows the shared introduction, and the published tagline when there is one', async () => {
    const api = infoApi(fakeStoreProfile({ tagline: 'Everyday essentials, delivered.' }));
    await renderWithProviders(<AboutScreen />, { api });

    expect(await screen.findByText('Everyday essentials, delivered.')).toBeOnTheScreen();
    expect(screen.getByText(INFO_PAGES.about.summary)).toBeOnTheScreen();
    for (const section of INFO_PAGES.about.sections) {
      expect(screen.getByRole('header', { name: section.heading })).toBeOnTheScreen();
    }
    // The About page has no "last updated" date: it is not a policy.
    expect(screen.queryByText(/Last updated/)).not.toBeOnTheScreen();
  });

  it('leaves the tagline out rather than inventing one', async () => {
    await renderWithProviders(<AboutScreen />, { api: infoApi() });

    expect(await screen.findByText(INFO_PAGES.about.summary)).toBeOnTheScreen();
    await settle();
    expect(screen.queryByText('Everyday essentials, delivered.')).not.toBeOnTheScreen();
  });
});

describe('PrivacyScreen', () => {
  it('shows every shared section and when it was last updated', async () => {
    await renderWithProviders(<PrivacyScreen />, { api: infoApi() });

    expect(
      await screen.findByText(`Last updated ${formatDate(INFO_PAGES_UPDATED_ON)}`),
    ).toBeOnTheScreen();
    for (const section of INFO_PAGES.privacy.sections) {
      expect(screen.getByRole('header', { name: section.heading })).toBeOnTheScreen();
    }
    await settle();
  });

  it('adds the contact details the store published', async () => {
    const api = infoApi(
      fakeStoreProfile({ supportEmail: 'help@nilzora.test', supportPhone: '+880 1712 345678' }),
    );
    await renderWithProviders(<PrivacyScreen />, { api });

    expect(await screen.findByText('Contacting Nilzora')).toBeOnTheScreen();
    expect(screen.getByText('Email: help@nilzora.test')).toBeOnTheScreen();
    expect(screen.getByText('Phone: +880 1712 345678')).toBeOnTheScreen();
  });

  it('shows no contact section at all while the profile is still unknown', async () => {
    await renderWithProviders(<PrivacyScreen />, { api: infoApi(null) });

    expect(screen.getByText(INFO_PAGES.privacy.summary)).toBeOnTheScreen();
    expect(screen.queryByText('Contacting Nilzora')).not.toBeOnTheScreen();
  });

  it('says the details could not be read when the store cannot be reached', async () => {
    const api = createFakeApiClient();
    api.publicStoreProfile.mockRejectedValue(new Error('offline'));
    await renderWithProviders(<PrivacyScreen />, { api });

    expect(await screen.findByText('Contacting Nilzora')).toBeOnTheScreen();
    expect(screen.getByText(/could not be read just now/)).toBeOnTheScreen();
  });
});

describe('TermsScreen', () => {
  it('shows the shared terms and the store’s published contact details', async () => {
    const api = infoApi(fakeStoreProfile({ supportEmail: 'help@nilzora.test' }));
    await renderWithProviders(<TermsScreen />, { api });

    for (const section of INFO_PAGES.terms.sections) {
      expect(screen.getByRole('header', { name: section.heading })).toBeOnTheScreen();
    }
    expect(await screen.findByText('Email: help@nilzora.test')).toBeOnTheScreen();
  });

  it('says nothing about jurisdiction, fees or a warranty the store has not agreed', async () => {
    await renderWithProviders(<TermsScreen />, { api: infoApi() });
    await settle();
    const text = JSON.stringify(screen.toJSON());

    expect(text).not.toMatch(/jurisdiction|arbitration|governing law/i);
    expect(text).not.toMatch(/restocking fee|handling fee|processing fee/i);
  });
});

describe('FaqScreen', () => {
  const search = () => screen.getByLabelText('Search the questions');

  it('lists every question, folded until it is opened', async () => {
    const { user } = await renderWithProviders(<FaqRoute />, { api: infoApi() });

    expect(await screen.findByText(FAQ_ENTRIES[0]?.question ?? '')).toBeOnTheScreen();
    const first = FAQ_ENTRIES[0];
    if (first === undefined) throw new Error('the FAQ is empty');
    expect(screen.queryByText(first.answer)).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: first.question })).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: first.question }));
    expect(screen.getByText(first.answer)).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: first.question }));
    expect(screen.queryByText(first.answer)).not.toBeOnTheScreen();
  });

  it('searches the questions and shows the answers that matched', async () => {
    const { user } = await renderWithProviders(<FaqRoute />, { api: infoApi() });

    await user.type(search(), 'bKash');

    expect(screen.getByText('Do you take cards, bKash or Nagad?')).toBeOnTheScreen();
    expect(screen.queryByText('How do I place an order?')).not.toBeOnTheScreen();
    expect(
      screen.getByText(
        'Not today. Nilzora does not ask for card or mobile-wallet details anywhere on the website or in the app, and keeps none on your account.',
      ),
    ).toBeOnTheScreen();
  });

  it('filters by topic', async () => {
    const { user } = await renderWithProviders(<FaqRoute />, { api: infoApi() });

    await user.press(screen.getByRole('button', { name: 'Payment' }));

    expect(screen.getByRole('header', { name: 'Payment' })).toBeOnTheScreen();
    expect(screen.queryByText('How do I place an order?')).not.toBeOnTheScreen();
    expect(screen.queryByText('How do I return something?')).not.toBeOnTheScreen();
  });

  it('says so when nothing matches and offers a person instead', async () => {
    const { user } = await renderWithProviders(<FaqRoute />, { api: infoApi() });

    await user.type(search(), 'helicopter');

    expect(screen.getByText('No questions match')).toBeOnTheScreen();
    expect(screen.getByText('Nothing matches that search')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Open Help & support' }));
    expect(router.push).toHaveBeenCalledWith('/support');
  });

  it('does not promise a delivery time, a refund deadline or a fee', async () => {
    await renderWithProviders(<FaqRoute />, { api: infoApi() });
    const text = JSON.stringify(screen.toJSON());

    expect(text).not.toMatch(/free delivery|delivered in \d+|money back guarantee/i);
    expect(text).not.toMatch(/\bwithin \d+ (business )?days?\b/i);
  });
});
