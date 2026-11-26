import type { CustomerShipment } from '@nilzora/contracts';
import { Badge, buttonClasses, Card, CardContent, CardHeader, CardTitle, cn } from '@nilzora/ui';
import { ExternalLink, PackageCheck, Truck, Undo2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { formatEventTime } from '@/components/orders/order-status';
import { formatLongDate } from '@/lib/format';
import {
  SHIPMENT_KIND_LABELS,
  shipmentStatusLabel,
  shipmentTone,
  trackingHref,
  trackingSteps,
  type TrackingStep,
} from '@/lib/shipment-view';
import { CopyTrackingCode } from './copy-tracking-code';

/*
 * Courier tracking for the customer: who has the parcel, where it has got to, the tracking
 * code and the courier's own tracking page. Only the customer contract's fields are read, so
 * no cost, settlement, note or raw courier data can appear here.
 */

/** Updates shown before the rest fold away under "Show earlier updates". */
const VISIBLE_STEPS = 4;

function Step({ step, kind, latest, last }: StepProps) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {last ? null : (
        <span aria-hidden="true" className="absolute top-4 bottom-0 left-[4.5px] w-px bg-border" />
      )}
      <span
        aria-hidden="true"
        className={
          latest
            ? 'mt-1.5 size-2.5 shrink-0 rounded-full bg-primary ring-4 ring-sky-100'
            : 'mt-1.5 size-2.5 shrink-0 rounded-full bg-border-strong'
        }
      />
      <div className="grid gap-0.5">
        <p className={cn('text-sm text-foreground', latest ? 'font-semibold' : 'font-medium')}>
          {shipmentStatusLabel(kind, step.status)}
        </p>
        <p className="text-xs text-muted-foreground">
          <time dateTime={step.at}>{formatEventTime(step.at)}</time>
        </p>
      </div>
    </li>
  );
}

interface StepProps {
  step: TrackingStep;
  kind: CustomerShipment['kind'];
  latest: boolean;
  last: boolean;
}

function TrackingTimeline({ shipment }: { shipment: CustomerShipment }) {
  const steps = trackingSteps(shipment);
  if (steps.length === 0) return null;
  const shown = steps.slice(0, VISIBLE_STEPS);
  const folded = steps.slice(VISIBLE_STEPS);
  return (
    <div className="grid gap-2">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Courier updates
      </p>
      <ol aria-label="Courier updates, newest first" className="grid">
        {shown.map((step, index) => (
          <Step
            // Positions are stable for one render: the list is sorted, never reordered in place.
            key={index}
            step={step}
            kind={shipment.kind}
            latest={index === 0}
            last={index === shown.length - 1 && folded.length === 0}
          />
        ))}
      </ol>
      {folded.length > 0 ? (
        <details className="group">
          <summary className="ml-5.5 w-fit cursor-pointer rounded-sm text-sm font-medium text-link underline-offset-4 hover:underline">
            Show {folded.length} earlier {folded.length === 1 ? 'update' : 'updates'}
          </summary>
          <ol aria-label="Earlier courier updates" className="mt-3 grid">
            {folded.map((step, index) => (
              <Step
                key={index}
                step={step}
                kind={shipment.kind}
                latest={false}
                last={index === folded.length - 1}
              />
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

function ShipmentBlock({
  shipment,
  returnLink,
}: {
  shipment: CustomerShipment;
  returnLink: boolean;
}) {
  const label = shipmentStatusLabel(shipment.kind, shipment.status);
  const href = trackingHref(shipment.trackingUrl);
  const Icon = shipment.kind === 'return_pickup' ? Undo2 : Truck;
  return (
    <section
      aria-label={`${SHIPMENT_KIND_LABELS[shipment.kind]} with ${shipment.providerName}`}
      className="grid gap-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-info-soft text-info-ink ring-1 ring-info-line"
          >
            <Icon className="size-5" />
          </span>
          <div className="grid min-w-0 gap-0.5">
            <p className="text-sm font-semibold wrap-break-word text-foreground">
              {shipment.providerName}
            </p>
            <p className="text-xs text-muted-foreground">{SHIPMENT_KIND_LABELS[shipment.kind]}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {shipment.isTest ? <Badge tone="neutral">Test shipment</Badge> : null}
          <Badge tone={shipmentTone(shipment.status)} dot>
            <span className="sr-only">Courier status: </span>
            {label}
          </Badge>
        </div>
      </div>

      {shipment.trackingCode === null ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-muted px-3.5 py-2.5">
          <div className="grid min-w-0 gap-0.5">
            <span className="text-xs text-muted-foreground">Tracking code</span>
            <span className="font-mono text-sm font-semibold break-all text-foreground">
              {shipment.trackingCode}
            </span>
          </div>
          <CopyTrackingCode code={shipment.trackingCode} />
        </div>
      )}

      {shipment.deliveredAt === null ? null : (
        <p className="flex items-center gap-2 text-sm text-body">
          <PackageCheck aria-hidden="true" className="size-4 text-success" />
          {shipment.kind === 'return_pickup' ? 'Received by Nilzora on ' : 'Delivered on '}
          <time dateTime={shipment.deliveredAt}>{formatLongDate(shipment.deliveredAt)}</time>
        </p>
      )}

      <TrackingTimeline shipment={shipment} />

      {href !== null || (returnLink && shipment.returnRequestId !== null) ? (
        <div className="flex flex-wrap gap-2">
          {href === null ? null : (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses({ variant: 'outline' })}
            >
              Track on {shipment.providerName}
              <ExternalLink aria-hidden="true" />
              <span className="sr-only"> (opens the courier’s site in a new tab)</span>
            </a>
          )}
          {returnLink && shipment.returnRequestId !== null ? (
            <Link
              href={`/account/returns/${shipment.returnRequestId}` as Route}
              className={buttonClasses({ variant: 'ghost' })}
            >
              View the return
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export interface ShipmentTrackingCardProps {
  title: string;
  /** Shipments to show, newest first. An empty list renders nothing. */
  shipments: readonly CustomerShipment[];
  /** Adds a "View the return" link to a return pickup (on the order page). */
  returnLinks?: boolean;
}

export function ShipmentTrackingCard({
  title,
  shipments,
  returnLinks = false,
}: ShipmentTrackingCardProps) {
  if (shipments.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-6 divide-y divide-border [&>*:not(:first-child)]:pt-6">
          {shipments.map((shipment) => (
            <ShipmentBlock key={shipment.id} shipment={shipment} returnLink={returnLinks} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Updates come from the courier and can take a little while to appear.
        </p>
      </CardContent>
    </Card>
  );
}
