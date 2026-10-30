import { ringAreaHectares, type LngLat } from '../engine/geo';
import type { PlotMilestone } from '../engine/stateMachine';

// A small quadrilateral around a centre point; slightly irregular so plots don't look generated.
function plotRing([lng, lat]: LngLat, widthM: number, heightM: number, skewM = 0): LngLat[] {
  const toLng = (m: number) => m / (111_320 * Math.cos((lat * Math.PI) / 180));
  const toLat = (m: number) => m / 110_574;
  const w = widthM / 2;
  const h = heightM / 2;
  const corners: [number, number][] = [
    [-w, -h],
    [w, -h + skewM],
    [w * 0.92, h],
    [-w * 1.06, h - skewM],
  ];
  return corners.map(([x, y]) => [Number((lng + toLng(x)).toFixed(6)), Number((lat + toLat(y)).toFixed(6))]);
}

export const SEASON = '2026-27';
export const PRICE_CENTS_PER_KG = 420;
export const YIELD_KG_PER_HA = 900;
export const ADVANCE_PERCENT = 40;
export const VERIFIED_PLOT_CENTS = 2500;
export const INPUTS_PERCENT = 10;
export const HARVEST_PERCENT = 20;
export const DEALER_SHARE_OF_INPUTS = 60;

export const WINDOWS: Record<PlotMilestone, { opensAt: string; closesAt: string }> = {
  PLOT_VERIFIED: { opensAt: '2026-10-15', closesAt: '2026-12-31' },
  INPUTS: { opensAt: '2026-11-01', closesAt: '2027-01-31' },
  HARVEST: { opensAt: '2026-12-01', closesAt: '2027-03-15' },
};

export const buyer = { id: 'buyer-eu-roaster', name: 'Nordlicht Kaffee GmbH', country: 'DE' };

export const cooperatives = [
  { id: 'coop-chikkamagaluru', name: 'Malnad Coffee Growers FPO', region: 'Chikkamagaluru, Karnataka', country: 'IN' },
  { id: 'coop-jaen', name: 'Cooperativa Cafetalera Jaén', region: 'Jaén, Cajamarca', country: 'PE' },
  { id: 'coop-jambi', name: 'Koperasi Karet Jambi', region: 'Jambi, Sumatra', country: 'ID' },
];

export const dealer = { id: 'dealer-malnad-agro', name: 'Malnad Agro Inputs' };

export const farmers = [
  { id: 'farmer-lakshmi', cooperativeId: 'coop-chikkamagaluru', name: 'Lakshmi Gowda' },
  { id: 'farmer-ravi', cooperativeId: 'coop-chikkamagaluru', name: 'Ravi Shetty' },
  { id: 'farmer-manjunath', cooperativeId: 'coop-chikkamagaluru', name: 'Manjunath Hegde' },
  { id: 'farmer-savitha', cooperativeId: 'coop-chikkamagaluru', name: 'Savitha Poojary' },
  { id: 'farmer-kiran', cooperativeId: 'coop-chikkamagaluru', name: 'Kiran Naik' },
  { id: 'farmer-deepa', cooperativeId: 'coop-chikkamagaluru', name: 'Deepa Bhat' },
  { id: 'farmer-rosa', cooperativeId: 'coop-jaen', name: 'Rosa Huamán' },
  { id: 'farmer-budi', cooperativeId: 'coop-jambi', name: 'Budi Santoso' },
];

type SeedPlot = { id: string; farmerId: string; name: string; country: string; commodity: string; ring: LngLat[]; inContract: boolean };

const plot = (id: string, farmerId: string, name: string, centre: LngLat, w: number, h: number, skew: number, extra: Partial<SeedPlot> = {}): SeedPlot => ({
  id,
  farmerId,
  name,
  country: 'IN',
  commodity: 'coffee',
  ring: plotRing(centre, w, h, skew),
  inContract: true,
  ...extra,
});

export const plots: SeedPlot[] = [
  plot('plot-aldur-1', 'farmer-lakshmi', 'Aldur upper estate', [75.6401, 13.2752], 140, 120, 8),
  plot('plot-aldur-2', 'farmer-lakshmi', 'Aldur stream block', [75.6452, 13.2718], 95, 90, -5),
  plot('plot-mudigere-1', 'farmer-ravi', 'Mudigere ridge', [75.6405, 13.1368], 150, 125, 10),
  plot('plot-balehonnur-1', 'farmer-manjunath', 'Balehonnur main', [75.4622, 13.3551], 120, 110, 6),
  plot('plot-balehonnur-2', 'farmer-manjunath', 'Balehonnur lower', [75.4675, 13.359], 80, 75, -4),
  // Sits on ~2.4 ha of tree cover lost in 2024 (GFW/UMD, found with npm run find-loss), so it fails the EUDR check.
  plot('plot-kalasa-1', 'farmer-savitha', 'Kalasa new clearing', [75.339, 13.2345], 130, 115, 7),
  plot('plot-koppa-1', 'farmer-kiran', 'Koppa shade grove', [75.3582, 13.5348], 135, 110, -6),
  plot('plot-sringeri-1', 'farmer-deepa', 'Sringeri road block', [75.2551, 13.4183], 100, 95, 5),
  plot('plot-jaen-1', 'farmer-rosa', 'Finca La Palma', [-78.8085, -5.7071], 120, 100, 6, { country: 'PE', inContract: false }),
  plot('plot-jambi-1', 'farmer-budi', 'Kebun Karet Muara', [103.6131, -1.6101], 160, 130, -8, { country: 'ID', commodity: 'rubber', inContract: false }),
];

export const contract = { id: 'contract-nordlicht-2026', commodity: 'coffee', season: SEASON, currency: 'USD' };

export const areaHa = (ring: readonly LngLat[]) => Math.round(ringAreaHectares(ring) * 100) / 100;

// Expected green coffee value of a plot, in whole dollars so every tranche is a clean amount.
export const plotValueCents = (ring: readonly LngLat[]) => Math.round((areaHa(ring) * YIELD_KG_PER_HA * PRICE_CENTS_PER_KG) / 100) * 100;
