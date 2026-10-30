'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatUsd } from '@/lib/format';
import { PayPalCheckout } from './paypal-checkout';

type Props = {
  contractId: string;
  mandate: { perPlotCents: number; capCents: number; vaultStatus: 'NONE' | 'PENDING' | 'ACTIVE' | 'UNAVAILABLE' } | null;
  owedCents: number;
  owedPlots: number;
  paidCents: number;
};

const field = 'mt-1 w-full rounded-md border border-contour bg-survey px-3 py-2.5 text-lg';

export function PremiumPanel({ contractId, mandate, owedCents, owedPlots, paidCents }: Props) {
  const router = useRouter();
  const [perPlot, setPerPlot] = useState('40');
  const [cap, setCap] = useState('400');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function post(path: string, body?: object) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/contracts/${contractId}/premium/${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as { approveUrl?: string | null; fallback?: boolean; error?: string };
    setBusy(false);
    return { ok: res.ok, json };
  }

  async function saveMandate(e: React.FormEvent) {
    e.preventDefault();
    const { ok, json } = await post('mandate', { perPlotCents: Math.round(Number(perPlot) * 100), capCents: Math.round(Number(cap) * 100) });
    if (!ok) setMessage(json.error ?? 'The mandate could not be saved.');
    router.refresh();
  }

  async function savePayPal() {
    const { ok, json } = await post('vault');
    if (ok && json.approveUrl) window.location.href = json.approveUrl;
    else if (ok && json.fallback) {
      setMessage('PayPal cannot save payment methods for this merchant account yet, so premiums are paid in one checkout below.');
      router.refresh();
    } else setMessage(json.error ?? 'PayPal could not start saving your payment method.');
  }

  async function chargeNow() {
    const { ok, json } = await post('charge');
    if (!ok) setMessage(json.error ?? 'The premiums could not be charged.');
    router.refresh();
  }

  if (!mandate) {
    return (
      <form onSubmit={saveMandate} className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-canopy-soft">Premium per verified plot ($)</span>
          <input required inputMode="decimal" value={perPlot} onChange={(e) => setPerPlot(e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className="text-canopy-soft">Season cap ($)</span>
          <input required inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} className={field} />
        </label>
        <div className="flex items-end">
          <button type="submit" disabled={busy} className="w-full rounded-md bg-leaf px-5 py-3 text-lg font-semibold text-sheet hover:bg-canopy disabled:opacity-50">
            Approve the mandate
          </button>
        </div>
        {message && <p className="rounded-md bg-cherry-wash px-4 py-3 text-cherry sm:col-span-3">{message}</p>}
      </form>
    );
  }

  return (
    <div>
      <dl className="grid gap-6 sm:grid-cols-3">
        <div className="border-t border-contour pt-3">
          <dt className="text-canopy-soft">Per verified plot</dt>
          <dd className="mt-1 text-2xl font-bold">
            {formatUsd(mandate.perPlotCents)} <span className="text-base font-normal text-canopy-soft">up to {formatUsd(mandate.capCents)}</span>
          </dd>
        </div>
        <div className="border-t border-contour pt-3">
          <dt className="text-canopy-soft">Owed now</dt>
          <dd className="mt-1 text-2xl font-bold">
            {formatUsd(owedCents)} <span className="text-base font-normal text-canopy-soft">for {owedPlots} plot(s)</span>
          </dd>
        </div>
        <div className="border-t border-contour pt-3">
          <dt className="text-canopy-soft">Paid to farmers</dt>
          <dd className="mt-1 text-2xl font-bold text-leaf">{formatUsd(paidCents)}</dd>
        </div>
      </dl>

      <div className="mt-6">
        {mandate.vaultStatus === 'ACTIVE' ? (
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-canopy-soft">Charged automatically from your saved PayPal as each plot is verified.</p>
            {owedCents > 0 && (
              <button type="button" onClick={chargeNow} disabled={busy} className="rounded-md border border-canopy/25 px-4 py-2 font-semibold hover:border-canopy disabled:opacity-50">
                Charge {formatUsd(owedCents)} now
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {mandate.vaultStatus !== 'UNAVAILABLE' && (
              <div>
                <p className="text-canopy-soft">Save PayPal once and premiums are charged automatically as plots are verified, within your cap.</p>
                <button type="button" onClick={savePayPal} disabled={busy} className="mt-3 rounded-md border border-canopy/25 px-4 py-2.5 font-semibold hover:border-canopy disabled:opacity-50">
                  Save PayPal for premiums
                </button>
              </div>
            )}
            {owedCents > 0 && (
              <div>
                <p className="mb-3 text-canopy-soft">Pay the {formatUsd(owedCents)} owed now in one PayPal checkout.</p>
                <PayPalCheckout
                  createPath={`/api/contracts/${contractId}/premium/order`}
                  approvePath={`/api/contracts/${contractId}/premium/capture`}
                  approvedStates={['PAID']}
                  approvedText={`${formatUsd(owedCents)} paid. The premiums are on their way to the farmers.`}
                />
              </div>
            )}
          </div>
        )}
      </div>
      {message && <p className="mt-4 rounded-md bg-monsoon-wash px-4 py-3">{message}</p>}
    </div>
  );
}
