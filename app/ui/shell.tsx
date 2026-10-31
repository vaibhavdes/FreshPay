import Link from 'next/link';

// The frame every screen shares: who you are (role) and where you are in the season (step).

export type Role = 'company' | 'farmer' | 'officer' | 'tour';
export type Step = 1 | 2 | 3 | 4 | 5 | 6;

const ROLES: { role: Role; label: string; href: string }[] = [
  { role: 'company', label: 'Company', href: '/company' },
  { role: 'farmer', label: 'Farmer', href: '/farmer' },
  { role: 'officer', label: 'Field officer', href: '/coop' },
];

export const STEPS: { step: Step; label: string; href: string }[] = [
  { step: 1, label: 'Contract', href: '/company?tab=terms' },
  { step: 2, label: 'Map farm', href: '/coop/onboard' },
  { step: 3, label: 'Prove stage', href: '/farmer' },
  { step: 4, label: 'Check', href: '/coop' },
  { step: 5, label: 'Paid', href: '/farm' },
  { step: 6, label: 'Track', href: '/company' },
];

export function TopBar({ role }: { role?: Role }) {
  return (
    <header className="border-b border-contour bg-sheet">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3 sm:px-10">
        <Link href="/" className="text-lg font-bold tracking-tight">
          FarmProof
        </Link>
        <nav aria-label="View as" className="flex items-center gap-1 rounded-full border border-contour bg-survey p-1">
          {ROLES.map((r) => (
            <Link
              key={r.role}
              href={r.href}
              aria-current={role === r.role ? 'page' : undefined}
              className={`rounded-full px-3 py-1 text-sm font-semibold ${role === r.role ? 'bg-canopy text-sheet' : 'text-canopy-soft hover:text-canopy'}`}
            >
              {r.label}
            </Link>
          ))}
        </nav>
        <Link href="/tour" className={`rounded-md px-3 py-1.5 text-sm font-semibold ${role === 'tour' ? 'bg-leaf text-sheet' : 'border border-canopy/25 hover:border-canopy'}`}>
          Guided tour
        </Link>
      </div>
    </header>
  );
}

export function StepRail({ current }: { current?: Step }) {
  return (
    <nav aria-label="Season steps" className="border-b border-contour bg-survey">
      <ol className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-6 py-2.5 sm:px-10">
        {STEPS.map((s, i) => {
          const here = s.step === current;
          return (
            <li key={s.step} className="flex shrink-0 items-center gap-1">
              {i > 0 && <span aria-hidden className={`h-px w-5 sm:w-8 ${current && s.step <= current ? 'bg-leaf' : 'bg-contour'}`} />}
              <Link
                href={s.href}
                aria-current={here ? 'step' : undefined}
                className={`flex items-center gap-2 rounded-full px-2.5 py-1 text-sm ${here ? 'bg-leaf font-semibold text-sheet' : 'text-canopy-soft hover:text-canopy'}`}
              >
                <span
                  aria-hidden
                  className={`grid size-5 place-items-center rounded-full text-xs font-bold tabular-nums ${here ? 'bg-sheet text-leaf' : current && s.step < current ? 'bg-leaf text-sheet' : 'border border-contour'}`}
                >
                  {s.step}
                </span>
                {s.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// The single "what next" button at the end of a screen.
export function NextStep({ href, label, note }: { href: string; label: string; note?: React.ReactNode }) {
  return (
    <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-contour pt-6">
      {note ? <div className="text-canopy-soft">{note}</div> : <span />}
      <Link href={href} className="rounded-md bg-canopy px-5 py-3 font-semibold text-sheet hover:bg-canopy/90">
        {label}
      </Link>
    </div>
  );
}
