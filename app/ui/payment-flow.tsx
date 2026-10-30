import { formatUsd } from '@/lib/format';

// Money visibly leaving the season fund for each person on the bill. Lines draw in once; the
// payee rows then show PayPal's status, so nothing happens out of sight.

type Payee = { name: string; role: string; cents: number; status?: string };

const STATUS_TEXT: Record<string, string> = {
  PENDING: 'On its way',
  SUCCESS: 'Received',
  UNCLAIMED: 'Waiting to be claimed in PayPal',
  FAILED: 'Failed at PayPal',
  RETURNED: 'Returned',
};

export function PaymentFlow({ payees, batchId }: { payees: Payee[]; batchId?: string | null }) {
  const rowHeight = 64;
  const height = Math.max(payees.length * rowHeight, rowHeight);
  return (
    <div className="grid grid-cols-[auto_4rem_1fr] items-center gap-2 sm:grid-cols-[auto_6rem_1fr]">
      <div className="rounded-xl bg-canopy px-3 py-2 text-center text-sheet">
        <p className="text-xs opacity-80">Season fund</p>
        <p className="font-bold">PayPal</p>
      </div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden className="h-full w-full" style={{ height }}>
        {payees.map((_, i) => {
          const y = i * rowHeight + rowHeight / 2;
          return (
            <path
              key={i}
              d={`M0 ${height / 2} C 50 ${height / 2}, 50 ${y}, 100 ${y}`}
              pathLength={1}
              className="pay-line"
              style={{ animationDelay: `${i * 220}ms` }}
              fill="none"
              stroke="var(--at-leaf)"
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      <ul className="space-y-2">
        {payees.map((p, i) => (
          <li key={p.name} className="pay-row flex items-center justify-between gap-3 rounded-xl border border-contour bg-sheet px-3 py-2" style={{ animationDelay: `${300 + i * 220}ms`, minHeight: rowHeight - 8 }}>
            <div className="min-w-0">
              <p className="truncate font-semibold">{p.name}</p>
              <p className="text-xs text-canopy-soft">
                {p.role}
                {p.status ? ` · ${STATUS_TEXT[p.status] ?? p.status}` : ''}
              </p>
            </div>
            <p className="font-bold tabular-nums">{formatUsd(p.cents)}</p>
          </li>
        ))}
      </ul>
      {batchId && <p className="col-span-3 mt-1 text-xs text-canopy-soft">PayPal Payouts batch <span className="font-mono">{batchId}</span></p>}
    </div>
  );
}

// The five checks, lit one after another while the proof is being checked.
export function CheckingSteps({ bill }: { bill: boolean }) {
  const steps = ["Today's code in the photo", 'Phone on the farm', 'AI reads the photo', ...(bill ? ['Bill total read'] : []), 'Land check', 'Season fund covers it'];
  return (
    <ul aria-live="polite" className="space-y-2">
      {steps.map((s, i) => (
        <li key={s} className="check-pulse flex items-center gap-3" style={{ animationDelay: `${i * 450}ms` }}>
          <span aria-hidden className="size-3 rounded-full bg-leaf" />
          {s}
        </li>
      ))}
    </ul>
  );
}
