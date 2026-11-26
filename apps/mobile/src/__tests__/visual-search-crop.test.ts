import { cropRect, outputSize } from '@/features/visual-search/image-crop';

/*
 * The crop the phone sends has to match what the operator saw in the frame. These cases are
 * the ones that were wrong in the first draft: a landscape picture in a square frame, a zoomed
 * picture, and a pan that would otherwise leave the picture.
 */

describe('cropRect', () => {
  it('takes a centred square from a landscape picture', () => {
    const rect = cropRect({ width: 1600, height: 1200 }, 300, {
      scale: 1,
      translateX: 0,
      translateY: 0,
    });
    expect(rect.width).toBe(1200);
    expect(rect.height).toBe(1200);
    expect(rect.originY).toBe(0);
    expect(rect.originX).toBe(200);
  });

  it('shrinks the crop as the picture is zoomed in', () => {
    const rect = cropRect({ width: 1600, height: 1200 }, 300, {
      scale: 2,
      translateX: 0,
      translateY: 0,
    });
    expect(rect.width).toBe(600);
    expect(rect.height).toBe(600);
    // Still centred after the zoom.
    expect(rect.originX + rect.width / 2).toBeCloseTo(800, 0);
    expect(rect.originY + rect.height / 2).toBeCloseTo(600, 0);
  });

  it('follows a pan without leaving the picture', () => {
    const far = cropRect({ width: 1600, height: 1200 }, 300, {
      scale: 2,
      translateX: 10_000,
      translateY: -10_000,
    });
    expect(far.originX).toBeGreaterThanOrEqual(0);
    expect(far.originY).toBeGreaterThanOrEqual(0);
    expect(far.originX + far.width).toBeLessThanOrEqual(1600);
    expect(far.originY + far.height).toBeLessThanOrEqual(1200);

    const moved = cropRect({ width: 1600, height: 1200 }, 300, {
      scale: 2,
      translateX: -150,
      translateY: 0,
    });
    // Panning left moves the window right in the source picture.
    expect(moved.originX).toBeGreaterThan(500);
  });

  it('never returns an empty rectangle', () => {
    const rect = cropRect({ width: 0, height: 0 }, 0, { scale: 1, translateX: 0, translateY: 0 });
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
});

describe('outputSize', () => {
  it('caps the longest side at 1024 and never upscales', () => {
    expect(outputSize({ originX: 0, originY: 0, width: 2400, height: 2400 })).toEqual({
      width: 1024,
      height: 1024,
    });
    expect(outputSize({ originX: 0, originY: 0, width: 600, height: 600 })).toEqual({
      width: 600,
      height: 600,
    });
  });
});
