import { drawLength } from './chart-parts';

/*
 * Ring geometry shared by the donut and the radial progress: a 42-unit square with a
 * circle whose circumference is exactly 100, so dash lengths are percentages.
 */
export const RING_SIZE = 42;
export const RING_CENTRE = RING_SIZE / 2;
// r = 100 / 2π, so the circumference is 100.
export const RING_RADIUS = 15.915494309189533;

/**
 * A mask that reveals the ring clockwise from the top once (`.nz-draw` on a full-circle
 * stroke). Segments keep their own dash arrays, which `.nz-draw` would otherwise
 * replace; under reduced motion the mask is simply whole.
 */
export function RingReveal({ id }: { id: string }) {
  return (
    <mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={RING_SIZE} height={RING_SIZE}>
      <circle
        cx={RING_CENTRE}
        cy={RING_CENTRE}
        r={RING_RADIUS}
        fill="none"
        stroke="white"
        strokeWidth={12}
        className="nz-draw"
        style={drawLength(100)}
      />
    </mask>
  );
}
