'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { disputes } from '@/lib/db/schema';
import { formatUsd } from '@/lib/format';

type Dispute = typeof disputes.$inferSelect;

function DisputeCard({ dispute }: { dispute: Dispute }) {
  const router = useRouter();
  const [narrative, setNarrative] = useState(dispute.narrative ?? '');
  const [busy, setBusy] = useState<'prepare' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(action: 'prepare' | 'send') {
    setBusy(action);
    setError(null);
    const res = await fetch(`/api/disputes/${dispute.id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'send' ? { narrative } : {}),
    });
    const body = (await res.json().catch(() => ({}))) as { dispute?: Dispute; error?: string };
    setBusy(null);
    if (!res.ok) return setError(body.error ?? 'PayPal did not accept the request. Try again.');
    if (body.dispute?.narrative) setNarrative(body.dispute.narrative);
    router.refresh();
  }

  return (
    <li className="rounded-md border border-contour p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">
          {dispute.reason.toLowerCase().replaceAll('_', ' ')}, {formatUsd(dispute.amountCents)}
        </p>
        <p className="text-canopy-soft">
          {dispute.status.toLowerCase().replaceAll('_', ' ')}
          {dispute.responseDueAt && `, reply by ${new Date(dispute.responseDueAt).toLocaleDateString()}`}
        </p>
      </div>
      <p className="mt-1 font-mono text-sm text-canopy-soft">{dispute.id}</p>

      {dispute.evidenceSentAt ? (
        <p className="mt-4 rounded-md bg-leaf-wash px-4 py-3">Evidence sent to PayPal on {new Date(dispute.evidenceSentAt).toLocaleString()}.</p>
      ) : narrative ? (
        <>
          <label className="mt-4 block text-canopy-soft" htmlFor={`narrative-${dispute.id}`}>
            Response drafted by the dispute agent{dispute.narrativeModel ? ` (${dispute.narrativeModel})` : ''} from your ledger. Edit it if needed.
          </label>
          <textarea
            id={`narrative-${dispute.id}`}
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            rows={8}
            className="mt-1 w-full rounded-md border border-contour bg-survey px-3 py-2 leading-relaxed"
          />
          <button type="button" onClick={() => call('send')} disabled={busy !== null} className="mt-3 rounded-md bg-leaf px-5 py-3 font-semibold text-sheet hover:bg-canopy disabled:opacity-50">
            {busy === 'send' ? 'Sending' : 'Send to PayPal with the evidence photos'}
          </button>
        </>
      ) : (
        <button type="button" onClick={() => call('prepare')} disabled={busy !== null} className="mt-4 rounded-md border border-canopy/25 px-5 py-2.5 font-semibold hover:border-canopy disabled:opacity-50">
          {busy === 'prepare' ? 'Drafting from the ledger' : 'Draft the response'}
        </button>
      )}
      {error && <p className="mt-3 rounded-md bg-cherry-wash px-4 py-3 text-cherry">{error}</p>}
    </li>
  );
}

export function DisputesPanel({ items }: { items: Dispute[] }) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    await fetch('/api/disputes/sync', { method: 'POST' });
    setChecking(false);
    router.refresh();
  }

  return (
    <div>
      <button type="button" onClick={check} disabled={checking} className="rounded-md border border-canopy/25 px-4 py-2 font-semibold hover:border-canopy disabled:opacity-50">
        {checking ? 'Checking PayPal' : 'Check for disputes'}
      </button>
      {items.length ? (
        <ul className="mt-5 space-y-4">
          {items.map((d) => (
            <DisputeCard key={d.id} dispute={d} />
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-canopy-soft">No disputes on this contract.</p>
      )}
    </div>
  );
}
