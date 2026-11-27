'use client';

import type { OrderGeographyDistrict, OrderGeographyMetric } from '@nilzora/contracts';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatCount, formatMoney } from '@/lib/format';
import { intensityOf, mapFill, metricValue, shareText } from '@/lib/order-geography';
import { loadMapGeometry, type MapGeometry, type MapShape } from './geo-projection';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The Bangladesh choropleth.
 *
 * Everything it draws comes from the aggregate the page already loaded — the districts'
 * order, delivered and revenue figures are in the payload, so changing the shaded metric
 * or hovering a district never touches the network. Clicking a district reports it to the
 * page through `onSelect`; the selection is view state only and the aggregate is not
 * narrowed, so the map keeps all of its colour and the charts highlight the row instead.
 *
 * The map is an enhancement: the ranked list beside it is the keyboard-accessible way to
 * select a district, and the SVG carries one summary sentence for screen readers instead
 * of sixty-four tab stops.
 */

export interface BangladeshMapProps {
  districts: readonly OrderGeographyDistrict[];
  metric: OrderGeographyMetric;
  selectedDistrict: string | null;
  selectedDivision: string | null;
  /** Called with the district the admin clicked; the page owns the selection. */
  onSelect: (district: string) => void;
  rangeLabel: string;
  className?: string;
}

interface View {
  k: number;
  x: number;
  y: number;
}

const HOME: View = { k: 1, x: 0, y: 0 };
const MAX_ZOOM = 8;
/** Labels are drawn only for districts at least this big (viewBox units²) and this busy. */
const LABEL_AREA = 260;
const LABEL_COUNT = 12;

