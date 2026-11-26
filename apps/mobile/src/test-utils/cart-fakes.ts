import type { CartStorage } from '@/cart/cart-store';

/*
 * Cart test doubles. Not imported by the app, so never bundled.
 */

export interface MemoryCartStorage extends CartStorage {
  getItem: jest.Mock<Promise<string | null>, [string]>;
  setItem: jest.Mock<Promise<void>, [string, string]>;
  removeItem: jest.Mock<Promise<void>, [string]>;
  /** What is saved under `key` right now. */
  read: (key: string) => string | null;
}

/** In-memory storage. `initial` maps keys to saved text. */
export function createMemoryCartStorage(initial: Record<string, string> = {}): MemoryCartStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: jest.fn((key: string) => Promise.resolve(data.get(key) ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      data.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      data.delete(key);
      return Promise.resolve();
    }),
    read: (key) => data.get(key) ?? null,
  };
}

/** Valid product ids for tests (RFC 4122 UUIDs, as the API requires). */
export const PRODUCT_A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
export const PRODUCT_B = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
export const PRODUCT_C = '7c9e6679-7425-40de-944b-e07fc1f90ae8';
