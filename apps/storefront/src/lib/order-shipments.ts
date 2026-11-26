import 'server-only';
import type { CustomerShipment } from '@nilzora/contracts';
import { readAccount } from '@/lib/account-read';

/**
 * The signed-in customer's own courier shipments of one order, or null when they could not
 * be read. The API answers only for the caller's own order and only shipments a courier
 * accepted. Tracking is extra on the pages that show it: an outage, a refusal or an
 * unexpected answer leaves the page without tracking rather than breaking it.
 */
export async function readOrderShipments(
  orderNumber: string,
): Promise<readonly CustomerShipment[] | null> {
  try {
    const read = await readAccount((api, accessToken) =>
      api.myOrderShipments(accessToken, orderNumber),
    );
    return read.kind === 'ok' ? read.value.shipments : null;
  } catch (error) {
    // readAccount already logged API refusals; this is anything else. No message text.
    console.error('[nilzora] shipment read failed', {
      error: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}
