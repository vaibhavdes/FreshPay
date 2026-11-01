'use client';

import { useEffect, useState } from 'react';
import { formatUsd } from '@/lib/format';

export function FarmerWallet({ paidCents, seasonCents, onTheWayCents }: { paidCents: number; seasonCents: number; onTheWayCents: number }) {
  const [shown, setShown] = useState(paidCents);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      setShown(Math.round(paidCents * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paidCents]);
  const share = seasonCents ? Math.min(100, (paidCents / seasonCents) * 100) : 0;

  return (
    <div className="mt-4 overflow-hidden rounded-2xl bg-gradient-to-br from-canopy to-leaf p-4 text-white">
      <p className="text-sm text-white/70">Paid to you so far</p>
      <p className="text-4xl font-bold tabular-nums">{formatUsd(shown)}</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
        <span className="block h-full rounded-full bg-[#8fd19e] transition-[width] duration-700 ease-out" style={{ width: `${share}%` }} />
      </div>
      <p className="mt-2 flex items-start justify-between gap-2 text-sm text-white/75">
        <span>of {formatUsd(seasonCents)} before the harvest is sold</span>
        {onTheWayCents > 0 && <span className="shrink-0 animate-pulse rounded-full bg-white/15 px-2 text-white">{formatUsd(onTheWayCents)} on its way</span>}
      </p>
    </div>
  );
}
