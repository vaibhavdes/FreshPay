import { ringAreaHectares, type LngLat } from './engine/geo';
import type { BillRule, SupplierKind } from './engine/gate';
import { PLOT_MILESTONES, type PlotMilestone } from './engine/stateMachine';

// The 2026-27 coffee season's contract terms: what a plot is worth and how its value is paid out.
//
// Sources
//  Yield, clean coffee kg/ha, Chikkamagaluru 2023-24 provisional: Coffee Board of India, Database on
//    Coffee, July 2024, Table 1.10 (Arabica 783, Robusta 1,052).
//  Prices, 28 Oct 2026, per 50 kg bag: Arabica parchment Rs 24,000-24,800, Robusta cherry
//    Rs 9,700-10,500 (Karnataka trade reports; cross-checked with The Hindu BusinessLine, 25 Sep 2026),
//    at Rs 95.37 per USD (FBIL reference rate, RBI, 29 Oct 2026). Converted to clean coffee with
//    parchment 0.8 and dry cherry 0.5 (World Bank FAU-14).
//  Calendar: CCRI Balehonnur cultivation guide; Coffee Board rainfall insurance circular (2013):
//    post-monsoon manuring Aug-Nov, pest and disease control after the monsoon (Sep-Dec),
//    Arabica harvest Nov-Jan, Robusta harvest Dec-Feb.
//  Inputs: about 10% of a hectare's crop value (Pradeepa Babu et al., Economic Affairs 64(4), 2019).

export type Variety = 'arabica' | 'robusta';

type Window = { opensAt: string; closesAt: string };

export const VARIETIES: Record<Variety, { yieldKgPerHa: number; cleanPriceCentsPerKg: number; harvest: Window; processing: Window }> = {
  // Rs 24,400 per 50 kg parchment / 0.8 / 95.37 = US$6.40 per kg clean coffee
  arabica: { yieldKgPerHa: 783, cleanPriceCentsPerKg: 640, harvest: { opensAt: '2026-11-01', closesAt: '2027-01-31' }, processing: { opensAt: '2026-12-01', closesAt: '2027-02-28' } },
  // Rs 10,100 per 50 kg cherry / 0.5 / 95.37 = US$4.24 per kg clean coffee
  robusta: { yieldKgPerHa: 1052, cleanPriceCentsPerKg: 424, harvest: { opensAt: '2026-12-01', closesAt: '2027-02-28' }, processing: { opensAt: '2027-01-01', closesAt: '2027-03-31' } },
};

export const SEASON = '2026-27';
export const ADVANCE_PERCENT = 40;
export const VERIFIED_PLOT_CENTS = 2500;
// Bill stages, as shares of a farm's crop value: each kind of bill is paid up to its cap, and the
// farmer keeps a fixed share. Together with the $25 mapping payment they stay inside the 40% fund.
export type BillStageTerms = { caps: Partial<Record<SupplierKind, number>>; farmerPercent: number };
export const FERTILISER: BillStageTerms = { caps: { INPUTS: 6, LABOUR: 2 }, farmerPercent: 2 };
export const CROP_CARE: BillStageTerms = { caps: { INPUTS: 3, LABOUR: 1.5 }, farmerPercent: 0.5 };
export const HARVEST: BillStageTerms = { caps: { LABOUR: 10 }, farmerPercent: 5 };
export const PROCESSING: BillStageTerms = { caps: { MACHINERY: 4 }, farmerPercent: 1 };
// FBIL reference rate, RBI, 29 Oct 2026. Dealer bills are in rupees.
export const INR_PER_USD = 95.37;

export function billToUsdCents(bill: { amount: number; currency: string } | null): number | null {
  if (!bill || !(bill.amount > 0)) return null;
  if (bill.currency === 'INR') return Math.round((bill.amount / INR_PER_USD) * 100);
  if (bill.currency === 'USD') return Math.round(bill.amount * 100);
  return null;
}

export const windows = (variety: Variety): Record<PlotMilestone, { opensAt: string; closesAt: string }> => ({
  PLOT_VERIFIED: { opensAt: '2026-10-01', closesAt: '2026-11-30' },
  INPUTS: { opensAt: '2026-08-01', closesAt: '2026-11-30' },
  CROP_CARE: { opensAt: '2026-09-01', closesAt: '2026-12-31' },
  HARVEST: VARIETIES[variety].harvest,
  PROCESSING: VARIETIES[variety].processing,
});

