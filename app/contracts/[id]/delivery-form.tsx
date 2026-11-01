'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatUsd } from '@/lib/format';

type Result = { captureCents?: number; voidCents?: number; captureId?: string | null; payoutBatchId?: string | null; error?: string; issue?: string };

const field = 'mt-1 w-full rounded-md border border-contour bg-survey px-3 py-2.5 text-lg';

export function DeliveryForm({ contractId, authorizedCents }: { contractId: string; authorizedCents: number }) {
  const router = useRouter();
  const [form, setForm] = useState({ deliveredKg: '', acceptedKg: '', qualityPercent: '100', carrier: '', trackingNumber: '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  const delivered = Number(form.deliveredKg);
  const accepted = Number(form.acceptedKg);
  const quality = Number(form.qualityPercent);
  const preview =
    delivered > 0 && accepted >= 0 && accepted <= delivered && quality >= 0 && quality <= 100
      ? Math.floor((authorizedCents * accepted * quality) / (delivered * 100))
      : null;

  async function settle(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const res = await fetch(`/api/contracts/${contractId}/delivery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveredKg: delivered, acceptedKg: accepted, qualityPercent: quality, carrier: form.carrier, trackingNumber: form.trackingNumber }),
    });
    setResult((await res.json()) as Result);
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={settle} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="block">
        <span className="text-canopy-soft">Delivered (kg)</span>
        <input required inputMode="numeric" pattern="\d+" value={form.deliveredKg} onChange={set('deliveredKg')} className={field} />
      </label>
      <label className="block">
        <span className="text-canopy-soft">Accepted at QC (kg)</span>
        <input required inputMode="numeric" pattern="\d+" value={form.acceptedKg} onChange={set('acceptedKg')} className={field} />
      </label>
      <label className="block">
        <span className="text-canopy-soft">Quality against contract (%)</span>
        <input required inputMode="numeric" pattern="\d+" value={form.qualityPercent} onChange={set('qualityPercent')} className={field} />
      </label>
      <label className="block">
        <span className="text-canopy-soft">Carrier</span>
        <input required value={form.carrier} onChange={set('carrier')} className={field} />
      </label>
      <label className="block">
        <span className="text-canopy-soft">Tracking number</span>
        <input required value={form.trackingNumber} onChange={set('trackingNumber')} className={`${field} font-mono`} />
      </label>
      <div className="flex flex-col justify-end">
        <button type="submit" disabled={busy || preview === null} className="rounded-md bg-leaf px-5 py-3 text-lg font-semibold text-sheet hover:bg-canopy disabled:opacity-50">
          {busy ? 'Settling' : preview === null ? 'Record the QC result' : `Capture ${formatUsd(preview)} and pay farmers`}
        </button>
      </div>
      {preview !== null && (
        <p className="text-canopy-soft sm:col-span-2 lg:col-span-3">
          {formatUsd(authorizedCents - preview)} of the {formatUsd(authorizedCents)} authorization will be voided.
        </p>
      )}
      {result && (
        <p role="status" className={`rounded-md px-4 py-3 sm:col-span-2 lg:col-span-3 ${result.error ? 'bg-cherry-wash text-cherry' : 'bg-leaf-wash'}`}>
          {result.error
            ? result.error
            : `Captured ${formatUsd(result.captureCents ?? 0)}, voided ${formatUsd(result.voidCents ?? 0)}${result.payoutBatchId ? `, farmers paid, PayPal reference ${result.payoutBatchId}` : ''}.`}
        </p>
      )}
    </form>
  );
}
