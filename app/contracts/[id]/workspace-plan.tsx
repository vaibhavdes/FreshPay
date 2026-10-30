'use client';

import { useState } from 'react';
import { formatUsd } from '@/lib/format';

type Props = { buyerId: string; status: string | null; priceCents: number; returnTo: string };

export function WorkspacePlan({ buyerId, status, priceCents, returnTo }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'ACTIVE') return <span className="rounded-full bg-leaf-wash px-3 py-1 text-sm font-semibold text-leaf">Workspace plan active</span>;

  async function subscribe() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/buyers/${buyerId}/subscription`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnTo }) });
    const body = (await res.json().catch(() => ({}))) as { approveUrl?: string; error?: string };
    if (body.approveUrl) window.location.href = body.approveUrl;
    else {
      setBusy(false);
      setError(body.error ?? 'PayPal could not start the subscription.');
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button type="button" onClick={subscribe} disabled={busy} className="rounded-md border border-canopy/25 px-3 py-1.5 text-sm font-semibold hover:border-canopy disabled:opacity-50">
        {busy ? 'Opening PayPal' : `Start the workspace plan, ${formatUsd(priceCents)} a month`}
      </button>
      {status === 'APPROVAL_PENDING' && <span className="text-xs text-canopy-soft">Waiting for PayPal approval</span>}
      {error && <span className="text-sm text-cherry">{error}</span>}
    </span>
  );
}
