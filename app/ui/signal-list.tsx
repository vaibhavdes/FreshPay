import { SIGNAL_LABELS, type ProofSignal } from '@/lib/engine/proof';

const MARK = {
  PASS: { symbol: '✓', className: 'bg-leaf text-sheet', label: 'fits' },
  WARN: { symbol: '!', className: 'bg-cherry text-sheet', label: "doesn't fit" },
  UNKNOWN: { symbol: '–', className: 'border border-contour text-canopy-soft', label: 'nothing to check' },
} as const;

// The extra checks behind a claim, one line each: what was checked and what it found.
export function SignalList({ signals }: { signals: readonly ProofSignal[] }) {
  return (
    <ul className="mt-3 space-y-1.5 border-t border-canopy/15 pt-3 text-sm">
      {signals.map((s) => (
        <li key={s.id} className="flex items-start gap-2">
          <span aria-label={MARK[s.status].label} className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-bold ${MARK[s.status].className}`}>
            {MARK[s.status].symbol}
          </span>
          <span>
            <span className="font-semibold">{SIGNAL_LABELS[s.id]}:</span> {s.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}
