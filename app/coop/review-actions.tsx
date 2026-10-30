'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { REASON_COPY } from '@/lib/claim-copy';
import type { GateDecision } from '@/lib/engine/gate';

type Result = { decision?: GateDecision; payoutBatchId?: string; error?: string | { issue: string } };

export function ReviewActions({ milestoneId, amount, needsBill = false }: { milestoneId: string; amount: string; needsBill?: boolean }) {
  const [billRupees, setBillRupees] = useState('');
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
      body: JSON.stringify({ action, note: note || undefined, billRupees: billRupees ? Number(billRupees) : undefined }),
    });
    const body = (await res.json()) as Result;
    setBusy(null);

    const decision = body.decision;
    if (decision?.kind === 'RELEASE' && !body.error) setMessage({ tone: 'leaf', text: `Approved. ${amount} sent with PayPal${body.payoutBatchId ? `, batch ${body.payoutBatchId}` : ''}.` });
    else if (decision?.kind === 'RELEASE') setMessage({ tone: 'cherry', text: 'Approved, but PayPal did not accept the payout yet. Try again shortly.' });
    else if (decision?.kind === 'REJECT' && action === 'refuse') setMessage({ tone: 'leaf', text: 'Refused. The farmer has been asked for new evidence.' });
    else if (decision?.kind === 'REJECT') setMessage({ tone: 'cherry', text: decision.reasons.map((r) => REASON_COPY[r]).join(' ') });
    else if (decision?.kind === 'DEDUPED') setMessage({ tone: 'leaf', text: 'This payment was already sent.' });
    else setMessage({ tone: 'cherry', text: typeof body.error === 'string' ? body.error : 'The review could not be saved. Try again.' });
    router.refresh();
  }

  return (
    <div className="mt-6 border-t border-contour pt-5">
      {needsBill && (
        <label className="mb-4 block font-semibold">
          Total on the bill (₹)
          <input
            type="number"
            min="1"
            inputMode="decimal"
            value={billRupees}
            onChange={(e) => setBillRupees(e.target.value)}
            className="mt-1 block w-48 rounded-md border border-contour bg-survey px-3 py-2"
          />
          <span className="mt-1 block font-normal text-canopy-soft">The AI couldn&apos;t read it. The dealer is paid this, up to the stage&apos;s cap.</span>
        </label>
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
        <button type="button" onClick={() => review('approve')} disabled={busy !== null || (needsBill && !billRupees)} className="rounded-md bg-leaf px-5 py-3 font-semibold text-sheet hover:bg-canopy disabled:opacity-50">
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
