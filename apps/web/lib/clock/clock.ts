// The geometry of a clock face: a circle of equal wedges, the first one starting at twelve o'clock and running clockwise.

const CENTRE = 50;
const RADIUS = 44;

const point = (angle: number) => {
  const x = CENTRE + RADIUS * Math.cos(angle);
  const y = CENTRE + RADIUS * Math.sin(angle);
  return `${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`;
};

/** The path of wedge `index` (0-based) of a clock cut into `segments`. */
export function wedgePath({ index, segments }: { index: number; segments: number }): string {
  const step = (2 * Math.PI) / segments;
  const from = -Math.PI / 2 + index * step;
  return `M${CENTRE} ${CENTRE} L${point(from)} A${RADIUS} ${RADIUS} 0 0 1 ${point(from + step)} Z`;
}

/** A clock's filled count kept inside its segments, for drawing a count the server may not have clamped yet. */
export const clampFilled = ({ filled, segments }: { filled: number; segments: number }): number =>
  Math.min(Math.max(filled, 0), segments);
