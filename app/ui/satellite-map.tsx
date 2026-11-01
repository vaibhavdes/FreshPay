import { centroid, type LngLat } from '@/lib/engine/geo';

// Plot outlines drawn over Esri World Imagery tiles, laid out with Web Mercator maths in one SVG,
// so the map needs no map library and scales with its container.

const TILE = 256;
const MAX_ZOOM = 17;
const TILE_URL = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

type MapPlot = { id: string; name: string; ring: readonly LngLat[]; status: 'PASS' | 'REVIEW' | 'FAIL' };

const TONES = { PASS: '#7ee2a8', REVIEW: '#f5c451', FAIL: '#ff6b5e' } as const;

function toPixels([lng, lat]: LngLat, zoom: number): [number, number] {
  const scale = TILE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * scale, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale];
}

function bounds(points: [number, number][]) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function SatelliteMap({
  plots,
  width = 640,
  title,
  className,
  linked = true,
  ratio = 0.62,
  caption = true,
  zoomIn = false,
}: {
  plots: MapPlot[];
  width?: number;
  title: string;
  className?: string;
  linked?: boolean;
  ratio?: number;
  caption?: boolean;
  zoomIn?: boolean;
}) {
  if (!plots.length) return null;
  const all = plots.flatMap((p) => p.ring);
  // The closest zoom at which every plot fits with a margin; a single plot keeps its surroundings in view.
  const fill = plots.length > 1 ? 0.6 : zoomIn ? 0.6 : 0.3;
  let zoom = MAX_ZOOM;
  while (zoom > 3) {
    const b = bounds(all.map((p) => toPixels(p, zoom)));
    if (b.maxX - b.minX <= width * fill && b.maxY - b.minY <= width * fill * ratio) break;
    zoom--;
  }

  const b = bounds(all.map((p) => toPixels(p, zoom)));
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const height = Math.round(width * ratio);
  const view = { x: cx - width / 2, y: cy - height / 2 };

  const tiles: { x: number; y: number }[] = [];
  for (let tx = Math.floor(view.x / TILE); tx <= Math.floor((view.x + width) / TILE); tx++) {
    for (let ty = Math.floor(view.y / TILE); ty <= Math.floor((view.y + height) / TILE); ty++) tiles.push({ x: tx, y: ty });
  }

  return (
    <figure className={className}>
      <svg viewBox={`${view.x} ${view.y} ${width} ${height}`} role="img" aria-label={title} className="block w-full rounded-lg bg-canopy">
        {tiles.map(({ x, y }) => (
          <image key={`${x}-${y}`} href={TILE_URL(zoom, x, y)} x={x * TILE} y={y * TILE} width={TILE} height={TILE} preserveAspectRatio="none" />
        ))}
        {plots.map((plot) => {
          const points = plot.ring.map((p) => toPixels(p, zoom));
          const box = bounds(points);
          const small = box.maxX - box.minX < 12;
          const [mx, my] = toPixels(centroid(plot.ring), zoom);
          const tone = TONES[plot.status];
          const Wrap = ({ children }: { children: React.ReactNode }) => (linked ? <a href={`/farms/${plot.id}`}>{children}</a> : <g>{children}</g>);
          return (
            <Wrap key={plot.id}>
              <title>{plot.name}</title>
              {small ? (
                <circle cx={mx} cy={my} r={7} fill={tone} stroke="#0b130e" strokeWidth={2} />
              ) : (
                <polygon points={points.map(([x, y]) => `${x},${y}`).join(' ')} fill={tone} fillOpacity={0.18} stroke={tone} strokeWidth={2.5} strokeLinejoin="round" />
              )}
              {plots.length > 1 && (
                <text x={mx + (small ? 11 : (box.maxX - box.minX) / 2 + 6)} y={my + 4} fontSize={13} fontWeight={700} fill="#fff" stroke="#0b130e" strokeWidth={3} paintOrder="stroke">
                  {plot.name}
                </text>
              )}
            </Wrap>
          );
        })}
      </svg>
      {caption && <figcaption className="mt-1 text-right text-xs text-canopy-soft">Imagery: Esri, Maxar, Earthstar Geographics</figcaption>}
    </figure>
  );
}