// Everything a season contract fixes for its farms: what a hectare is expected to yield and
// earn, how much is paid ahead, and each stage's name, window and payment rule.
export type StageTerms = { label: string; opensAt: string; closesAt: string } & BillStageTerms;
export type SeasonTerms = {
  crop: string;
  yieldKgPerHa: number;
  priceCentsPerKg: number;
  advancePercent: number;
  stages: Record<PlotMilestone, StageTerms>;
};

const COFFEE_LABELS: Record<PlotMilestone, string> = {
  PLOT_VERIFIED: 'Farm mapped',
  INPUTS: 'Fertiliser round',
  CROP_CARE: 'Pest and disease control',
  HARVEST: 'Harvest: picking',
  PROCESSING: 'Processing and transport',
};
const COFFEE_STAGES: Record<PlotMilestone, BillStageTerms> = {
  PLOT_VERIFIED: { caps: {}, farmerPercent: 0 },
  INPUTS: FERTILISER,
  CROP_CARE,
  HARVEST,
  PROCESSING,
};

export function coffeeTerms(variety: Variety): SeasonTerms {
  const window = windows(variety);
  const stages = Object.fromEntries(PLOT_MILESTONES.map((type) => [type, { label: COFFEE_LABELS[type], ...window[type], ...COFFEE_STAGES[type] }])) as Record<PlotMilestone, StageTerms>;
  return { crop: `coffee (${variety})`, yieldKgPerHa: VARIETIES[variety].yieldKgPerHa, priceCentsPerKg: VARIETIES[variety].cleanPriceCentsPerKg, advancePercent: ADVANCE_PERCENT, stages };
}

export const areaHa = (ring: readonly LngLat[]) => Math.round(ringAreaHectares(ring) * 100) / 100;

// Expected crop value of a plot, in whole dollars so every tranche is a clean amount.
export function termsValueCents(terms: Pick<SeasonTerms, 'yieldKgPerHa' | 'priceCentsPerKg'>, ring: readonly LngLat[]): number {
  return Math.round((areaHa(ring) * terms.yieldKgPerHa * terms.priceCentsPerKg) / 100) * 100;
}

export const plotValueCents = (variety: Variety, ring: readonly LngLat[]) => termsValueCents(coffeeTerms(variety), ring);

// The paid stages of one plot under these terms.
export type Suppliers = Partial<Record<SupplierKind, string>> & { INPUTS: string };

export function plotMilestones({ contractId, plotId, farmerId, suppliers, terms, valueCents }: { contractId: string; plotId: string; farmerId: string; suppliers: Suppliers; terms: SeasonTerms; valueCents: number }) {
  const percent = (p: number) => Math.round((valueCents * p) / 100);
  const billStage = ({ caps, farmerPercent }: BillStageTerms) => {
    const lines = (Object.entries(caps) as [SupplierKind, number][]).flatMap(([kind, cap]) => {
      const payeeId = suppliers[kind];
      return payeeId ? [{ kind, capCents: percent(cap), payeeId }] : [];
    });
    const rule: BillRule = { kind: 'BILL', lines, labourCents: percent(farmerPercent), farmerId };
    const cents = lines.reduce((sum, l) => sum + l.capCents, 0) + rule.labourCents;
    return { cents, shares: [...lines.map((l) => ({ id: l.payeeId, weight: l.capCents })), { id: farmerId, weight: rule.labourCents }], rule };
  };
  return PLOT_MILESTONES.map((type) => {
    const stage = terms.stages[type];
    const tranche = type === 'PLOT_VERIFIED' ? { cents: VERIFIED_PLOT_CENTS, shares: [{ id: farmerId, weight: 1 }], rule: null } : billStage(stage);
    return {
      id: `${plotId}-${type.toLowerCase()}`,
      contractId,
      plotId,
      type,
      label: stage.label,
      state: 'PENDING' as const,
      opensAt: Date.parse(`${stage.opensAt}T00:00:00Z`),
      closesAt: Date.parse(`${stage.closesAt}T23:59:59Z`),
      trancheCents: tranche.cents,
      shares: tranche.shares,
      rule: tranche.rule,
    };
  });
}
