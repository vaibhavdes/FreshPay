import type { EudrStatus } from './gate';
import { centroid, closeRing, type LngLat } from './geo';

// Reg. (EU) 2023/1115 as amended: no deforestation after 31 Dec 2020.
export const EUDR_CUTOFF = '2020-12-31';

// A few 30 m Landsat pixels of loss can be edge noise, so small amounts go to a human.
export const REVIEW_MAX_LOSS_HA = 0.1;

export type GeoCheck = { lossSince2021Ha: number; source: string; fetchedAt: string };

export function eudrStatus(check: GeoCheck | null): EudrStatus {
  if (!check) return 'REVIEW';
  if (check.lossSince2021Ha <= 0) return 'PASS';
  return check.lossSince2021Ha <= REVIEW_MAX_LOSS_HA ? 'REVIEW' : 'FAIL';
}

const HS_CODES: Record<string, string> = { coffee: '0901', cocoa: '1801', rubber: '4001', soy: '1201', palm: '1511', wood: '4403', cattle: '0102' };

export type EudrRecordInput = {
  plot: { id: string; name: string; ring: readonly LngLat[]; areaHa: number; country: string; commodity: string };
  producer: { name: string; cooperative: string };
  operator: { name: string; country: string };
  check: GeoCheck | null;
  evidence: { milestone: string; sha256: string; verifiedAt: string }[];
  payments: { milestone: string; paypalId: string; cents: number }[];
  generatedAt: string;
};

// One GeoJSON Feature per plot carrying the due-diligence fields an operator files.
export function buildEudrRecord(input: EudrRecordInput) {
  const { plot, producer, operator, check } = input;
  const [lng, lat] = centroid(plot.ring);
  return {
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: [closeRing(plot.ring).map(([x, y]) => [x, y])] },
    properties: {
      plotId: plot.id,
      plotName: plot.name,
      commodity: plot.commodity,
      hsCode: HS_CODES[plot.commodity] ?? null,
      countryOfProduction: plot.country,
      areaHa: Math.round(plot.areaHa * 100) / 100,
      centroid: { lng, lat },
      producer: producer.name,
      cooperative: producer.cooperative,
      operator,
      deforestationCutoff: EUDR_CUTOFF,
      treeCoverLossSince2021Ha: check?.lossSince2021Ha ?? null,
      eudrStatus: eudrStatus(check),
      geoSource: check?.source ?? null,
      geoCheckedAt: check?.fetchedAt ?? null,
      evidence: input.evidence,
      payments: input.payments,
      generatedAt: input.generatedAt,
    },
  };
}
