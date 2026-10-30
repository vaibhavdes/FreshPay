'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Reconciliation } from '@/lib/engine/reconcile';
import { formatUsd } from '@/lib/format';

type Run = { createdAt: number; result: Reconciliation } | null;

export function BooksCard({ run }: { run: Run }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/reconciliation', { method: 'POST' });
    setBusy(false);
    if (!res.ok) setError('PayPal Transaction Search did not answer. Try again in a minute.');
    router.refresh();
  }

  const r = run?.result;
  const problems = r ? r.amountMismatches.length + r.missingAtPayPal.length + (r.payouts.match ? 0 : 1) : 0;

  return (
    <div>
      {r ? (
        <>
          <p className={`text-lg font-semibold ${problems ? 'text-cherry' : 'text-leaf'}`}>
            {problems ? `${problems} difference(s) between our ledger and PayPal` : 'Our ledger matches PayPal'}
          </p>
          <ul className="mt-3 space-y-1 text-canopy-soft">
            <li>{r.matched.length} captures and refunds matched by transaction id</li>
            <li>
              Payouts: {formatUsd(r.payouts.ourCents)} in our ledger, {formatUsd(r.payouts.paypalCents)} at PayPal
            </li>
            {r.amountMismatches.map((m) => (
              <li key={m.paypalId} className="text-cherry">
                {m.paypalId}: {formatUsd(m.ourCents)} here, {formatUsd(m.paypalCents)} at PayPal
              </li>
            ))}
            {r.missingAtPayPal.length > 0 && <li className="text-cherry">Not found at PayPal: {r.missingAtPayPal.join(', ')}</li>}
            {r.notYetVisible.length > 0 && <li>{r.notYetVisible.length} recent payment(s) not visible in Transaction Search yet (it can lag up to three hours)</li>}
            {r.notFromUs.length > 0 && <li>{r.notFromUs.length} other transaction(s) on the PayPal account that AgriTranche did not make</li>}
          </ul>
          <p className="mt-3 text-sm text-canopy-soft">Last checked {new Date(run.createdAt).toLocaleString()}.</p>
        </>
      ) : (
        <p className="text-canopy-soft">Not checked yet. It runs on a schedule once deployed, or now.</p>
      )}
      <button type="button" onClick={check} disabled={busy} className="mt-4 rounded-md border border-canopy/25 px-4 py-2 font-semibold hover:border-canopy disabled:opacity-50">
        {busy ? 'Checking PayPal' : 'Check now'}
      </button>
      {error && <p className="mt-3 rounded-md bg-cherry-wash px-4 py-3 text-cherry">{error}</p>}
    </div>
  );
}
