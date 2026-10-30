'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatUsd } from '@/lib/format';

type Response = {
  decision?: { kind: 'REFUND'; refundCents: number } | { kind: 'REJECT'; reasons: string[] };
  evidence?: { plots: { plot: string; event: string; totalPrecipitationMm: number; dates: string[] }[] };
  refundId?: string | null;
  error?: string;
};

const REASONS: Record<string, string> = {
  CONTRACT_NOT_RUNNING: 'The season is already finished.',
  NO_WEATHER_EVENT: 'No hail, flood or drought was recorded at these plots in that window.',
  TOO_FEW_PLOTS_AFFECTED: 'Bad weather hit plots carrying less than half of the contract value.',
  NOTHING_TO_REFUND: 'None of the advance is left to refund.',
};

const field = 'mt-1 w-full rounded-md border border-contour bg-survey px-3 py-2.5';

export function ForceMajeureForm({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Response | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const res = await fetch(`/api/contracts/${contractId}/force-majeure`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startDate, endDate }) });
    setResult((await res.json()) as Response);
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <form onSubmit={check} className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="text-canopy-soft">From</span>
          <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className="text-canopy-soft">To</span>
          <input type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} className={field} />
        </label>
        <button type="submit" disabled={busy} className="rounded-md border border-canopy/25 px-5 py-2.5 font-semibold hover:border-canopy disabled:opacity-50">
          {busy ? 'Checking the weather' : 'Check the weather'}
        </button>
      </form>

      {result?.evidence && (
        <table className="mt-6 w-full max-w-2xl text-left">
          <thead className="text-sm text-canopy-soft">
            <tr>
              <th className="py-2 font-medium">Plot</th>
              <th className="py-2 font-medium">Recorded</th>
              <th className="py-2 text-right font-medium">Rain</th>
            </tr>
          </thead>
          <tbody>
            {result.evidence.plots.map((p) => (
              <tr key={p.plot} className="border-t border-contour">
                <td className="py-2">{p.plot}</td>
                <td className={`py-2 ${p.event === 'NONE' ? '' : 'font-semibold text-cherry'}`}>
                  {p.event === 'NONE' ? 'Normal weather' : `${p.event.toLowerCase()} on ${p.dates.join(', ')}`}
                </td>
                <td className="py-2 text-right tabular-nums">{p.totalPrecipitationMm} mm</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result?.decision && (
        <p role="status" className={`mt-4 rounded-md px-4 py-3 ${result.decision.kind === 'REFUND' ? 'bg-leaf-wash' : 'bg-monsoon-wash'}`}>
          {result.decision.kind === 'REFUND'
            ? `Verified. ${formatUsd(result.decision.refundCents)} of unearned advance refunded with PayPal${result.refundId ? `, refund ${result.refundId}` : ''}.`
            : result.decision.reasons.map((r) => REASONS[r] ?? r).join(' ')}
        </p>
      )}
      {result?.error && <p className="mt-4 rounded-md bg-cherry-wash px-4 py-3 text-cherry">{result.error}</p>}
    </div>
  );
}
