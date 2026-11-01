'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BILL_LABEL, REASON_COPY } from '@/lib/claim-copy';
import type { GateDecision, SupplierKind } from '@/lib/engine/gate';

type Result = { decision?: GateDecision; payoutBatchId?: string; error?: string | { issue: string } };

// billKinds: the kinds of bill the officer must read off the photo because the AI couldn't.
export function ReviewActions({ milestoneId, amount, billKinds = [] }: { milestoneId: string; amount: string; billKinds?: SupplierKind[] }) {
  const [billRupees, setBillRupees] = useState<Partial<Record<SupplierKind, string>>>({});
  const entered = Object.fromEntries(Object.entries(billRupees).flatMap(([kind, value]) => (Number(value) > 0 ? [[kind, Number(value)]] : [])));
  const needsBill = billKinds.length > 0 && Object.keys(entered).length === 0;
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'refuse' | null>(null);
  const [message, setMessage] = useState<{ tone: 'leaf' | 'cherry'; text: string } | null>(null);

  async function review(action: 'approve' | 'refuse') {
    setBusy(action);
    setMessage(null);
    const res = await fetch(`/api/milestones/${milestoneId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, note: note || undefined, billRupees: billKinds.length ? entered : undefined }),
    });
    const body = (await res.json()) as Result;
    setBusy(null);

    const decision = body.decision;
    if (decision?.kind === 'RELEASE' && !body.error) setMessage({ tone: 'leaf', text: `Approved. ${amount} sent with PayPal${body.payoutBatchId ? `, reference ${body.payoutBatchId}` : ''}.` });
    else if (decision?.kind === 'RELEASE') setMessage({ tone: 'cherry', text: `Approved, but PayPal did not accept the payout yet${typeof body.error === 'object' ? ` (${body.error.issue})` : ''}. Try again shortly.` });
    else if (decision?.kind === 'REJECT' && action === 'refuse') setMessage({ tone: 'leaf', text: 'Refused. The farmer has been asked for new evidence.' });
    else if (decision?.kind === 'REJECT') setMessage({ tone: 'cherry', text: decision.reasons.map((r) => REASON_COPY[r]).join(' ') });
    else if (decision?.kind === 'DEDUPED') setMessage({ tone: 'leaf', text: 'This payment was already sent.' });
    else setMessage({ tone: 'cherry', text: typeof body.error === 'string' ? body.error : 'The review could not be saved. Try again.' });
    router.refresh();
  }

  return (
    <div className="mt-6 border-t border-contour pt-5">
      {billKinds.length > 0 && (
        <fieldset className="mb-4">
          <legend className="font-semibold">Totals on the bills (₹)</legend>
          <div className="mt-1 flex flex-wrap gap-4">
            {billKinds.map((kind) => (
              <label key={kind} className="block text-canopy-soft first-letter:uppercase">
                {BILL_LABEL[kind]}
                <input
                  type="number"
                  min="1"
                  inputMode="decimal"
                  value={billRupees[kind] ?? ''}
                  onChange={(e) => setBillRupees({ ...billRupees, [kind]: e.target.value })}
                  className="mt-1 block w-48 rounded-md border border-contour bg-survey px-3 py-2 text-canopy"
                />
              </label>
            ))}
          </div>
          <span className="mt-1 block text-canopy-soft">The AI couldn&apos;t read them. Each supplier is paid their bill, up to the stage&apos;s cap. Leave a box empty if there is no such bill.</span>
        </fieldset>
      )}
      <label className="block text-canopy-soft" htmlFor={`note-${milestoneId}`}>
        Note for the record (optional)
      </label>
      <textarea
        id={`note-${milestoneId}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded-md border border-contour bg-survey px-3 py-2"
      />
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" onClick={() => review('approve')} disabled={busy !== null || needsBill} className="rounded-md bg-leaf px-5 py-3 font-semibold text-sheet hover:bg-canopy disabled:opacity-50">
          {busy === 'approve' ? 'Paying' : `Approve and pay ${amount}`}
        </button>
        <button type="button" onClick={() => review('refuse')} disabled={busy !== null} className="rounded-md border border-canopy/25 px-5 py-3 font-semibold hover:border-canopy disabled:opacity-50">
          Refuse
        </button>
      </div>
      {message && (
        <p role="status" className={`mt-4 rounded-md px-4 py-3 ${message.tone === 'leaf' ? 'bg-leaf-wash' : 'bg-cherry-wash text-cherry'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
