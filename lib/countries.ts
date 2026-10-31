import type { LngLat } from './engine/geo';

// Countries whose people can receive USD PayPal Payouts from a foreign buyer, from PayPal's
// Payouts country table (developer.paypal.com/docs/payouts/standard/reference/country-feature,
// Sep 2026), with a rough bounding box to check a farm outline is in the country at all.
export type PayoutCountry = { code: string; name: string; note: string; box: [number, number, number, number] };

export const PAYOUT_COUNTRIES: PayoutCountry[] = [
  { code: 'IN', name: 'India', note: 'Receive and withdraw only; KYC and a purpose code apply', box: [68.1, 6.7, 97.4, 35.7] },
  { code: 'PE', name: 'Peru', note: 'USD, no currency conversion', box: [-81.4, -18.4, -68.6, 0] },
  { code: 'CO', name: 'Colombia', note: 'Cross-border payouts only', box: [-79.1, -4.3, -66.8, 12.5] },
  { code: 'GT', name: 'Guatemala', note: 'USD, no currency conversion', box: [-92.3, 13.7, -88.2, 17.9] },
  { code: 'HN', name: 'Honduras', note: 'USD, no currency conversion', box: [-89.4, 12.9, -83.1, 16.6] },
  { code: 'MX', name: 'Mexico', note: 'Receive only', box: [-117.2, 14.5, -86.7, 32.8] },
  { code: 'KE', name: 'Kenya', note: 'Personal accounts', box: [33.9, -4.8, 41.9, 5.1] },
  { code: 'ID', name: 'Indonesia', note: '', box: [95, -11.1, 141.1, 6.1] },
  { code: 'VN', name: 'Vietnam', note: '', box: [102.1, 8.2, 109.5, 23.4] },
  { code: 'PH', name: 'Philippines', note: '', box: [116.9, 4.5, 126.7, 21.2] },
];

export const payoutCountry = (code: string) => PAYOUT_COUNTRIES.find((c) => c.code === code);

export function insideCountry(ring: readonly LngLat[], code: string): boolean {
  const country = payoutCountry(code);
  if (!country) return false;
  const [west, south, east, north] = country.box;
  return ring.every(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north);
}
