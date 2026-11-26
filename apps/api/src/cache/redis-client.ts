import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

/**
 * The four Redis commands Nilzora uses, and nothing else. A whole client library is more
 * surface than this project needs, and one shared socket with commands run one at a time is
 * exactly what a cache-aside layer wants; swapping in `redis`/`ioredis` later only means
 * replacing this file, because everything else depends on `KeyValueStore`.
 */
export interface KeyValueStore {
  /** The stored string, or null when the key is absent. */
  get(key: string): Promise<string | null>;
  /** Stores a string for `ttlSeconds`, replacing any previous value. */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Removes the given keys; returns how many existed. */
  del(keys: readonly string[]): Promise<number>;
  /**
   * Adds one to a counter and answers the new value, setting the key's expiry on the first
   * increment. Atomic on the server (`INCR` + `EXPIRE`), which is what makes it usable for a
   * rate limit shared between API instances.
   */
  increment(key: string, ttlSeconds: number): Promise<number>;
  /** True when the server answered PING. */
  ping(): Promise<boolean>;
  /** Closes the connection; further commands refuse. */
  close(): Promise<void>;
}

/** Redis is not reachable right now: callers fall back to the database. */
export class RedisUnavailableError extends Error {
  override readonly name = 'RedisUnavailableError';

  constructor(reason: string) {
    super(`Redis is not available: ${reason}`);
  }
}

export interface RedisEndpoint {
  tls: boolean;
  host: string;
  port: number;
  username: string | undefined;
  password: string | undefined;
  database: number;
}

