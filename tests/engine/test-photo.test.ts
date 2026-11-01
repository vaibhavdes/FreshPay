import { describe, expect, it } from 'vitest';
import { billDateFits, billFingerprint, issuerMatches } from '@/lib/engine/fraud';
import { billToUsdCents } from '@/lib/season-terms';
import { paidBillFrom, rupeesFor, scenariosFor, testBills, testFileName } from '@/lib/test-photo';

const now = Date.parse('2026-11-01T10:00:00Z');
const opensAt = Date.parse('2026-08-01T00:00:00Z');
const stageBills = [
  { kind: 'INPUTS' as const, issuer: 'Malnad Agro Inputs', capCents: 116_000 },
  { kind: 'LABOUR' as const, issuer: 'Kodagu Pickers Group', capCents: 38_700 },
];
const bills = (scenario: Parameters<typeof testBills>[0]['scenario'], reused = null as ReturnType<typeof paidBillFrom>) =>
  testBills({ scenario, milestone: 'INPUTS', stageBills, reused, code: 'K7Q2MX', opensAt, now });
const cents = (rupees: number) => billToUsdCents({ amount: rupees, currency: 'INR' })!;

describe('test photo scenarios', () => {
  it('prints fresh bills under each cap, from the chosen suppliers, dated today', () => {
    const printed = bills('pays');
    expect(printed.map((b) => b.issuer)).toEqual(['Malnad Agro Inputs', 'Kodagu Pickers Group']);
    printed.forEach((b, i) => {
      expect(cents(b.rupees)).toBeLessThanOrEqual(stageBills[i].capCents);
      expect(billDateFits(b.date, opensAt, now)).toBe(true);
      expect(issuerMatches(b.issuer, stageBills[i].issuer)).toBe(true);
    });
  });

  it('dates the old bill before the stage and prints another shop on the other-seller bill', () => {
    expect(bills('old-bill').every((b) => billDateFits(b.date, opensAt, now) === false)).toBe(true);
    expect(issuerMatches(bills('other-seller')[0].issuer, 'Malnad Agro Inputs')).toBe(false);
  });

  it('reprints a paid bill so it has the same fingerprint', () => {
    const paid = billFingerprint({ kind: 'INPUTS', issuer: 'Malnad Agro Inputs', number: 'K7Q2MX-1', cents: 104_400 })!;
    const [again] = bills('reused-bill', paidBillFrom(paid));
    expect(billFingerprint({ kind: again.kind, issuer: again.issuer, number: again.number, cents: cents(again.rupees) })).toBe(paid);
  });

  it('finds whole rupees for any amount in cents', () => {
    for (const c of [1, 99, 104_400, 38_701, 1_234_567]) expect(cents(rupeesFor(c))).toBe(c);
  });

  it('offers bill scenarios only on bill stages, and the reused bill only once one is paid', () => {
    expect(scenariosFor([], null)).toEqual(['pays', 'no-code']);
    expect(scenariosFor(stageBills, null)).not.toContain('reused-bill');
    expect(scenariosFor(stageBills, { kind: 'INPUTS', issuer: 'Malnad Agro', number: 'A1', cents: 5 })).toContain('reused-bill');
    expect(paidBillFrom('INPUTS|malnad agro|2026-10-01|500')).toBeNull();
  });

  it('names the file after the stage and the scenario', () => {
    expect(testFileName('Harvest: picking', 'old-bill')).toBe('harvest-picking-old-bill.jpg');
  });
});
