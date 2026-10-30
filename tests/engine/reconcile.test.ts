import { describe, expect, it } from 'vitest';
import { reconcile, SEARCH_LAG_MS, type LedgerEntry, type PayPalTransaction } from '@/lib/engine/reconcile';

const NOW = Date.UTC(2026, 10, 3, 12);
const OLD = NOW - SEARCH_LAG_MS - 60_000;

describe('reconcile', () => {
  it('matches captures and refunds by id and payouts by total', () => {
    const ours: LedgerEntry[] = [
      { paypalId: 'CAP-1', kind: 'CAPTURE', cents: 764_700, at: OLD },
      { paypalId: 'REF-1', kind: 'REFUND', cents: 100_000, at: OLD },
      { paypalId: 'BATCH-1', kind: 'PAYOUT', cents: 4_501, at: OLD },
    ];
    const theirs: PayPalTransaction[] = [
      { transactionId: 'CAP-1', eventCode: 'T0006', cents: 764_700, at: OLD },
      { transactionId: 'REF-1', eventCode: 'T1107', cents: -100_000, at: OLD },
      { transactionId: 'ITEM-A', eventCode: 'T0400', cents: -2_701, at: OLD },
      { transactionId: 'ITEM-B', eventCode: 'T0400', cents: -1_800, at: OLD },
    ];
    expect(reconcile(ours, theirs, NOW)).toEqual({
      matched: ['CAP-1', 'REF-1'],
      amountMismatches: [],
      missingAtPayPal: [],
      notYetVisible: [],
      notFromUs: [],
      payouts: { ourCents: 4_501, paypalCents: 4_501, match: true },
    });
  });

  it('flags drift: wrong amounts, entries PayPal never saw, and transactions we did not make', () => {
    const ours: LedgerEntry[] = [
      { paypalId: 'CAP-1', kind: 'CAPTURE', cents: 764_700, at: OLD },
      { paypalId: 'CAP-2', kind: 'CAPTURE', cents: 5_000, at: OLD },
      { paypalId: 'CAP-3', kind: 'CAPTURE', cents: 5_000, at: NOW - 60_000 },
      { paypalId: 'BATCH-NEW', kind: 'PAYOUT', cents: 999, at: NOW - 60_000 },
    ];
    const theirs: PayPalTransaction[] = [
      { transactionId: 'CAP-1', eventCode: 'T0006', cents: 764_000, at: OLD },
      { transactionId: 'OTHER-1', eventCode: 'T0006', cents: 1_000, at: OLD },
    ];
    expect(reconcile(ours, theirs, NOW)).toEqual({
      matched: [],
      amountMismatches: [{ paypalId: 'CAP-1', ourCents: 764_700, paypalCents: 764_000 }],
      missingAtPayPal: ['CAP-2'],
      notYetVisible: ['CAP-3'],
      notFromUs: ['OTHER-1'],
      payouts: { ourCents: 0, paypalCents: 0, match: true },
    });
  });

  it('reports payout totals that disagree', () => {
    const result = reconcile([{ paypalId: 'B', kind: 'PAYOUT', cents: 500, at: OLD }], [{ transactionId: 'I', eventCode: 'T0400', cents: -400, at: OLD }], NOW);
    expect(result.payouts).toEqual({ ourCents: 500, paypalCents: 400, match: false });
  });
});
