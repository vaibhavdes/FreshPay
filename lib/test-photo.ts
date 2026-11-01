import type { SupplierKind } from './engine/gate';
import type { PlotMilestone } from './engine/stateMachine';
import { INR_PER_USD } from './season-terms';

// Ready-made evidence for testers who are not on a farm: a real photo of the stage with today's
// code and the stage's bills laid over it, each set up to show one outcome of the checks.
export type TestScenario = 'pays' | 'old-bill' | 'other-seller' | 'reused-bill' | 'no-code';

export const SCENARIOS: Record<TestScenario, { label: string; outcome: string }> = {
  pays: { label: 'Fresh bills', outcome: 'Paid at once' },
  'old-bill': { label: 'Bill from last season', outcome: 'Held for the field officer' },
  'other-seller': { label: "Another shop's bill", outcome: 'Held for the field officer' },
  'reused-bill': { label: 'A bill already paid', outcome: 'Refused' },
  'no-code': { label: "Without today's code", outcome: 'Refused' },
};

export type Currency = 'INR' | 'USD';
export type StageBill = { kind: SupplierKind; issuer: string; capCents: number };
export type PaidBill = { kind: SupplierKind; issuer: string; number: string; cents: number };
export type PrintedBill = { kind: SupplierKind; issuer: string; title: string; number: string; date: string; amount: number; currency: Currency };

type Titles = Partial<Record<PlotMilestone, Partial<Record<SupplierKind, string>>>>;

const TITLES: Record<string, Titles> = {
  coffee: {
    INPUTS: { INPUTS: 'Fertiliser: urea and potash', LABOUR: 'Labour: manuring' },
    CROP_CARE: { INPUTS: 'Fungicide: Bordeaux mixture', LABOUR: 'Labour: spraying' },
    HARVEST: { LABOUR: 'Wages: cherry picking' },
    PROCESSING: { MACHINERY: 'Pulper and lorry hire' },
  },
  potato: {
    INPUTS: { INPUTS: 'Seed potatoes and DAP', LABOUR: 'Labour: planting' },
    CROP_CARE: { INPUTS: 'Fungicide: mancozeb', LABOUR: 'Labour: spraying' },
    HARVEST: { LABOUR: 'Wages: digging and grading', MACHINERY: 'Tractor digger hire' },
    PROCESSING: { MACHINERY: 'Truck hire to the factory' },
  },
  cotton: {
    INPUTS: { INPUTS: 'Cotton seed and fertiliser', LABOUR: 'Labour: sowing' },
    CROP_CARE: { INPUTS: 'Pesticide: neem oil', LABOUR: 'Labour: spraying' },
    HARVEST: { LABOUR: 'Wages: cotton picking' },
    PROCESSING: { MACHINERY: 'Transport to the gin' },
  },
  cocoa: {
    INPUTS: { INPUTS: 'Shade tree seedlings', LABOUR: 'Labour: pruning' },
    CROP_CARE: { INPUTS: 'Copper fungicide', LABOUR: 'Labour: pod sanitation' },
    HARVEST: { LABOUR: 'Wages: pod harvest' },
    PROCESSING: { MACHINERY: 'Transport to the cooperative', LABOUR: 'Labour: fermenting and drying' },
  },
};

const OTHER_SELLER: Record<string, string> = {
  coffee: 'Cauvery Fertiliser Depot',
  potato: 'Palanpur Fertiliser Depot',
  cotton: 'Barwani Agro Kendra',
  cocoa: 'Agroinsumos Tarapoto',
};

export const currencyOf = (country: string): Currency => (country === 'IN' ? 'INR' : 'USD');

// An amount in the bill's currency that converts back to exactly these cents, so a reprinted
// bill reads as the same bill.
export function amountFor(cents: number, currency: Currency): number {
  if (currency === 'USD') return cents / 100;
  const near = Math.round((cents * INR_PER_USD) / 100);
  return [near, near - 1, near + 1].find((r) => Math.round((r / INR_PER_USD) * 100) === cents) ?? near;
}

export const formatBillAmount = (amount: number, currency: Currency) =>
  currency === 'INR' ? `₹${amount.toLocaleString('en-IN')}` : `US$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function scenariosFor(stageBills: StageBill[], reused: PaidBill | null): TestScenario[] {
  if (!stageBills.length) return ['pays', 'no-code'];
  return ['pays', 'old-bill', 'other-seller', ...(reused ? (['reused-bill'] as const) : []), 'no-code'];
}

type BillsInput = {
  scenario: TestScenario;
  commodity: string;
  currency: Currency;
  milestone: PlotMilestone;
  stageBills: StageBill[];
  reused: PaidBill | null;
  code: string;
  opensAt: number;
  now: number;
};

export function testBills({ scenario, commodity, currency, milestone, stageBills, reused, code, opensAt, now }: BillsInput): PrintedBill[] {
  const title = (kind: SupplierKind) => TITLES[commodity]?.[milestone]?.[kind] ?? 'Bill';
  if (scenario === 'reused-bill' && reused) {
    return [{ kind: reused.kind, issuer: reused.issuer, title: title(reused.kind), number: reused.number, date: isoDay(now), amount: amountFor(reused.cents, currency), currency }];
  }
  const date = isoDay(scenario === 'old-bill' ? opensAt - 120 * 86_400_000 : now);
  return stageBills.map((bill, i) => ({
    kind: bill.kind,
    issuer: scenario === 'other-seller' && i === 0 ? (OTHER_SELLER[commodity] ?? OTHER_SELLER.coffee) : bill.issuer,
    title: title(bill.kind),
    number: `${code}-${i + 1}`,
    date,
    amount: amountFor(Math.floor(bill.capCents * 0.9), currency),
    currency,
  }));
}

export const testFileName = (stageTitle: string, scenario: TestScenario) => `${stageTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${scenario}.jpg`;

// Bill fingerprints keep the issuer as lower-case words, e.g. "malnad agro inputs".
export function paidBillFrom(fingerprint: string): PaidBill | null {
  const [kind, issuer, number, cents] = fingerprint.split('|');
  if (!issuer || !number || !/^\d+$/.test(cents ?? '') || /^\d{4}-\d{2}-\d{2}$/.test(number)) return null;
  return { kind: kind as SupplierKind, issuer: issuer.replace(/\b\w/g, (c) => c.toUpperCase()), number, cents: Number(cents) };
}
