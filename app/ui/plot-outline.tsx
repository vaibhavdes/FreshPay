import { centroid, type LngLat } from '@/lib/engine/geo';

type Props = { ring: readonly LngLat[]; tone?: 'leaf' | 'cherry'; night?: boolean; className?: string; title: string };

const PALETTES = {
  day: { contour: 'var(--at-contour)', leaf: ['var(--at-leaf-wash)', 'var(--at-leaf)'], cherry: ['var(--at-cherry-wash)', 'var(--at-cherry)'] },
  night: { contour: 'rgba(255,255,255,0.13)', leaf: ['rgba(111,212,146,0.14)', 'var(--night-leaf)'], cherry: ['rgba(255,107,107,0.14)', 'var(--night-cherry)'] },
} as const;

const SIZE = 320;
const MARGIN = 10;
const CONTOURS = [1.32, 1.68, 2.05];

type Point = readonly [number, number];

// A closed curve through the midpoints of each side, rounding the corners the way contour lines do.
function smoothPath(points: readonly Point[]): string {
  const mid = (a: Point, b: Point) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
  const start = mid(points.at(-1)!, points[0]);
  const curves = points.map((p, i) => {
    const end = mid(p, points[(i + 1) % points.length]);
    return `Q${p[0].toFixed(1)},${p[1].toFixed(1)} ${end[0].toFixed(1)},${end[1].toFixed(1)}`;
  });
  return `M${start[0].toFixed(1)},${start[1].toFixed(1)} ${curves.join(' ')} Z`;
}

// Draws the surveyed plot boundary to scale, with contour lines stepping out from it.
export function PlotOutline({ ring, tone = 'leaf', night = false, className, title }: Props) {
  const palette = PALETTES[night ? 'night' : 'day'];
  const [fill, stroke] = palette[tone];
  const [cx, cy] = centroid(ring);
  const cosLat = Math.cos((cy * Math.PI) / 180);
  const open = ring.length > 3 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  const local = open.map(([lng, lat]) => [(lng - cx) * cosLat, -(lat - cy)] as const);
  const extent = Math.max(...local.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
  const scale = (SIZE / 2 - MARGIN) / (extent * CONTOURS.at(-1)!);
  const at = (factor: number) => local.map(([x, y]) => [SIZE / 2 + x * scale * factor, SIZE / 2 + y * scale * factor] as const);

  const boundary = at(1);
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={title} className={className}>
      {CONTOURS.map((factor) => (
        <path key={factor} d={smoothPath(at(factor))} fill="none" stroke={palette.contour} strokeWidth={1.25} />
      ))}
      <path
        d={`${boundary.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} Z`}
        pathLength={1}
        className="plot-boundary"
        fill={fill}
        stroke={stroke}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}
