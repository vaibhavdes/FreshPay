'use client';

import { useState } from 'react';
import { formatUsd } from '@/lib/format';
import type { CheatResult } from '@/lib/services/cheats';

const OUTCOME = {
  WOULD_PAY: { label: 'Would be paid', tone: 'bg-leaf-wash text-canopy' },
  REFUSED: { label: 'Refused', tone: 'bg-cherry-wash text-cherry' },
  HELD: { label: 'Held for a person', tone: 'bg-monsoon-wash text-canopy' },
  NOT_RUN: { label: "Couldn't run", tone: 'bg-survey text-canopy-soft' },
} as const;

export function CheatPanel() {
  const [results, setResults] = useState<CheatResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/sandbox/cheats', { method: 'POST' });
      if (!res.ok) throw new Error();
      setResults(((await res.json()) as { results: CheatResult[] }).results);
    } catch {
      setError("The attempts couldn't run. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const stopped = results?.filter((r) => r.id !== 'honest' && (r.outcome === 'REFUSED' || r.outcome === 'HELD')).length ?? 0;
  const cheats = results?.filter((r) => r.id !== 'honest').length ?? 0;

  return (
    <section className="mt-10 rounded-xl border border-contour bg-sheet p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-xl font-bold">Try to cheat it</h2>
          <p className="mt-1 text-canopy-soft">
            Eleven ways someone might try to get paid without doing the work, plus one honest claim. Each runs through the same checks that pay farmers, on a
            throwaway season, so nothing is recorded and no money moves.
          </p>
        </div>
        <button type="button" onClick={run} disabled={busy} className="rounded-md bg-leaf px-5 py-2.5 font-semibold text-sheet hover:bg-canopy disabled:opacity-60">
          {busy ? 'Running…' : results ? 'Run them again' : 'Run all 12'}
        </button>
      </div>
      {error && <p className="mt-4 rounded-md bg-cherry-wash px-4 py-3 text-cherry">{error}</p>}
      {results && (
        <>
          <p className="mt-5 font-semibold">
            {stopped} of {cheats} cheats stopped. Money paid to cheats: {formatUsd(0)}.
          </p>
          <ul className="mt-3 divide-y divide-contour border-y border-contour">
            {results.map((r) => (
              <li key={r.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-start">
                <div>
                  <p className="font-semibold">{r.title}</p>
                  <p className="text-sm text-canopy-soft">{r.attempt}</p>
                  <p className="mt-1 text-sm">{r.caught}</p>
                  {r.reasons.length > 0 && <p className="mt-1 font-mono text-xs text-canopy-soft">{r.reasons.join(' · ')}</p>}
                </div>
                <span className={`justify-self-start rounded-full px-3 py-1 text-sm font-semibold sm:justify-self-end ${OUTCOME[r.outcome].tone}`}>
                  {OUTCOME[r.outcome].label}
                  {r.outcome === 'WOULD_PAY' && `: ${formatUsd(r.cents)}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
