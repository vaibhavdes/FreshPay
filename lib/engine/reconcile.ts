export type LedgerEntry = { paypalId: string; kind: 'CAPTURE' | 'REFUND' | 'PAYOUT'; cents: number; at: number };
export type PayPalTransaction = { transactionId: string; eventCode: string; cents: number; at: number };

export type Reconciliation = {
  matched: string[];
  amountMismatches: { paypalId: string; ourCents: number; paypalCents: number }[];
  missingAtPayPal: string[];
  notYetVisible: string[];
  notFromUs: string[];
  payouts: { ourCents: number; paypalCents: number; match: boolean };
};

// Transaction Search can take up to three hours to show a transaction.
export const SEARCH_LAG_MS = 3 * 60 * 60_000;

// Payouts appear in Transaction Search as T04xx debits, one per item, with ids we never see.
const isPayout = (eventCode: string) => eventCode.startsWith('T04');

// Compares what our ledger says happened with what PayPal reports. Captures and refunds match one
// to one by transaction id; payout items are compared as totals because their ids differ.
export function reconcile(ours: readonly LedgerEntry[], theirs: readonly PayPalTransaction[], now: number): Reconciliation {
  const byId = new Map(theirs.filter((t) => !isPayout(t.eventCode)).map((t) => [t.transactionId, t]));
  const result: Reconciliation = { matched: [], amountMismatches: [], missingAtPayPal: [], notYetVisible: [], notFromUs: [], payouts: { ourCents: 0, paypalCents: 0, match: true } };
  const claimed = new Set<string>();

  for (const entry of ours) {
    if (entry.kind === 'PAYOUT') {
      if (now - entry.at >= SEARCH_LAG_MS) result.payouts.ourCents += entry.cents;
      continue;
    }
    const match = byId.get(entry.paypalId);
    if (!match) {
      (now - entry.at < SEARCH_LAG_MS ? result.notYetVisible : result.missingAtPayPal).push(entry.paypalId);
      continue;
    }
    claimed.add(entry.paypalId);
    if (Math.abs(match.cents) === entry.cents) result.matched.push(entry.paypalId);
    else result.amountMismatches.push({ paypalId: entry.paypalId, ourCents: entry.cents, paypalCents: Math.abs(match.cents) });
  }

  result.notFromUs = [...byId.keys()].filter((id) => !claimed.has(id));
  result.payouts.paypalCents = theirs.filter((t) => isPayout(t.eventCode)).reduce((sum, t) => sum + Math.abs(t.cents), 0);
  result.payouts.match = result.payouts.ourCents === result.payouts.paypalCents;
  return result;
}