export function BangladeshMap({
  districts,
  metric,
  selectedDistrict,
  selectedDivision,
  onSelect,
  rangeLabel,
  className,
}: BangladeshMapProps) {
  const tx = useTx();
  const [geometry, setGeometry] = useState<MapGeometry | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>(HOME);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [reduced, setReduced] = useState(false);
  const svg = useRef<SVGSVGElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; k: number } | null>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const moved = useRef(false);
  const summaryId = useId();

  useEffect(() => {
    let live = true;
    loadMapGeometry()
      .then((loaded) => {
        if (live) setGeometry(loaded);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setReduced(query.matches);
    };
    update();
    query.addEventListener('change', update);
    return () => {
      query.removeEventListener('change', update);
    };
  }, []);

  const rows = useMemo(() => new Map(districts.map((row) => [row.district, row])), [districts]);
  const max = useMemo(
    () => districts.reduce((top, row) => Math.max(top, metricValue(row, metric)), 0),
    [districts, metric],
  );
  const total = useMemo(
    () => districts.reduce((sum, row) => sum + metricValue(row, metric), 0),
    [districts, metric],
  );

  const zoomBy = useCallback((factor: number) => {
    setView((current) => {
      const k = Math.min(MAX_ZOOM, Math.max(1, current.k * factor));
      if (k === 1) return HOME;
      return { ...current, k };
    });
  }, []);

  const zoomTo = useCallback((shape: MapShape, k = 3.2) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, k));
    setView({ k: next, x: shape.cx * (1 - next), y: shape.cy * (1 - next) });
  }, []);

  const hoveredRow = hovered === null ? null : (rows.get(hovered) ?? null);
  const hoveredShape =
    hovered === null ? null : (geometry?.districts.find((shape) => shape.name === hovered) ?? null);

  /** Pointer position inside the map, so the tooltip is placed without reading the DOM in render. */
  const placeTip = useCallback((event: React.PointerEvent<SVGPathElement>) => {
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!rect) return;
    setTip({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      w: rect.width,
      h: rect.height,
    });
  }, []);

  const labelled = useMemo(() => {
    if (!geometry) return [];
    const named = new Set(
      districts
        .filter((row) => metricValue(row, metric) > 0)
        .sort((a, b) => metricValue(b, metric) - metricValue(a, metric))
        .slice(0, LABEL_COUNT)
        .map((row) => row.district),
    );
    return geometry.districts.filter((shape) => {
      if (shape.name === selectedDistrict) return true;
      return named.has(shape.name) && shape.area >= LABEL_AREA;
    });
  }, [geometry, districts, metric, selectedDistrict]);

  const summary = `${String(districts.length)} districts drawn from the current filters, shaded by ${metric}. ${formatCount(
    districts.reduce((sum, row) => sum + row.orderCount, 0),
  )} mapped orders in ${rangeLabel}.`;

  if (failed) {
    return (
      <div className={className}>
        <div className="grid h-64 place-items-center rounded-2xl bg-surface-muted/50 p-6 text-center text-sm text-muted-foreground ring-1 ring-hairline">
          The map outlines could not be loaded. The ranked list beside the map still has every
          figure.
        </div>
      </div>
    );
  }

  if (!geometry) {
    return (
      <div className={className} aria-busy="true">
        <div className="h-104 w-full animate-pulse rounded-2xl bg-surface-muted/60 ring-1 ring-hairline" />
      </div>
    );
  }

  const transform = `translate(${String(view.x)} ${String(view.y)}) scale(${String(view.k)})`;
  const strokeScale = 1 / view.k;

  return (
    <div className={className}>
      <div
        className="relative overflow-hidden rounded-2xl bg-surface-muted/40 ring-1 ring-hairline"
        onPointerLeave={() => {
          setHovered(null);
          setTip(null);
        }}
      >
        <svg
          ref={svg}
          viewBox={`0 0 ${String(geometry.width)} ${String(geometry.height)}`}
          className="block h-auto w-full touch-none select-none"
          role="img"
          aria-labelledby={summaryId}
          style={{ cursor: view.k > 1 ? 'grab' : 'default' }}
          onDoubleClick={() => {
            if (selectedDistrict !== null) {
              const shape = geometry.districts.find((entry) => entry.name === selectedDistrict);
              if (shape) zoomTo(shape, view.k < MAX_ZOOM ? view.k * 2 : 1);
            } else {
              setView(HOME);
            }
          }}
          onPointerDown={(event) => {
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            moved.current = false;
            if (pointers.current.size === 1) {
              drag.current = {
                x: event.clientX,
                y: event.clientY,
                startX: view.x,
                startY: view.y,
              };
              // Capture only while panning is possible: capturing at fit-to-country would
              // send the click to the SVG instead of the district under the pointer.
              if (view.k > 1) event.currentTarget.setPointerCapture(event.pointerId);
            } else if (pointers.current.size === 2) {
              const [first, second] = [...pointers.current.values()];
              if (first && second) {
                pinch.current = {
                  distance: Math.hypot(second.x - first.x, second.y - first.y),
                  k: view.k,
                };
              }
            }
          }}
          onPointerMove={(event) => {
            if (pointers.current.has(event.pointerId)) {
              pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            }
            if (pointers.current.size === 2 && pinch.current !== null) {
              const [first, second] = [...pointers.current.values()];
              if (first && second) {
                const distance = Math.hypot(second.x - first.x, second.y - first.y);
                if (distance > 0 && pinch.current.distance > 0) {
                  const k = Math.min(
                    MAX_ZOOM,
                    Math.max(1, (pinch.current.k * distance) / pinch.current.distance),
                  );
                  setView((current) => ({ ...current, k }));
                }
              }
              return;
            }
            const started = drag.current;
            if (started === null || view.k === 1 || event.buttons === 0) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const perUnit = geometry.width / rect.width;
            if (Math.abs(event.clientX - started.x) + Math.abs(event.clientY - started.y) > 4) {
              moved.current = true;
            }
            setView((current) => ({
              ...current,
              x: started.startX + (event.clientX - started.x) * perUnit,
              y: started.startY + (event.clientY - started.y) * perUnit,
            }));
          }}
          onPointerUp={(event) => {
            pointers.current.delete(event.pointerId);
            if (pointers.current.size < 2) pinch.current = null;
            if (pointers.current.size === 0) drag.current = null;
          }}
          onPointerCancel={(event) => {
            pointers.current.delete(event.pointerId);
            pinch.current = null;
            drag.current = null;
          }}
        >
          <title id={summaryId}>{summary}</title>

          {/* Division outlines sit underneath, so the eight regions read as regions. */}
          <g transform={transform} aria-hidden="true">
            {geometry.divisions.map((shape) => (
              <path
                key={`division-${shape.name}`}
                d={shape.d}
                fill={selectedDivision === shape.name ? 'var(--color-chart-2)' : 'none'}
                fillOpacity={selectedDivision === shape.name ? 0.12 : 0}
                stroke="var(--color-chart-axis)"
                strokeOpacity={0.45}
                strokeWidth={1.6 * strokeScale}
                strokeLinejoin="round"
                pointerEvents="none"
              />
            ))}
            {geometry.districts.map((shape) => {
              const row = rows.get(shape.name);
              const value = row === undefined ? 0 : metricValue(row, metric);
              const level = intensityOf(value, max);
              const fill = mapFill(level);
              const selected = selectedDistrict === shape.name;
              const isHovered = hovered === shape.name;
              const dimmed =
                selectedDivision !== null && row !== undefined && row.division !== selectedDivision;
              return (
                <path
                  key={shape.name}
                  d={shape.d}
                  fill={fill.fill}
                  fillOpacity={dimmed ? fill.fillOpacity * 0.35 : fill.fillOpacity}
                  stroke={selected ? 'var(--color-chart-2)' : 'var(--color-surface)'}
                  strokeOpacity={selected ? 1 : 0.7}
                  strokeWidth={(selected ? 2.4 : isHovered ? 1.8 : 0.6) * strokeScale}
                  strokeLinejoin="round"
                  className={reduced ? undefined : 'transition-[fill-opacity] duration-200'}
                  style={{ cursor: 'pointer' }}
                  aria-hidden="true"
                  onPointerEnter={(event) => {
                    setHovered(shape.name);
                    placeTip(event);
                  }}
                  onPointerMove={(event) => {
                    placeTip(event);
                  }}
                  onClick={() => {
                    if (moved.current) return;
                    zoomTo(shape, Math.max(view.k, 3.2));
                    onSelect(shape.name);
                  }}
                />
              );
            })}
            {labelled.map((shape) => (
              <text
                key={`label-${shape.name}`}
                x={shape.cx}
                y={shape.cy}
                textAnchor="middle"
                dominantBaseline="middle"
                pointerEvents="none"
                aria-hidden="true"
                style={{
                  fontSize: 10 / view.k,
                  fontWeight: 600,
                  fill: 'var(--color-foreground)',
                  paintOrder: 'stroke',
                  stroke: 'var(--color-surface)',
                  strokeWidth: 2.4 / view.k,
                  strokeOpacity: 0.85,
                }}
              >
                {shape.name}
              </text>
            ))}
          </g>
        </svg>

        {hoveredRow !== null && tip !== null ? (
          <MapTooltip
            tip={tip}
            district={hoveredRow}
            bengali={hoveredShape?.bn ?? null}
            metric={metric}
            share={hoveredRow.share}
            total={total}
            rangeLabel={rangeLabel}
          />
        ) : null}

        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <MapButton
            label={tx('Zoom in')}
            onClick={() => {
              zoomBy(1.35);
            }}
          />
          <MapButton
            label={tx('Zoom out')}
            onClick={() => {
              zoomBy(1 / 1.35);
            }}
          />
          <MapButton
            label={tx('Fit Bangladesh')}
            onClick={() => {
              setView(HOME);
            }}
            wide
          />
        </div>

        <p className="pointer-events-none absolute bottom-1 left-2 text-[10px] text-muted-foreground">
          {geometry.attribution}
        </p>
      </div>
    </div>
  );
}