export interface RedisClientOptions {
  /** A command that has not answered by then fails, so a request never hangs on Redis. */
  commandTimeoutMs?: number;
  /** After a failed connection, wait this long before trying again (no reconnect storm). */
  retryDelayMs?: number;
  /** Reports connect/close events; never given the URL or credentials. */
  onEvent?: (event: 'connected' | 'closed' | 'unavailable', detail: string) => void;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 2_000;
const DEFAULT_RETRY_DELAY_MS = 5_000;

type Reply = string | number | null | Reply[];

/** A server error reply (`-ERR ...`). */
class ReplyError extends Error {}

function encodeCommand(args: readonly string[]): string {
  let out = `*${args.length}\r\n`;
  for (const arg of args) out += `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`;
  return out;
}

/** Reads one reply from the front of `buffer`; null when it is not complete yet. */
function parseReply(buffer: Buffer<ArrayBufferLike>): { reply: Reply; rest: Buffer<ArrayBufferLike> } | null {
  if (buffer.length === 0) return null;
  const marker = String.fromCharCode(buffer[0] ?? 0);
  const lineEnd = buffer.indexOf('\r\n');
  if (lineEnd < 0) return null;
  const line = buffer.subarray(1, lineEnd).toString('utf8');
  const rest = buffer.subarray(lineEnd + 2);

  if (marker === '+') return { reply: line, rest };
  if (marker === '-') return { reply: new ReplyError(line) as unknown as Reply, rest };
  if (marker === ':') return { reply: Number(line), rest };

  if (marker === '$') {
    const length = Number(line);
    if (length < 0) return { reply: null, rest };
    if (rest.length < length + 2) return null;
    return { reply: rest.subarray(0, length).toString('utf8'), rest: rest.subarray(length + 2) };
  }

  if (marker === '*') {
    const count = Number(line);
    if (count < 0) return { reply: null, rest };
    const items: Reply[] = [];
    let tail = rest;
    for (let index = 0; index < count; index += 1) {
      const parsed = parseReply(tail);
      if (parsed === null) return null;
      items.push(parsed.reply);
      tail = parsed.rest;
    }
    return { reply: items, rest: tail };
  }

  return { reply: new ReplyError(`unexpected reply marker ${marker}`) as unknown as Reply, rest };
}

export interface RedisClient extends KeyValueStore {
  /** Resolves true when a PING answered; never throws. */
  readonly isAvailable: () => Promise<boolean>;
}

/**
 * One lazily connected socket for the whole process. Commands are serialised, so a reply can
 * never be read for the wrong command; a failed command closes the socket instead of queueing,
 * which keeps a Redis outage from building an unbounded backlog of pending work.
 */
export function createRedisClient(
  endpoint: RedisEndpoint,
  options: RedisClientOptions = {},
): RedisClient {
  const commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const report = options.onEvent ?? ((): void => undefined);

  let socket: Socket | null = null;
  let connecting: Promise<void> | null = null;
  let lastFailureAt = 0;
  let closed = false;
  let inbound: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let waiting: {
    resolve: (reply: Reply) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  let serial: Promise<unknown> = Promise.resolve();

  function settle(reply: Reply): void {
    if (waiting === null) return;
    const { resolve, reject, timer } = waiting;
    waiting = null;
    clearTimeout(timer);
    if (reply instanceof ReplyError) reject(reply);
    else resolve(reply);
  }

  function fail(reason: string): void {
    lastFailureAt = Date.now();
    const current = socket;
    socket = null;
    inbound = Buffer.alloc(0);
    current?.destroy();
    if (waiting !== null) {
      const { reject, timer } = waiting;
      waiting = null;
      clearTimeout(timer);
      reject(new RedisUnavailableError(reason));
    }
    report('closed', reason);
  }

  function onData(chunk: Buffer): void {
    inbound = Buffer.concat([inbound, chunk]);
    for (;;) {
      const parsed = parseReply(inbound);
      if (parsed === null) return;
      inbound = parsed.rest;
      settle(parsed.reply);
    }
  }

  /** Writes one command and waits for its reply. The socket must already be connected. */
  function send(args: readonly string[]): Promise<Reply> {
    const current = socket;
    if (current === null) return Promise.reject(new RedisUnavailableError('not connected'));
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        fail('command timed out');
      }, commandTimeoutMs);
      timer.unref?.();
      waiting = { resolve, reject, timer };
      current.write(encodeCommand(args));
    });
  }

  async function connect(): Promise<void> {
    if (closed) throw new RedisUnavailableError('client closed');
    if (socket !== null) return;
    if (Date.now() - lastFailureAt < retryDelayMs) {
      throw new RedisUnavailableError('waiting before the next attempt');
    }

    const next = await new Promise<Socket>((resolve, reject) => {
      const created = endpoint.tls
        ? tlsConnect({ host: endpoint.host, port: endpoint.port, servername: endpoint.host })
        : netConnect({ host: endpoint.host, port: endpoint.port });
      const timer = setTimeout(() => {
        created.destroy();
        reject(new Error('connect timed out'));
      }, commandTimeoutMs);
      const ready = (): void => {
        clearTimeout(timer);
        resolve(created);
      };
      created.once(endpoint.tls ? 'secureConnect' : 'connect', ready);
      created.once('error', (error: Error) => {
        clearTimeout(timer);
        created.destroy();
        reject(error);
      });
    }).catch((error: Error) => {
      lastFailureAt = Date.now();
      report('unavailable', error.message);
      throw new RedisUnavailableError(error.message);
    });

    socket = next;
    inbound = Buffer.alloc(0);
    next.on('data', onData);
    next.on('error', (error: Error) => {
      fail(error.message);
    });
    next.on('close', () => {
      if (socket === next) fail('connection closed');
    });

    try {
      if (endpoint.password !== undefined) {
        await send(
          endpoint.username === undefined
            ? ['AUTH', endpoint.password]
            : ['AUTH', endpoint.username, endpoint.password],
        );
      }
      if (endpoint.database !== 0) await send(['SELECT', String(endpoint.database)]);
    } catch (error) {
      fail(error instanceof Error ? error.message : 'handshake failed');
      throw new RedisUnavailableError('authentication failed');
    }
    report('connected', 'ready');
  }

  async function ensureConnected(): Promise<void> {
    if (socket !== null) return;
    connecting ??= connect().finally(() => {
      connecting = null;
    });
    return connecting;
  }

  async function command(args: readonly string[]): Promise<Reply> {
    await ensureConnected();
    return send(args);
  }

  /** Commands run one at a time, so replies cannot be matched to the wrong caller. */
  function queue<T>(run: () => Promise<T>): Promise<T> {
    const result = serial.then(run, run);
    serial = result.catch(() => undefined);
    return result;
  }

  return {
    get: (key) =>
      queue(async () => {
        const reply = await command(['GET', key]);
        return typeof reply === 'string' ? reply : null;
      }),
    set: (key, value, ttlSeconds) =>
      queue(async () => {
        await command(['SET', key, value, 'EX', String(Math.max(1, Math.floor(ttlSeconds)))]);
        return undefined;
      }),
    del: (keys) =>
      queue(async () => {
        if (keys.length === 0) return 0;
        const reply = await command(['DEL', ...keys]);
        return typeof reply === 'number' ? reply : 0;
      }),
    increment: (key, ttlSeconds) =>
      queue(async () => {
        const count = await command(['INCR', key]);
        // In Redis a fresh counter has no expiry, so the first increment is what arms it. A
        // second EXPIRE on a counter that already has one is harmless.
        if (typeof count === 'number' && count === 1) {
          await command(['EXPIRE', key, String(Math.max(1, Math.floor(ttlSeconds)))]);
        }
        return typeof count === 'number' ? count : 0;
      }),
    ping: () =>
      queue(async () => {
        const reply = await command(['PING']);
        return reply === 'PONG';
      }),
    isAvailable: async () => {
      try {
        return await queue(async () => (await command(['PING'])) === 'PONG');
      } catch {
        return false;
      }
    },
    close: () => {
      closed = true;
      const current = socket;
      socket = null;
      if (current !== null) {
        current.removeAllListeners();
        current.destroy();
        report('closed', 'client closed');
      }
      return Promise.resolve();
    },
  };
}
