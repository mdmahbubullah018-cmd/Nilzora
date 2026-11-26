/*
 * Status tones for the admin: one set of semantic classes per tone, built on the admin
 * tokens in globals.css (no palette or hex values here). Every tone has
 *
 *   chip  – a tinted status chip: translucent tint, readable ink (≥ 4.5:1), hairline ring
 *   dot   – the small colour dot inside a chip (reinforcement only; the label carries meaning)
 *   well  – an icon well (KPI cards, section headers, empty and error states)
 *   ink   – text in the tone's readable colour
 *
 * The keys match @nilzora/ui's BadgeTone, so status maps written for Badge apply as is.
 */
export const STATUS_TONES = {
  neutral: {
    chip: 'bg-neutral-soft text-neutral-ink ring-neutral-line',
    dot: 'bg-chart-axis',
    well: 'bg-neutral-soft text-neutral-ink ring-neutral-line',
    ink: 'text-neutral-ink',
  },
  primary: {
    chip: 'bg-info-soft text-info-ink ring-info-line',
    dot: 'bg-chart-1',
    well: 'bg-info-soft text-info-ink ring-info-line',
    ink: 'text-info-ink',
  },
  success: {
    chip: 'bg-success-soft text-success-ink ring-success-line',
    dot: 'bg-chart-3',
    well: 'bg-success-soft text-success-ink ring-success-line',
    ink: 'text-success-ink',
  },
  warning: {
    chip: 'bg-warning-soft text-warning-ink ring-warning-line',
    dot: 'bg-chart-4',
    well: 'bg-warning-soft text-warning-ink ring-warning-line',
    ink: 'text-warning-ink',
  },
  danger: {
    chip: 'bg-danger-soft text-danger-ink ring-danger-line',
    dot: 'bg-danger',
    well: 'bg-danger-soft text-danger-ink ring-danger-line',
    ink: 'text-danger-ink',
  },
  violet: {
    chip: 'bg-violet-soft text-violet-ink ring-violet-line',
    dot: 'bg-chart-2',
    well: 'bg-violet-soft text-violet-ink ring-violet-line',
    ink: 'text-violet-ink',
  },
  moderator: {
    chip: 'bg-teal-soft text-teal-ink ring-teal-line',
    dot: 'bg-chart-6',
    well: 'bg-teal-soft text-teal-ink ring-teal-line',
    ink: 'text-teal-ink',
  },
  offer: {
    chip: 'bg-offer-soft text-offer-ink ring-offer-line',
    dot: 'bg-offer',
    well: 'bg-offer-soft text-offer-ink ring-offer-line',
    ink: 'text-offer-ink',
  },
} as const;

export type StatusTone = keyof typeof STATUS_TONES;
