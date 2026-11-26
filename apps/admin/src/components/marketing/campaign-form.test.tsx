// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampaignForm } from './campaign-form';

/*
 * The campaign form's banner field.
 *
 * A campaign's banner is a media-library picture, chosen in place: the form shows what is
 * stored, opens the library (and an upload) over the page so nothing typed is lost, and states
 * the frame the storefront actually uses. These tests are about what an admin sees; the API and
 * its database function re-check every rule.
 */

vi.mock('@/lib/campaign-actions', () => ({ saveCampaignAction: vi.fn() }));

afterEach(cleanup);

function renderForm() {
  return render(
    <CampaignForm
      categories={[]}
      brands={[]}
      products={[]}
      productsTruncated={false}
      csrf={{ name: 'csrf_token', token: 't' }}
    />,
  );
}

describe('a campaign’s customer-facing title', () => {
  it('is optional, and says so', () => {
    renderForm();

    const title = screen.getByLabelText<HTMLInputElement>(/Customer-facing title/);
    // No `required`: a campaign can be presented by its offer and picture alone.
    expect(title.hasAttribute('required')).toBe(false);
    expect(screen.getByText(/Optional\. Shown on the banner and beside the price/)).toBeTruthy();
  });

  it('keeps the internal name required, because it identifies the campaign', () => {
    renderForm();

    expect(screen.getByLabelText<HTMLInputElement>(/Campaign name/).hasAttribute('required')).toBe(
      true,
    );
  });
});

describe('a campaign’s banner', () => {
  it('is chosen from the media library, not typed as a raw key', () => {
    renderForm();

    expect(screen.getByLabelText('Banner picture')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose a picture' })).toBeTruthy();
    // The key is still the field the form posts, so a hand-pasted key keeps working.
    expect(screen.getByLabelText<HTMLInputElement>('Banner picture').name).toBe('bannerImageKey');
  });

  it('states the size, ratio and format limits the picture must meet', () => {
    renderForm();

    // The numbers are the API's own limits, and the 12:5 frame the storefront really draws.
    expect(screen.getByText(/Recommended 1200 × 500 px \(12:5\)/)).toBeTruthy();
    expect(screen.getByText(/JPEG, PNG or WebP/)).toBeTruthy();
    expect(screen.getByText(/up to 5 MB/)).toBeTruthy();
    expect(screen.getByText(/a narrow screen crops the edges/i)).toBeTruthy();
  });
});
