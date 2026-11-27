import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createRedisClient, RedisUnavailableError } from '../cache/redis-client';

/*
 * The Redis client against a scripted TCP server, so the awkward cases (a reply split across
 * packets, pipelined commands, silence, a dropped connection, a TLS handshake to a plain
 * server) are tested without needing a real Redis. The live behaviour is covered separately
 * in redis-cache.test.ts, which runs when REDIS_URL is set.
 */

const servers: Server[] = [];
const sockets = new Set<Socket>();

afterEach(() => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  for (const server of servers.splice(0)) server.close();
});

/** A server that hands each connection to `onConnection` and remembers it for cleanup. */
async function serve(onConnection: (socket: Socket) => void): Promise<number> {
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
    onConnection(socket);
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

function endpoint(port: number, overrides: Partial<Parameters<typeof createRedisClient>[0]> = {}) {
  return {
    tls: false,
    host: '127.0.0.1',
    port,
    username: undefined,
    password: undefined,
    database: 0,
    ...overrides,
  };
}

describe('Redis client over a fake server', () => {
  it('reads a reply that arrives in two packets', async () => {
    const port = await serve((socket) => {
      socket.on('data', () => {
        // `$11\r\nhello world\r\n`, split mid-payload.
        socket.write('$11\r\nhello ');
        setTimeout(() => socket.write('world\r\n'), 20);
      });
    });
    const client = createRedisClient(endpoint(port));

    await expect(client.get('anything')).resolves.toBe('hello world');
    await client.close();
  });

  it('matches pipelined commands to their own replies, in order', async () => {
    let commands = 0;
    const port = await serve((socket) => {
      socket.on('data', () => {
        commands += 1;
        socket.write(commands === 1 ? '$5\r\nfirst\r\n' : '$6\r\nsecond\r\n');
      });
    });
    const client = createRedisClient(endpoint(port));

    const [first, second] = await Promise.all([client.get('a'), client.get('b')]);

    expect([first, second]).toStrictEqual(['first', 'second']);
    await client.close();
  });

  it('fails fast when the server never answers', async () => {
    const port = await serve(() => {
      // Accept the connection and stay silent.
    });
    const client = createRedisClient(endpoint(port), {
      commandTimeoutMs: 150,
      retryDelayMs: 60_000,
    });

    await expect(client.get('slow')).rejects.toBeInstanceOf(RedisUnavailableError);
    await expect(client.isAvailable()).resolves.toBe(false);
    await client.close();
  });

  it('reports a failed connection instead of hanging', async () => {
    // Nothing listens on this port.
    const client = createRedisClient(endpoint(65_533), {
      commandTimeoutMs: 200,
      retryDelayMs: 60_000,
    });

    await expect(client.get('x')).rejects.toBeInstanceOf(RedisUnavailableError);
    await expect(client.isAvailable()).resolves.toBe(false);
    await client.close();
  });

  it('refuses immediately during the cool-down after a failure', async () => {
    let answered = 0;
    let connections = 0;
    const port = await serve((socket) => {
      connections += 1;
      socket.on('data', () => {
        answered += 1;
        // Answer the first command only; then stay silent so the next one times out.
        if (answered === 1) socket.write('$2\r\nok\r\n');
      });
    });

    const client = createRedisClient(endpoint(port), {
      commandTimeoutMs: 120,
      retryDelayMs: 60_000,
    });

    await expect(client.get('one')).resolves.toBe('ok');
    await expect(client.get('two')).rejects.toBeInstanceOf(RedisUnavailableError);

    // Inside the cool-down no new socket is opened: the failure is reported at once.
    await expect(client.get('three')).rejects.toThrow(/waiting before the next attempt/);
    expect(connections).toBe(1);
    await client.close();
  });

  it('survives a TLS handshake that the server cannot complete', async () => {
    // A plain TCP server cannot answer a TLS ClientHello, so the handshake fails.
    const port = await serve((socket) => {
      socket.on('data', () => socket.destroy());
    });
    const client = createRedisClient(endpoint(port, { tls: true }), {
      commandTimeoutMs: 300,
      retryDelayMs: 60_000,
    });

    await expect(client.get('x')).rejects.toBeInstanceOf(RedisUnavailableError);
    await client.close();
  });

  it('rejects commands after close, and close is safe twice', async () => {
    const port = await serve((socket) => {
      socket.on('data', () => socket.write('+PONG\r\n'));
    });
    const client = createRedisClient(endpoint(port));

    await expect(client.ping()).resolves.toBe(true);
    await client.close();
    await client.close();

    await expect(client.get('x')).rejects.toBeInstanceOf(RedisUnavailableError);
  });

  it('never reports the password in connect events', async () => {
    const events: string[] = [];
    const client = createRedisClient(endpoint(65_533, { tls: false, password: 'super-secret' }), {
      commandTimeoutMs: 200,
      retryDelayMs: 60_000,
      onEvent: (event, detail) => {
        events.push(`${event}: ${detail}`);
      },
    });

    await expect(client.get('x')).rejects.toBeInstanceOf(RedisUnavailableError);
    await client.close();

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(event).not.toContain('super-secret');
  });

  it('sends AUTH before the first command when the URL has credentials', async () => {
    const received: string[] = [];
    const port = await serve((socket) => {
      socket.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        received.push(text);
        if (text.startsWith('*2\r\n$4\r\nAUTH')) socket.write('+OK\r\n');
        else socket.write('$3\r\nval\r\n');
      });
    });
    const client = createRedisClient(endpoint(port, { password: 'pw' }));

    await expect(client.get('k')).resolves.toBe('val');
    expect(received[0]).toContain('AUTH');
    expect(received[0]).toContain('pw');
    await client.close();
  });
});
