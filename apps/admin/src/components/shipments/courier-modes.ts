import type { CourierMode } from '@nilzora/contracts';

/*
 * Courier mode copy shared by the server-rendered settings summary and the client form.
 * Plain module on purpose: constants exported from a 'use client' file are client
 * references on the server, not the arrays and strings they look like.
 */

export const MODE_CHOICES: readonly { value: CourierMode; label: string; description: string }[] = [
  {
    value: 'off',
    label: 'Off',
    description:
      'Nilzora never calls a courier. Staff book in the courier portals and record each consignment on the order.',
  },
  {
    value: 'mock',
    label: 'Test (mock)',
    description:
      'A built-in test courier answers every quote and booking. No real parcel is created; test shipments are flagged and left out of totals.',
  },
  {
    value: 'live',
    label: 'Live',
    description:
      'Calls the real Steadfast and Pathao APIs, only for couriers whose API is verified, enabled and ready. Real bookings also need the switch below.',
  },
];

export const MOCK_REFUSED_REASON =
  'This API uses a hosted database; test mode only runs against a local database.';
