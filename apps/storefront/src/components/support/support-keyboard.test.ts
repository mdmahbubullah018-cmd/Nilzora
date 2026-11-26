import { describe, expect, it } from 'vitest';
import { nextFocusIndex } from './support-keyboard';

describe('nextFocusIndex', () => {
  const grid = { count: 8, orientation: 'grid' as const, columns: 4 };

  it('steps left and right through a grid, wrapping at the ends', () => {
    expect(nextFocusIndex({ ...grid, key: 'ArrowRight', at: 0 })).toBe(1);
    expect(nextFocusIndex({ ...grid, key: 'ArrowRight', at: 7 })).toBe(0);
    expect(nextFocusIndex({ ...grid, key: 'ArrowLeft', at: 0 })).toBe(7);
  });

  it('moves a whole row up and down, and stays put at the first and last row', () => {
    expect(nextFocusIndex({ ...grid, key: 'ArrowDown', at: 1 })).toBe(5);
    expect(nextFocusIndex({ ...grid, key: 'ArrowDown', at: 5 })).toBeNull();
    expect(nextFocusIndex({ ...grid, key: 'ArrowUp', at: 6 })).toBe(2);
    expect(nextFocusIndex({ ...grid, key: 'ArrowUp', at: 2 })).toBeNull();
  });

  it('does not invent a row below a partial last row', () => {
    expect(
      nextFocusIndex({ key: 'ArrowDown', at: 5, count: 7, orientation: 'grid', columns: 4 }),
    ).toBeNull();
  });

  it('jumps with Home and End and ignores other keys', () => {
    expect(nextFocusIndex({ ...grid, key: 'Home', at: 5 })).toBe(0);
    expect(nextFocusIndex({ ...grid, key: 'End', at: 1 })).toBe(7);
    expect(nextFocusIndex({ ...grid, key: 'a', at: 1 })).toBeNull();
    expect(nextFocusIndex({ key: 'End', at: 0, count: 0, orientation: 'grid' })).toBeNull();
  });

  it('walks a vertical menu with Up and Down, wrapping, and ignores Left and Right', () => {
    const menu = { count: 3, orientation: 'vertical' as const };
    expect(nextFocusIndex({ ...menu, key: 'ArrowDown', at: 2 })).toBe(0);
    expect(nextFocusIndex({ ...menu, key: 'ArrowUp', at: 0 })).toBe(2);
    expect(nextFocusIndex({ ...menu, key: 'ArrowRight', at: 0 })).toBeNull();
  });
});
