import type { SupplierKind } from './engine/gate';
import type { PlotMilestone } from './engine/stateMachine';
import { INR_PER_USD } from './season-terms';

// Sandbox testers are rarely on a coffee farm with a fertiliser bill. These scenarios build the
// evidence a farmer would photograph (today's code on paper and the stage's bills) over a real
// photo of the stage, each set up to show one outcome of the checks.
export type TestScenario = 'pays' | 'old-bill' | 'other-seller' | 'reused-bill' | 'no-code';

export const SCENARIOS: Record<TestScenario, { label: string; outcome: string }> = {
  pays: { label: 'Fresh bills', outcome: 'Paid at once' },
  'old-bill': { label: 'Bill from last season', outcome: 'Held for the field officer' },
  'other-seller': { label: "Another shop's bill", outcome: 'Held for the field officer' },
  'reused-bill': { label: 'A bill already paid', outcome: 'Refused' },
  'no-code': { label: "Without today's code", outcome: 'Refused' },
};

export type StageBill = { kind: SupplierKind; issuer: string; capCents: number };
// A bill already paid on this contract, as recorded: enough to print the same bill again.
export type PaidBill = { kind: SupplierKind; issuer: string; number: string; cents: number };
export type PrintedBill = { kind: SupplierKind; issuer: string; title: string; number: string; date: string; rupees: number };

const TITLES: Partial<Record<PlotMilestone, Partial<Record<SupplierKind, string>>>> = {
  INPUTS: { INPUTS: 'Fertiliser: urea and potash', LABOUR: 'Labour: manuring' },
  CROP_CARE: { INPUTS: 'Fungicide: Bordeaux mixture', LABOUR: 'Labour: spraying' },
  HARVEST: { LABOUR: 'Wages: cherry picking' },
  PROCESSING: { MACHINERY: 'Pulper and lorry hire' },
};

export const OTHER_SELLER = 'Cauvery Fertiliser Depot';

// Whole rupees that convert back to exactly these cents at the contract's rate, so a reprinted
// bill reads as the same bill.
export function rupeesFor(cents: number): number {
  const near = Math.round((cents * INR_PER_USD) / 100);
  return [near, near - 1, near + 1].find((r) => Math.round((r / INR_PER_USD) * 100) === cents) ?? near;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function scenariosFor(stageBills: StageBill[], reused: PaidBill | null): TestScenario[] {
  if (!stageBills.length) return ['pays', 'no-code'];
  return ['pays', 'old-bill', 'other-seller', ...(reused ? (['reused-bill'] as const) : []), 'no-code'];
}

export function testBills({ scenario, milestone, stageBills, reused, code, opensAt, now }: { scenario: TestScenario; milestone: PlotMilestone; stageBills: StageBill[]; reused: PaidBill | null; code: string; opensAt: number; now: number }): PrintedBill[] {
  const title = (kind: SupplierKind) => TITLES[milestone]?.[kind] ?? 'Bill';
  if (scenario === 'reused-bill' && reused) {
    return [{ kind: reused.kind, issuer: reused.issuer, title: title(reused.kind), number: reused.number, date: isoDay(now), rupees: rupeesFor(reused.cents) }];
  }
  const date = isoDay(scenario === 'old-bill' ? opensAt - 120 * 86_400_000 : now);
  return stageBills.map((bill, i) => ({
    kind: bill.kind,
    issuer: scenario === 'other-seller' && i === 0 ? OTHER_SELLER : bill.issuer,
    title: title(bill.kind),
    number: `${code}-${i + 1}`,
    date,
    // Under the cap, as a real bill for the stage would be.
    rupees: Math.floor(((bill.capCents * 0.9) / 100) * INR_PER_USD),
  }));
}

// A file name that says what the photo is for, e.g. fertiliser-round-old-bill.jpg.
export const testFileName = (stageTitle: string, scenario: TestScenario) => `${stageTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${scenario}.jpg`;

// Title-cases the issuer words a bill fingerprint keeps, e.g. "malnad agro inputs".
export function paidBillFrom(fingerprint: string): PaidBill | null {
  const [kind, issuer, number, cents] = fingerprint.split('|');
  if (!issuer || !number || !/^\d+$/.test(cents ?? '') || /^\d{4}-\d{2}-\d{2}$/.test(number)) return null;
  return { kind: kind as SupplierKind, issuer: issuer.replace(/\b\w/g, (c) => c.toUpperCase()), number, cents: Number(cents) };
}
