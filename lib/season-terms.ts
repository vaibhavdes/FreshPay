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

export const VARIETIES: Record<Variety, { yieldKgPerHa: number; cleanPriceCentsPerKg: number; harvest: { opensAt: string; closesAt: string } }> = {
  // Rs 24,400 per 50 kg parchment / 0.8 / 95.37 = US$6.40 per kg clean coffee
  arabica: { yieldKgPerHa: 783, cleanPriceCentsPerKg: 640, harvest: { opensAt: '2026-11-01', closesAt: '2027-01-31' } },
  // Rs 10,100 per 50 kg cherry / 0.5 / 95.37 = US$4.24 per kg clean coffee
  robusta: { yieldKgPerHa: 1052, cleanPriceCentsPerKg: 424, harvest: { opensAt: '2026-12-01', closesAt: '2027-02-28' } },
};

export const SEASON = '2026-27';
export const ADVANCE_PERCENT = 40;
export const VERIFIED_PLOT_CENTS = 2500;
// Bill stages: the supplier on the bill is paid up to the cap, and the farmer keeps a fixed share.
export const FERTILISER = { capPercent: 6, labourPercent: 4, payeeKinds: ['INPUTS'] as SupplierKind[] };
export const CROP_CARE = { capPercent: 3, labourPercent: 2, payeeKinds: ['INPUTS', 'LABOUR'] as SupplierKind[] };
// Picking is mostly hired labour; pulping and transport are machinery hire.
export const HARVEST = { capPercent: 8, labourPercent: 12, payeeKinds: ['LABOUR', 'MACHINERY'] as SupplierKind[] };
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
});

export const areaHa = (ring: readonly LngLat[]) => Math.round(ringAreaHectares(ring) * 100) / 100;

// Expected clean-coffee value of a plot, in whole dollars so every tranche is a clean amount.
export function plotValueCents(variety: Variety, ring: readonly LngLat[]): number {
  const { yieldKgPerHa, cleanPriceCentsPerKg } = VARIETIES[variety];
  return Math.round((areaHa(ring) * yieldKgPerHa * cleanPriceCentsPerKg) / 100) * 100;
}

// The paid stages of one plot under these terms.
export type Suppliers = Partial<Record<SupplierKind, string>> & { INPUTS: string };

export function plotMilestones({ contractId, plotId, farmerId, suppliers, variety, valueCents }: { contractId: string; plotId: string; farmerId: string; suppliers: Suppliers; variety: Variety; valueCents: number }) {
  const percent = (p: number) => Math.round((valueCents * p) / 100);
  const billStage = ({ capPercent, labourPercent, payeeKinds }: { capPercent: number; labourPercent: number; payeeKinds: SupplierKind[] }) => {
    const dealerId = payeeKinds.map((k) => suppliers[k]).find(Boolean) ?? suppliers.INPUTS;
    const rule: BillRule = { kind: 'BILL', capCents: percent(capPercent), labourCents: percent(labourPercent), dealerId, farmerId, payeeKinds };
    return { cents: rule.capCents + rule.labourCents, shares: [{ id: dealerId, weight: capPercent }, { id: farmerId, weight: labourPercent }], rule };
  };
  const tranche: Record<PlotMilestone, { cents: number; shares: { id: string; weight: number }[]; rule?: BillRule }> = {
    PLOT_VERIFIED: { cents: VERIFIED_PLOT_CENTS, shares: [{ id: farmerId, weight: 1 }] },
    INPUTS: billStage(FERTILISER),
    CROP_CARE: billStage(CROP_CARE),
    HARVEST: billStage(HARVEST),
  };
  const window = windows(variety);
  return PLOT_MILESTONES.map((type) => ({
    id: `${plotId}-${type.toLowerCase()}`,
    contractId,
    plotId,
    type,
    state: 'PENDING' as const,
    opensAt: Date.parse(`${window[type].opensAt}T00:00:00Z`),
    closesAt: Date.parse(`${window[type].closesAt}T23:59:59Z`),
    trancheCents: tranche[type].cents,
    shares: tranche[type].shares,
    rule: tranche[type].rule ?? null,
  }));
}
