import { useWindowDimensions } from 'react-native';
import { theme } from '@/theme';

/** Horizontal padding of every screen (see Screen and ListScreen). */
export const SCREEN_PADDING = theme.spacing[5];

/** Space between product cards. */
export const GRID_GAP = theme.spacing[3];

/** Width of a card in a horizontal row (Home), on the reference 360pt phone. */
export const ROW_CARD_WIDTH = 164;

/**
 * How much of the screen the next card in a row keeps in view. Two cards and the gap fill the
 * rest, so the row always reads as a carousel with more to the right instead of a list that
 * happens to end at the screen's edge.
 */
export const ROW_PEEK_SHARE = 0.05;

/**
 * Width of a card in a horizontal row, on this screen (see ROW_PEEK_SHARE).
 *
 * `bleed` (the default) is a row that runs to both screen edges and starts one screen padding
 * in, as Home's rows do; pass false for a row that already sits inside the page's padding. The
 * peek is subtracted from the row's own width, so it comes out as the share above rather than
 * "the share plus a padding". A row that needs a different sliver — the brand rail, whose cards
 * are bare logos rather than product cards — passes its own share.
 */
export function useRowCardWidth(bleed = true, peekShare = ROW_PEEK_SHARE): number {
  const { width } = useWindowDimensions();
  const available = bleed ? width : width - SCREEN_PADDING * 2;
  const lead = bleed ? SCREEN_PADDING : 0;
  return Math.floor((available - lead - GRID_GAP * 2 - Math.round(available * peekShare)) / 2);
}

/** Width of a card in the two-column grid: two cards and the gap fill the screen's content width. */
export function useGridCardWidth(): number {
  const { width } = useWindowDimensions();
  return Math.floor((width - SCREEN_PADDING * 2 - GRID_GAP) / 2);
}
