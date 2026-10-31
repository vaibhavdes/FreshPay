import type { LngLat } from '../engine/geo';
import { plotValueCents as termsValueCents, SEASON, type Variety } from '../season-terms';

// One 2026-27 coffee season in Chikkamagaluru district, Karnataka, built on public figures.
// People are fictional; plot outlines are illustrative; tree cover loss for each outline is real
// Global Forest Watch data (lib/db/geo-checks.json, from npm run prefetch:geo).
//
// Contract terms and their sources are in lib/season-terms.ts. Plot sizes follow the Coffee Board
// Database, Table 2.2: 58.8% of Karnataka coffee holdings are under 2 ha.

function plotRing([lng, lat]: LngLat, widthM: number, heightM: number, skewM = 0): LngLat[] {
  const toLng = (m: number) => m / (111_320 * Math.cos((lat * Math.PI) / 180));
  const toLat = (m: number) => m / 110_574;
  const w = widthM / 2;
  const h = heightM / 2;
  const corners: [number, number][] = [
    [-w, -h],
    [w, -h + skewM],
    [w * 0.94, h],
    [-w * 1.04, h - skewM],
  ];
  return corners.map(([x, y]) => [Number((lng + toLng(x)).toFixed(6)), Number((lat + toLat(y)).toFixed(6))]);
}

export const buyer = { id: 'buyer-eu-roaster', name: 'Nordlicht Kaffee GmbH', country: 'DE' };

export const cooperative = { id: 'coop-chikkamagaluru', name: 'Malnad Coffee Growers FPO', region: 'Chikkamagaluru, Karnataka', country: 'IN' };

export const dealer = { id: 'dealer-malnad-agro', name: 'Malnad Agro Inputs', kind: 'INPUTS' as const };

// The people farmers pay from stage bills, besides the input seller.
export const suppliers = [
  dealer,
  { id: 'labour-aldur-pickers', name: 'Aldur Pickers Group', kind: 'LABOUR' as const },
  { id: 'machinery-mudigere-hire', name: 'Mudigere Tractor and Pulper Hire', kind: 'MACHINERY' as const },
];
export const supplierIds = { INPUTS: dealer.id, LABOUR: 'labour-aldur-pickers', MACHINERY: 'machinery-mudigere-hire' };

export const farmers = [
  { id: 'farmer-lakshmi', name: 'Lakshmi Gowda' },
  { id: 'farmer-ravi', name: 'Ravi Shetty' },
  { id: 'farmer-savitha', name: 'Savitha Poojary' },
];

export type SeedPlot = { id: string; farmerId: string; name: string; variety: Variety; ring: LngLat[]; scenario: string };

// Three plots, three outcomes: paid on proof, held and reviewed, withheld for deforestation.
export const plots: SeedPlot[] = [
  {
    id: 'plot-elekhan',
    farmerId: 'farmer-lakshmi',
    name: 'Elekhan, Aldur',
    variety: 'arabica',
    ring: plotRing([75.6401, 13.2752], 115, 105, 6),
    scenario: 'Clear evidence, paid the same minute',
  },
  {
    id: 'plot-hosakere',
    farmerId: 'farmer-ravi',
    name: 'Hosakere, Mudigere',
    variety: 'robusta',
    ring: plotRing([75.6405, 13.1368], 150, 135, -8),
    scenario: 'Fertiliser bill too blurry to read: held, checked by the review agent, approved by the cooperative',
  },
  {
    // Sits on tree cover cleared in 2024 (GFW/UMD, found with npm run find-loss).
    id: 'plot-hirebyle',
    farmerId: 'farmer-savitha',
    name: 'Hirebyle, Kalasa',
    variety: 'arabica',
    ring: plotRing([75.339, 13.2345], 95, 85, 4),
    scenario: 'Forest cleared after 2020: every payment refused',
  },
];

export const contract = { id: 'contract-nordlicht-2026', commodity: 'coffee', season: SEASON, currency: 'USD' };

export { areaHa, VARIETIES, type Variety } from '../season-terms';

export const plotValueCents = (plot: SeedPlot) => termsValueCents(plot.variety, plot.ring);
