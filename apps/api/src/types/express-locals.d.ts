import type { RequestIdentity } from '../auth/identity';

declare global {
  namespace Express {
    interface Locals {
      /** Correlation id assigned by the requestId middleware. */
      requestId?: string;
      /** Validated request input stored by the validate() middleware. */
      input?: unknown;
      /** Verified caller, set by the authenticate middleware. */
      identity?: RequestIdentity;
      /** Address used for per-client limits, set by the clientAddress middleware. */
      clientIp?: string;
    }
  }
}

export {};
