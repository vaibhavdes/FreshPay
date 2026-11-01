import type { LngLat } from '@/lib/engine/geo';
import { queryTreeCoverLoss } from '@/lib/oracles/geo';

// Lists Landsat pixels with tree cover loss since 2021 around a point and reports the densest
// ~100 m cell, so a plot can be placed over loss that really happened.
const PIXELS_SQL =
  'SELECT longitude, latitude, umd_tree_cover_loss__year FROM results WHERE umd_tree_cover_loss__year >= 2021 AND umd_tree_cover_density_2000__threshold >= 30';

async function main() {
  const [lng, lat, radiusM = 2000] = process.argv.slice(2).map(Number);
  const apiKey = process.env.GFW_API_KEY;
  if (!apiKey || Number.isNaN(lng) || Number.isNaN(lat)) throw new Error('Usage: GFW_API_KEY=... npm run find-loss -- <lng> <lat> [radius metres]');

  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const dLat = radiusM / 110_574;
  const box: LngLat[] = [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
  ];

  const pixels = await queryTreeCoverLoss(PIXELS_SQL, box, apiKey);
  console.log(`${pixels.length} loss pixels since 2021 within ${radiusM} m of ${lng}, ${lat}`);
  if (!pixels.length) return;

  const cells = new Map<string, { count: number; years: Set<number> }>();
  for (const p of pixels) {
    const key = `${Number(p.longitude).toFixed(3)},${Number(p.latitude).toFixed(3)}`;
    const cell = cells.get(key) ?? { count: 0, years: new Set<number>() };
    cell.count += 1;
    cell.years.add(Number(p.umd_tree_cover_loss__year));
    cells.set(key, cell);
  }
  const ranked = [...cells.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
  console.table(ranked.map(([centre, c]) => ({ centre, pixels: c.count, approxHa: (c.count * 0.09).toFixed(2), years: [...c.years].sort().join(' ') })));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
