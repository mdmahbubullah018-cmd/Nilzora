// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { courierConfig, provider } from './fixtures';
import { ProviderCard, ProvidersView } from './provider-cards';
import { credentialLabel } from './provider-readiness';

const actions = vi.hoisted(() => ({
  saveProvider: vi.fn(),
  check: vi.fn(),
  setCredential: vi.fn(),
  clearCredential: vi.fn(),
  baseUrl: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('@/lib/courier-actions', () => ({
  saveCourierProviderAction: actions.saveProvider,
  checkCourierAction: actions.check,
  setCourierCredentialAction: actions.setCredential,
  clearCourierCredentialAction: actions.clearCredential,
  saveCourierBaseUrlAction: actions.baseUrl,
  setLiveVerificationAction: actions.verify,
}));

// jsdom lacks the modal methods of <dialog>; this mirrors what the Dialog relies on.
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const SECRET = 'sk_live_fixture_secret_9f3a';

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset().mockResolvedValue({ status: 'idle' });
});
afterEach(cleanup);

const readyForVerification = provider({
  readiness: {
    adapterVerified: true,
    credentialsComplete: true,
    baseUrlValid: true,
    liveCheckPassed: true,
    liveVerified: false,
    enabled: false,
    ready: false,
    blockers: ['Verify Steadfast for live use.'],
  },
});

describe('credentials', () => {
  it('never puts a credential value in the page, even after saving one', async () => {
    actions.setCredential.mockResolvedValue({
      status: 'success',
      message: 'Stored encrypted. Steadfast must be verified for live use again.',
    });
    const { container } = render(<ProviderCard provider={provider()} canConfigure csrf={csrf} />);
    const input = screen.getByLabelText('New secret key');
    expect(input.getAttribute('type')).toBe('password');
    expect((input as HTMLInputElement).value).toBe('');
    fireEvent.change(input, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Secret key' }));
    await screen.findByText(/Stored encrypted\. Steadfast must be verified/);
    const sent = actions.setCredential.mock.calls[0]?.[1] as FormData;
    expect(sent.get('value')).toBe(SECRET);
    expect(sent.get('field')).toBe('secretKey');
    // The input is emptied and nothing anywhere in the markup carries the value.
    expect(screen.getByLabelText<HTMLInputElement>('New secret key').value).toBe('');
    expect(container.innerHTML).not.toContain(SECRET);
  });

  it('shows where each credential comes from, never its value', () => {
    render(
      <ProviderCard
        provider={provider({
          credentials: [
            { field: 'apiKey', source: 'vault', setAt: '2026-11-14T10:00:00.000Z' },
            { field: 'secretKey', source: 'environment', setAt: null },
          ],
        })}
        canConfigure
        csrf={csrf}
      />,
    );
    expect(screen.getByTestId('credential-status-apiKey').textContent).toMatch(
      /^Stored encrypted · set 14 Nov 2026/,
    );
    expect(screen.getByTestId('credential-status-secretKey').textContent).toBe(
      'From server environment',
    );
    // Stored values can be replaced or cleared; an environment value only replaced here.
    expect(screen.getByRole('button', { name: 'Replace API key' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Clear API key/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Clear Secret key/ })).toBeNull();
    expect(
      screen.getAllByText(/saving or clearing one removes the courier’s live verification/i).length,
    ).toBe(1);
  });

  it('confirms before clearing a stored credential', async () => {
    render(<ProviderCard provider={provider()} canConfigure csrf={csrf} />);
    fireEvent.click(screen.getByRole('button', { name: /Clear API key/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Clear the stored API key?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear credential' }));
    await waitFor(() => expect(actions.clearCredential).toHaveBeenCalled());
    const sent = actions.clearCredential.mock.calls[0]?.[1] as FormData;
    expect(sent.get('field')).toBe('apiKey');
  });

  it('labels fields in words', () => {
    expect(credentialLabel('apiKey')).toBe('API key');
    expect(credentialLabel('client_id')).toBe('Client ID');
  });
});

describe('readiness and verification', () => {
  it('lists every readiness step and the blockers', () => {
    render(<ProviderCard provider={provider()} canConfigure={false} csrf={csrf} />);
    const list = screen.getByRole('list', { name: 'Live readiness of Steadfast' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    expect(within(list).getByText(/API address valid/).textContent).toMatch(/: done$/);
    expect(within(list).getByText(/Credentials complete/).textContent).toMatch(/: not yet$/);
    expect(screen.getByText('Not ready for live bookings')).toBeTruthy();
    expect(screen.getByText('The secret key is not set.')).toBeTruthy();
  });

  it('says ready only when the API says so', () => {
    render(
      <ProviderCard
        provider={provider({
          readiness: {
            ...readyForVerification.readiness,
            liveVerified: true,
            enabled: true,
            ready: true,
            blockers: [],
          },
        })}
        canConfigure={false}
        csrf={csrf}
      />,
    );
    expect(screen.getByText('Ready for live bookings')).toBeTruthy();
    expect(screen.queryByText('Still missing')).toBeNull();
  });

  it('keeps "Verify for live use" disabled until the checks up to the live check pass', () => {
    render(<ProviderCard provider={provider()} canConfigure csrf={csrf} />);
    expect(screen.getByRole('button', { name: /Verify for live use/ })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('asks for the typed phrase and sends it', async () => {
    render(<ProviderCard provider={readyForVerification} canConfigure csrf={csrf} />);
    fireEvent.click(screen.getByRole('button', { name: /Verify for live use/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Verify Steadfast for live use?' });
    const field = within(dialog).getByLabelText(/to confirm/);
    expect(field.getAttribute('pattern')).toBe('VERIFY STEADFAST');
    fireEvent.change(field, { target: { value: 'VERIFY STEADFAST' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Verify for live use' }));
    await waitFor(() => expect(actions.verify).toHaveBeenCalled());
    const sent = actions.verify.mock.calls[0]?.[1] as FormData;
    expect(sent.get('confirmation')).toBe('VERIFY STEADFAST');
    expect(sent.get('verified')).toBe('true');
  });

  it('confirms before removing a verification', async () => {
    render(
      <ProviderCard
        provider={provider({ liveVerifiedAt: '2026-11-14T10:00:00.000Z' })}
        canConfigure
        csrf={csrf}
      />,
    );
    expect(screen.getByText(/Verified for live use 14 Nov 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Remove verification/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove verification' }));
    await waitFor(() => expect(actions.verify).toHaveBeenCalled());
    expect((actions.verify.mock.calls[0]?.[1] as FormData).get('verified')).toBe('false');
  });
});

describe('ProviderCard access', () => {
  it('shows capabilities awaiting documentation honestly, not as errors', () => {
    render(<ProviderCard provider={provider()} canConfigure={false} csrf={csrf} />);
    const matrix = screen.getByRole('list', { name: 'What Nilzora can do with Steadfast' });
    expect(within(matrix).getAllByText('Awaiting API documentation')).toHaveLength(4);
    expect(within(matrix).getAllByText('Use the courier portal')).toHaveLength(3);
    expect(screen.getByText('Real calls are blocked')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is read-only without couriers.configure', () => {
    const { container } = render(
      <ProviderCard provider={provider()} canConfigure={false} csrf={csrf} />,
    );
    expect(container.querySelector('input')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('1%')).toBeTruthy();
    expect(screen.getByText('https://portal.example.test/api/v1')).toBeTruthy();
    const credentials = screen.getByRole('region', { name: 'Steadfast credentials' });
    expect(within(credentials).getByText('Not set')).toBeTruthy();
  });

  it('lets the owner edit the API address and settings', () => {
    render(<ProviderCard provider={provider()} canConfigure csrf={csrf} />);
    expect(screen.getByLabelText('API base URL')).toHaveProperty(
      'value',
      'https://portal.example.test/api/v1',
    );
    expect(screen.getByRole('button', { name: 'Save Steadfast' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Check connection/ })).toBeTruthy();
  });
});

describe('ProvidersView', () => {
  it('states the courier mode first and links to Courier settings', () => {
    render(<ProvidersView config={courierConfig()} permissions={['couriers.read']} csrf={csrf} />);
    expect(screen.getByText('Test mode — no real parcels')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Courier settings' }).getAttribute('href')).toBe(
      '/admin/operations/settings',
    );
  });
});
