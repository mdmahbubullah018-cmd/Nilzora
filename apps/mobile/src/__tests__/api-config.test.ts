import {
  configuredApiAddress,
  devServerHost,
  parseApiBaseUrl,
  resolveDevApiAddress,
} from '../auth/api';

/** What Expo reports as the host the app was loaded from; tests set it per case. */
let mockHostUri: string | undefined;

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockHostUri === undefined ? null : { hostUri: mockHostUri };
    },
  },
}));

describe('parseApiBaseUrl', () => {
  const dev = { allowHttp: true };
  const release = { allowHttp: false };

  it('accepts a LAN address in development and drops trailing slashes', () => {
    expect(parseApiBaseUrl('http://192.168.0.10:4000/', dev)).toEqual({
      ok: true,
      baseUrl: 'http://192.168.0.10:4000',
    });
  });

  it('accepts https everywhere', () => {
    expect(parseApiBaseUrl(' https://api.example.test ', release)).toEqual({
      ok: true,
      baseUrl: 'https://api.example.test',
    });
  });

  it('requires https in release builds', () => {
    expect(parseApiBaseUrl('http://192.168.0.10:4000', release)).toEqual({
      ok: false,
      problem: 'insecure',
    });
  });

  it.each([undefined, '', '   '])('reports a missing value (%p)', (value) => {
    expect(parseApiBaseUrl(value, dev)).toEqual({ ok: false, problem: 'missing' });
  });

  it.each([
    'localhost:4000',
    'ftp://example.test',
    'http://user:pass@example.test',
    'https://example.test/?token=1',
    'https://example.test/#x',
    'javascript:alert(1)',
  ])('rejects %p', (value) => {
    expect(parseApiBaseUrl(value, dev)).toEqual({ ok: false, problem: 'invalid' });
  });
});

describe('development API address on a phone', () => {
  it('reads the computer the phone reached for the bundle', () => {
    expect(devServerHost('192.168.1.20:8081')).toBe('192.168.1.20');
    expect(devServerHost('10.0.2.2:8081')).toBe('10.0.2.2');
    // Unknown, loopback or a tunnel: nothing a phone could use for a local API port.
    expect(devServerHost(undefined)).toBeNull();
    expect(devServerHost('localhost:8081')).toBeNull();
    expect(devServerHost('abc-anonymous-8081.exp.direct')).toBeNull();
    expect(devServerHost('bad host:8081')).toBeNull();
  });

  it('points a loopback API address at that computer, keeping scheme, port and path', () => {
    expect(resolveDevApiAddress('http://localhost:4000', '192.168.1.20')).toBe(
      'http://192.168.1.20:4000',
    );
    expect(resolveDevApiAddress('http://127.0.0.1:4000/base', '192.168.1.20')).toBe(
      'http://192.168.1.20:4000/base',
    );
  });

  it('uses any other address exactly as written', () => {
    expect(resolveDevApiAddress('http://192.168.0.10:4000', '192.168.1.20')).toBe(
      'http://192.168.0.10:4000',
    );
    expect(resolveDevApiAddress('https://api.example.test', '192.168.1.20')).toBe(
      'https://api.example.test',
    );
    expect(resolveDevApiAddress('http://localhost:4000', null)).toBe('http://localhost:4000');
  });
});

describe('the address a development build really uses', () => {
  const original = process.env.EXPO_PUBLIC_API_BASE_URL;

  afterEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = original;
    mockHostUri = undefined;
  });

  it('follows the computer the phone loaded the app from, when the address says localhost', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://localhost:4000';
    mockHostUri = '192.168.0.191:8081';
    expect(configuredApiAddress()).toEqual({ ok: true, baseUrl: 'http://192.168.0.191:4000' });
  });

  it('uses a written LAN address exactly as written, even a stale one', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://192.168.0.146:4000';
    mockHostUri = '192.168.0.191:8081';
    // The app cannot tell that 192.168.0.146 no longer belongs to the computer: it is the
    // owner's setting, and rewriting it would hide a mistake rather than fix it.
    expect(configuredApiAddress()).toEqual({ ok: true, baseUrl: 'http://192.168.0.146:4000' });
  });

  it('keeps localhost when the app was not loaded from a computer on the network', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://localhost:4000';
    for (const uri of [undefined, 'localhost:8081', '127.0.0.1:8081', 'abc-8081.exp.direct']) {
      mockHostUri = uri;
      expect(configuredApiAddress()).toEqual({ ok: true, baseUrl: 'http://localhost:4000' });
    }
  });

  it('reports a missing or malformed address instead of guessing one', () => {
    mockHostUri = '192.168.0.191:8081';
    process.env.EXPO_PUBLIC_API_BASE_URL = '';
    expect(configuredApiAddress()).toEqual({ ok: false, problem: 'missing' });
    process.env.EXPO_PUBLIC_API_BASE_URL = 'not a url';
    expect(configuredApiAddress()).toEqual({ ok: false, problem: 'invalid' });
  });
});
