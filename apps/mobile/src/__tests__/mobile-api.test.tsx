import * as ApiClientModule from '@nilzora/api-client';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ApiProvider, useApi } from '../api/api-context';
import { getMobileApi, resetMobileApi } from '../auth/api';
import { SessionProvider } from '../auth/session-context';
import { secureTokenStore } from '../auth/token-store';
import { createFakeApiClient } from '../test-utils/api-fakes';

jest.mock('@nilzora/api-client', () => {
  const actual = jest.requireActual<typeof ApiClientModule>('@nilzora/api-client');
  return { ...actual, createApiClient: jest.fn(actual.createApiClient) };
});

const createApiClient = jest.mocked(ApiClientModule.createApiClient);
const ADDRESS = 'EXPO_PUBLIC_API_BASE_URL';
let originalAddress: string | undefined;
let warn: jest.SpyInstance;
let load: jest.SpyInstance;

beforeEach(() => {
  originalAddress = process.env[ADDRESS];
  process.env[ADDRESS] = 'http://192.168.0.10:4000';
  resetMobileApi();
  createApiClient.mockClear();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  load = jest.spyOn(secureTokenStore, 'load').mockResolvedValue(null);
});

afterEach(() => {
  if (originalAddress === undefined) delete process.env[ADDRESS];
  else process.env[ADDRESS] = originalAddress;
  resetMobileApi();
  warn.mockRestore();
  load.mockRestore();
});

function ApiProbe() {
  const api = useApi();
  return <Text>{api === null ? 'no api' : 'has api'}</Text>;
}

describe('getMobileApi', () => {
  it('builds the client once and hands every caller the same one', () => {
    const first = getMobileApi();
    const second = getMobileApi();

    expect(first.ok).toBe(true);
    expect(second).toBe(first);
    expect(createApiClient).toHaveBeenCalledTimes(1);
    expect(createApiClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://192.168.0.10:4000' }),
    );
  });

  it('remembers a missing address too, until it is reset', () => {
    delete process.env[ADDRESS];

    expect(getMobileApi()).toEqual({ ok: false, problem: 'missing' });
    process.env[ADDRESS] = 'http://192.168.0.10:4000';
    expect(getMobileApi()).toEqual({ ok: false, problem: 'missing' });

    resetMobileApi();
    expect(getMobileApi().ok).toBe(true);
  });

  it('is shared by the session manager and the ApiProvider', async () => {
    await render(
      <SessionProvider>
        <ApiProvider>
          <ApiProbe />
        </ApiProvider>
      </SessionProvider>,
    );

    expect(screen.getByText('has api')).toBeOnTheScreen();
    expect(createApiClient).toHaveBeenCalledTimes(1);
  });
});

describe('ApiProvider and useApi', () => {
  it('gives null, not a crash, when the build has no API address', async () => {
    delete process.env[ADDRESS];

    await render(
      <ApiProvider>
        <ApiProbe />
      </ApiProvider>,
    );

    expect(screen.getByText('no api')).toBeOnTheScreen();
    expect(createApiClient).not.toHaveBeenCalled();
  });

  it('uses an injected client, or an injected null', async () => {
    const { rerender } = await render(
      <ApiProvider api={createFakeApiClient()}>
        <ApiProbe />
      </ApiProvider>,
    );
    expect(screen.getByText('has api')).toBeOnTheScreen();
    expect(createApiClient).not.toHaveBeenCalled();

    await rerender(
      <ApiProvider api={null}>
        <ApiProbe />
      </ApiProvider>,
    );
    expect(screen.getByText('no api')).toBeOnTheScreen();
  });

  it('refuses to be used without a provider', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(render(<ApiProbe />)).rejects.toThrow(
      'useApi() must be used inside <ApiProvider>',
    );
    error.mockRestore();
  });
});
