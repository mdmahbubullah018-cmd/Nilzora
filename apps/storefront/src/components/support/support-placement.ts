/*
 * Where a floating bar or menu goes
 * ---------------------------------
 * The chat scroller clips anything positioned inside it, so the reaction bar and the actions menu
 * are drawn in a portal with fixed coordinates. This pure function turns the pressed element's
 * rectangle and the popup's own size into those coordinates: above the anchor when there is room,
 * flipped below when there is not, and always clamped inside the viewport.
 */

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Placement {
  top: number;
  left: number;
  side: 'above' | 'below';
}

export interface PlacementInput {
  anchor: Box;
  popup: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Space between the anchor and the popup. */
  gap?: number;
  /** The smallest distance kept from every viewport edge. */
  margin?: number;
  /** Where the popup's left edge sits relative to the anchor. */
  align?: 'center' | 'start' | 'end';
  prefer?: 'above' | 'below';
}

function clamp(value: number, min: number, max: number): number {
  // A popup wider than the viewport pins to the left margin rather than going negative.
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

export function computePlacement(input: PlacementInput): Placement {
  const { anchor, popup, viewport } = input;
  const gap = input.gap ?? 6;
  const margin = input.margin ?? 8;
  const align = input.align ?? 'center';

  const roomAbove = anchor.top - gap - margin;
  const roomBelow = viewport.height - (anchor.top + anchor.height) - gap - margin;
  const fitsAbove = roomAbove >= popup.height;
  const fitsBelow = roomBelow >= popup.height;

  const first = (input.prefer ?? 'above') === 'above' ? 'above' : 'below';
  const second = first === 'above' ? 'below' : 'above';
  const fits = { above: fitsAbove, below: fitsBelow };
  const room = { above: roomAbove, below: roomBelow };
  // The preferred side when it fits, the other when only that fits, else whichever has more room.
  const side: 'above' | 'below' = fits[first]
    ? first
    : fits[second]
      ? second
      : room[second] > room[first]
        ? second
        : first;

  const rawTop =
    side === 'above' ? anchor.top - gap - popup.height : anchor.top + anchor.height + gap;
  const rawLeft =
    align === 'start'
      ? anchor.left
      : align === 'end'
        ? anchor.left + anchor.width - popup.width
        : anchor.left + anchor.width / 2 - popup.width / 2;

  return {
    side,
    top: clamp(rawTop, margin, viewport.height - popup.height - margin),
    left: clamp(rawLeft, margin, viewport.width - popup.width - margin),
  };
}

/** The smallest touch target (CSS px) for any reaction control. */
export const REACTION_TARGET = 44;

export interface ReactionGrid {
  columns: number;
  rows: number;
}

/**
 * How the reaction bar is laid out: as many 44 px columns as fit between the viewport margins,
 * balanced across the fewest rows (8 reactions on a 360 px phone make 4 x 2, never 6 + 2). On a
 * wide screen everything fits and the bar stays a single row.
 *
 * `chrome` is the bar's own padding and border, which sit outside the buttons.
 */
export function reactionGrid(input: {
  count: number;
  viewportWidth: number;
  margin?: number;
  target?: number;
  chrome?: number;
}): ReactionGrid {
  const target = input.target ?? REACTION_TARGET;
  const margin = input.margin ?? 8;
  const chrome = input.chrome ?? 10;
  const count = Math.max(1, input.count);
  const fitting = Math.max(1, Math.floor((input.viewportWidth - 2 * margin - chrome) / target));
  const rows = Math.ceil(count / fitting);
  return { columns: Math.ceil(count / rows), rows };
}

/** The tallest the stacked bar + menu may be: the viewport less both margins. */
export function overlayMaxHeight(viewportHeight: number, margin = 8): number {
  return Math.max(0, viewportHeight - 2 * margin);
}