function MapButton({
  label,
  onClick,
  wide = false,
}: {
  label: string;
  onClick: () => void;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`grid h-8 min-w-8 place-items-center rounded-lg bg-surface/90 px-1 text-xs font-semibold text-foreground shadow-sm ring-1 ring-hairline backdrop-blur hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-action ${wide ? 'text-[10px]' : ''}`}
    >
      {wide ? 'Fit' : label === 'Zoom in' ? '+' : '−'}
    </button>
  );
}

function MapTooltip({
  tip,
  district,
  bengali,
  metric,
  share,
  total,
  rangeLabel,
}: {
  tip: { x: number; y: number; w: number; h: number };
  district: OrderGeographyDistrict;
  bengali: string | null;
  metric: OrderGeographyMetric;
  share: number | null;
  total: number;
  rangeLabel: string;
}) {
  const tx = useTx();
  const flipX = tip.x > tip.w - 190;
  const flipY = tip.y > tip.h - 150;
  const value = metricValue(district, metric);
  return (
    <div
      aria-hidden="true"
      data-testid="map-tooltip"
      className="pointer-events-none absolute z-10 w-44 rounded-xl bg-surface/95 p-2.5 text-xs shadow-lg ring-1 ring-hairline backdrop-blur"
      style={{
        left: flipX ? undefined : tip.x + 12,
        right: flipX ? tip.w - tip.x + 12 : undefined,
        top: flipY ? undefined : tip.y + 12,
        bottom: flipY ? tip.h - tip.y + 12 : undefined,
      }}
    >
      <p className="font-semibold text-foreground">
        <AutoText value={district.district} />
      </p>
      {bengali !== null ? (
        <p className="text-[11px] text-muted-foreground" lang="bn">
          {bengali}
        </p>
      ) : null}
      <p className="text-[11px] text-muted-foreground">{district.division} division</p>
      <dl className="mt-1.5 grid gap-0.5 tabular-nums">
        <Row label={tx('Orders')} value={formatCount(district.orderCount)} />
        <Row label={tx('Delivered')} value={formatCount(district.deliveredCount)} />
        <Row label={tx('Revenue')} value={formatMoney(district.revenueMinor)} />
        <Row label={tx('Share')} value={shareText(share)} />
      </dl>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        {metric === 'orders'
          ? `${formatCount(value)} of ${formatCount(total)} orders`
          : metric === 'revenue'
            ? formatMoney(value)
            : `${formatCount(value)} delivered`}{' '}
        · {rangeLabel}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">
        <AutoText value={label} />
      </dt>
      <dd className="font-medium text-foreground">
        <AutoText value={value} />
      </dd>
    </div>
  );
}
