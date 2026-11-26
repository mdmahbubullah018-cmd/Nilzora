'use client';

import { DOMAIN_EVENT_SOCKET_EVENT, type DomainEvent } from '@nilzora/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { apiGet } from '@/components/communication/client';
import { useTx } from '@/lib/i18n/provider';

/*
 * Live workspace updates
 * ----------------------
 * Staff hear about new orders, order changes and new staff notifications (low stock, returns,
 * reviews to moderate, assignments) the moment they are committed, without polling. The socket
 * joins only the rooms the server derives from the account's permissions; nothing here chooses
 * a room.
 *
 * An event is only a hint: the page is re-rendered on the server (router.refresh), which re-reads
 * the bell, the badges and the open list through the authorised API. The same re-read happens
 * after a reconnect, so anything missed while offline is shown too. Bursts are coalesced into one
 * refresh.
 */

interface Ticket {
  ticket: string;
  expiresAt: number;
  url: string;
}

const STAFF_EVENTS = new Set(['order.placed', 'staff_notification.created', 'return.requested']);
const REFRESH_DELAY_MS = 1_200;

export function LiveWorkspaceEvents() {
  const router = useRouter();
  const tx = useTx();
  const [announcement, setAnnouncement] = useState('');
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    let socket: Socket | null = null;
    let pending: ReturnType<typeof setTimeout> | null = null;
    let lastSeq = 0;
    let connectedOnce = false;

    const refreshSoon = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        routerRef.current.refresh();
      }, REFRESH_DELAY_MS);
    };

    void (async () => {
      const first = await apiGet<Ticket>('?op=ticket');
      if (cancelled || !first.ok) return;
      let unused: string | null = first.value.ticket;
      socket = io(first.value.url, {
        auth: (callback) => {
          if (unused !== null) {
            callback({ ticket: unused });
            unused = null;
            return;
          }
          void apiGet<Ticket>('?op=ticket').then((next) => {
            callback({ ticket: next.ok ? next.value.ticket : '' });
          });
        },
        transports: ['websocket', 'polling'],
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 30_000,
        randomizationFactor: 0.5,
      });
      socket.on('connect', () => {
        // Back after a gap: re-read the page so nothing that happened meanwhile is missed.
        if (connectedOnce) refreshSoon();
        connectedOnce = true;
      });
      socket.on(DOMAIN_EVENT_SOCKET_EVENT, (event: DomainEvent) => {
        if (event.seq <= lastSeq) return; // a repeated delivery
        lastSeq = event.seq;
        if (event.type === 'order.placed') {
          const number =
            typeof event.payload.orderNumber === 'string' ? event.payload.orderNumber : '';
          setAnnouncement(`${tx('New order')} ${number}`.trim());
        }
        if (STAFF_EVENTS.has(event.type) || event.type.startsWith('order.')) refreshSoon();
      });
    })();

    return () => {
      cancelled = true;
      if (pending) clearTimeout(pending);
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, [tx]);

  // Screen readers hear a new order; sighted staff see the bell's count change.
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {announcement}
    </p>
  );
}
