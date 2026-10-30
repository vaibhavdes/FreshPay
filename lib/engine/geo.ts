export type LngLat = readonly [lng: number, lat: number];

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

// Local equirectangular projection centred on `origin`, in metres. At plot scale
// (a few hundred metres) the error is far below GPS accuracy.
function project(origin: LngLat, p: LngLat): [number, number] {
  return [(p[0] - origin[0]) * RAD * EARTH_RADIUS_M * Math.cos(origin[1] * RAD), (p[1] - origin[1]) * RAD * EARTH_RADIUS_M];
}

function edges(ring: readonly LngLat[], origin: LngLat): [number, number, number, number][] {
  const points = ring.map((p) => project(origin, p));
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    return [a[0], a[1], b[0], b[1]];
  });
}

export function pointInRing(point: LngLat, ring: readonly LngLat[]): boolean {
  let inside = false;
  for (const [x1, y1, x2, y2] of edges(ring, point)) {
    if (y1 > 0 !== y2 > 0 && 0 < ((x2 - x1) * -y1) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

export function distanceToRingMeters(point: LngLat, ring: readonly LngLat[]): number {
  let min = Infinity;
  for (const [x1, y1, x2, y2] of edges(ring, point)) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / lengthSq));
    min = Math.min(min, Math.hypot(x1 + t * dx, y1 + t * dy));
  }
  return min;
}

export function withinPlot(point: LngLat, ring: readonly LngLat[], bufferMeters: number): boolean {
  if (ring.length < 3) throw new RangeError('A plot ring needs at least 3 points');
  return pointInRing(point, ring) || distanceToRingMeters(point, ring) <= bufferMeters;
}

const isClosed = (ring: readonly LngLat[]) => ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1];

// GeoJSON rings repeat the first point at the end.
export const closeRing = (ring: readonly LngLat[]): LngLat[] => (isClosed(ring) ? [...ring] : [...ring, ring[0]]);

export function centroid(ring: readonly LngLat[]): LngLat {
  const points = isClosed(ring) ? ring.slice(0, -1) : ring;
  const [lng, lat] = points.reduce(([x, y], p) => [x + p[0], y + p[1]], [0, 0]);
  return [lng / points.length, lat / points.length];
}

export function ringAreaHectares(ring: readonly LngLat[]): number {
  const origin = centroid(ring);
  const doubled = edges(ring, origin).reduce((sum, [x1, y1, x2, y2]) => sum + x1 * y2 - x2 * y1, 0);
  return Math.abs(doubled) / 2 / 10_000;
}
