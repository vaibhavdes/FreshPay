import { writeFileSync } from 'node:fs';
import { centroid, ringAreaHectares, type LngLat } from '@/lib/engine/geo';

// Real coffee plantation outlines in Karnataka's Malnad coffee belt (Kodagu, Hassan,
// Chikkamagaluru), from OpenStreetMap
// (© OpenStreetMap contributors, ODbL). OSM records the land, not its owner.

const OUT = 'lib/db/osm-farms.json';
const BBOX = [11.9, 75.2, 13.7, 76.2]; // south, west, north, east
const MIN_HA = 0.3;
const MAX_HA = 5;

const QUERY = `[out:json][timeout:90];
(
  way["crop"~"coffee",i](${BBOX.join(',')});
  way["produce"~"coffee",i](${BBOX.join(',')});
  way["trees"~"coffee",i](${BBOX.join(',')});
);
out tags geom;`;

type Way = { id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] };

async function main() {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'FarmProof/1.0 (github.com/vaibhavdes/FreshPay)' },
    body: new URLSearchParams({ data: QUERY }),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { elements = [] } = (await res.json()) as { elements?: Way[] };

  const farms = elements
    .filter((w) => (w.geometry?.length ?? 0) >= 4)
    .map((w) => {
      const ring = w.geometry!.map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))] as LngLat);
      const [lng, lat] = centroid(ring);
      return { osmId: `way/${w.id}`, areaHa: Math.round(ringAreaHectares(ring) * 100) / 100, centre: [Number(lng.toFixed(5)), Number(lat.toFixed(5))], tags: w.tags ?? {}, ring };
    })
    .filter((f) => f.areaHa >= MIN_HA && f.areaHa <= MAX_HA)
    .sort((a, b) => a.areaHa - b.areaHa);

  writeFileSync(OUT, `${JSON.stringify({ source: 'OpenStreetMap contributors, ODbL', fetchedAt: new Date().toISOString(), farms }, null, 2)}\n`);
  console.log(`${elements.length} coffee outlines found, ${farms.length} farm-sized (${MIN_HA}-${MAX_HA} ha). Wrote ${OUT}`);
  console.table(farms.map((f) => ({ osm: f.osmId, ha: f.areaHa, lat: f.centre[1], lng: f.centre[0], name: f.tags.name ?? '' })));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
