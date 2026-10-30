'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { agentReviews } from '@/lib/db/schema';

type Review = typeof agentReviews.$inferSelect;

const VERDICT = {
  APPROVE: { label: 'Recommends approving', tone: 'bg-leaf-wash border-leaf/30' },
  REFUSE: { label: 'Recommends refusing', tone: 'bg-cherry-wash border-cherry/30' },
  UNSURE: { label: 'Not sure: a person should decide', tone: 'bg-monsoon-wash border-monsoon/40' },
} as const;

const TOOL_NAMES: Record<string, string> = {
  getEvidence: 'Read the evidence',
  plotHistory: "Checked the plot's history",
  findReusedPhoto: 'Looked for a reused photo',
  satelliteCheck: 'Checked the satellite result',
  secondLook: 'Took a second look at the photo',
};

export function AgentPanel({ milestoneId, review }: { milestoneId: string; review: Review | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/milestones/${milestoneId}/agent-review`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'The review agent could not finish. Decide from the evidence above.');
      return;
    }
    router.refresh();
  }

  return (
    <section aria-label="Review agent" className="mt-6 border-t border-contour pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold">Review agent</h3>
        <button type="button" onClick={ask} disabled={busy} className="rounded-md border border-canopy/25 px-4 py-2 font-semibold hover:border-canopy disabled:opacity-50">
          {busy ? 'Investigating' : review ? 'Ask again' : 'Ask the agent'}
        </button>
      </div>

      {review ? (
        <div className={`mt-3 rounded-md border px-4 py-3 ${VERDICT[review.recommendation].tone}`}>
          <p className="font-bold">
            {VERDICT[review.recommendation].label}, {review.confidence.toLowerCase()} confidence
          </p>
          <p className="mt-1 leading-relaxed">{review.summary}</p>
          {review.reasons.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {review.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          <details className="mt-3 text-sm text-canopy-soft">
            <summary className="cursor-pointer">What it checked ({review.checks.length})</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              {review.checks.map((check, i) => (
                <li key={i}>
                  {TOOL_NAMES[check.tool] ?? check.tool}: {check.finding}
                </li>
              ))}
            </ol>
            <p className="mt-2">{review.model}. The agent only recommends; your decision and the payment rules decide.</p>
          </details>
        </div>
      ) : (
        <p className="mt-2 text-canopy-soft">The agent investigates held claims and recommends a decision with its reasons.</p>
      )}
      {error && <p className="mt-3 rounded-md bg-cherry-wash px-4 py-3 text-cherry">{error}</p>}
    </section>
  );
}
