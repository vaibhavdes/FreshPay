'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MILESTONE_LABELS } from '@/lib/claim-copy';
import type { PlotMilestone } from '@/lib/engine/stateMachine';
import { FAULTS, type Fault } from '@/lib/faults';

type Window = { type: PlotMilestone; opensAt: number; closesAt: number; open: boolean };

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

async function post(path: string, body: unknown): Promise<string | null> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const { error } = (await res.json().catch(() => ({}))) as { error?: string };
  return error ?? 'That did not work. Try again.';
}

export function TimeMachine({ contractId, windows }: { contractId: string; windows: Window[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<PlotMilestone | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(type: PlotMilestone) {
    setBusy(type);
    setError(await post('/api/sandbox/window', { contractId, milestone: type }));
    setBusy(null);
    router.refresh();
  }

  return (
    <div>
      <ul className="divide-y divide-contour border-y border-contour">
        {windows.map((w) => (
          <li key={w.type} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="font-semibold">{MILESTONE_LABELS[w.type].title}</p>
              <p className="text-canopy-soft tabular-nums">
                {day(w.opensAt)} to {day(w.closesAt)}
              </p>
            </div>
            {w.open ? (
              <span className="font-semibold text-leaf">Open now</span>
            ) : (
              <button type="button" onClick={() => open(w.type)} disabled={busy !== null} className="rounded-md border border-canopy/25 px-4 py-2 font-semibold hover:border-canopy disabled:opacity-50">
                {busy === w.type ? 'Opening' : 'Open it now'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="status" className="mt-3 rounded-md bg-cherry-wash px-4 py-3 text-cherry">{error}</p>}
    </div>
  );
}

export function FaultPanel({ armed }: { armed: Fault | null }) {
  const router = useRouter();
  const [current, setCurrent] = useState(armed);
  const [error, setError] = useState<string | null>(null);

  async function arm(fault: Fault | null) {
    const failed = await post('/api/sandbox/fault', { fault });
    setError(failed);
    if (!failed) setCurrent(fault);
    router.refresh();
  }

  return (
    <div>
      <ul className="divide-y divide-contour border-y border-contour">
        {(Object.keys(FAULTS) as Fault[]).map((fault) => (
          <li key={fault} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="font-semibold">{FAULTS[fault].label}</p>
              <p className="text-canopy-soft">{FAULTS[fault].how}</p>
            </div>
            {current === fault ? (
              <button type="button" onClick={() => arm(null)} className="rounded-md bg-cherry px-4 py-2 font-semibold text-sheet">
                Armed. Disarm
              </button>
            ) : (
              <button type="button" onClick={() => arm(fault)} className="rounded-md border border-canopy/25 px-4 py-2 font-semibold hover:border-canopy">
                Arm
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="status" className="mt-3 rounded-md bg-cherry-wash px-4 py-3 text-cherry">{error}</p>}
    </div>
  );
}
