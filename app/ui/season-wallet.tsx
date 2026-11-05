'use client';

import { useEffect, useState } from 'react';
import { formatUsd } from '@/lib/format';
import type { SeasonWallet as Wallet } from '@/lib/services/wallet';

type Props = {
  wallet: Wallet;
  buyer: string;
  funded: boolean;
  paypal: { availableCents: number; asOf: string | null } | null;
  facts: { value: string; label: string }[];
};

const STATUS: Record<string, { text: string; tone: string }> = {
  SUCCESS: { text: 'Received', tone: 'bg-leaf-wash text-leaf' },
  PENDING: { text: 'On its way', tone: 'bg-monsoon-wash text-canopy' },
  UNCLAIMED: { text: 'Waiting to be claimed', tone: 'bg-monsoon-wash text-canopy' },
  FAILED: { text: 'Failed', tone: 'bg-cherry-wash text-cherry' },
  RETURNED: { text: 'Returned', tone: 'bg-cherry-wash text-cherry' },
};

function useCountUp(target: number) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      setValue(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

function Flow({ wallet }: { wallet: Wallet }) {
  const outs = [
    { label: 'Sellers, labour, hire', cents: wallet.toSuppliersCents, colour: 'var(--at-leaf)', y: 40 },
    { label: 'Farmers', cents: wallet.toFarmersCents, colour: '#8fd19e', y: 110 },
    { label: 'Held for a person', cents: wallet.heldCents, colour: 'var(--at-monsoon)', y: 180 },
  ];
  const width = (cents: number) => (cents ? 2 + Math.min(10, (cents / Math.max(1, wallet.fundCents)) * 40) : 1.5);
  return (
    <svg viewBox="0 0 420 220" role="img" aria-label="How the season fund flows to sellers, farmers and held claims" className="w-full">
      <path d="M10 110 H120" stroke="#ffffff" strokeOpacity={0.5} strokeWidth={6} className={wallet.fundCents ? 'money-flow' : ''} fill="none" />
      <text x={10} y={96} fill="#ffffff" fillOpacity={0.7} fontSize={12}>
        PayPal Checkout
      </text>
      <rect x={120} y={80} width={86} height={60} rx={14} fill="#ffffff" fillOpacity={0.12} stroke="#ffffff" strokeOpacity={0.3} />
      <text x={163} y={106} textAnchor="middle" fill="#ffffff" fontSize={12}>
        Season
      </text>
      <text x={163} y={122} textAnchor="middle" fill="#ffffff" fontSize={12}>
        fund
      </text>
      {outs.map((o) => (
        <g key={o.label}>
          <path
            d={`M206 110 C 260 110, 260 ${o.y}, 300 ${o.y}`}
            stroke={o.colour}
            strokeOpacity={o.cents ? 1 : 0.25}
            strokeWidth={width(o.cents)}
            fill="none"
            className={o.cents ? 'money-flow' : ''}
          />
          <circle cx={304} cy={o.y} r={5} fill={o.colour} fillOpacity={o.cents ? 1 : 0.3} />
          <text x={314} y={o.y - 3} fill="#ffffff" fontSize={12}>
            {o.label}
          </text>
          <text x={314} y={o.y + 13} fill="#ffffff" fillOpacity={0.75} fontSize={12} className="tabular-nums">
            {formatUsd(o.cents)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function SeasonWallet({ wallet, buyer, funded, paypal, facts }: Props) {
  const left = useCountUp(wallet.leftCents);
  const parts = [
    { label: 'To sellers, labour, hire', cents: wallet.toSuppliersCents, colour: 'bg-leaf' },
    { label: 'To farmers', cents: wallet.toFarmersCents, colour: 'bg-[#8fd19e]' },
    { label: 'Held for a person', cents: wallet.heldCents, colour: 'bg-monsoon' },
    { label: 'Left in the fund', cents: Math.max(0, wallet.leftCents - wallet.heldCents), colour: 'bg-white/25' },
  ];
  const total = Math.max(1, parts.reduce((sum, p) => sum + p.cents, 0));
  const covered = paypal ? paypal.availableCents >= wallet.nextPaymentCents : null;

  return (
    <section aria-label="Season wallet" className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
      <div className="relative flex flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-canopy via-[#1d4a2e] to-leaf p-6 text-white shadow-lg">
        <div aria-hidden className="absolute -right-16 -top-16 size-48 rounded-full bg-white/5" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-white/70">Season fund</p>
            <p className="mt-1 text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">{formatUsd(funded ? left : wallet.fundCents)}</p>
            <p className="mt-1 text-sm text-white/70">{funded ? `left of ${formatUsd(wallet.fundCents)} paid in by ${buyer}` : `to be paid in by ${buyer} with PayPal`}</p>
          </div>
          <span className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">{funded ? 'Funded' : 'Not funded yet'}</span>
        </div>

        <div className="mt-6 flex h-3 overflow-hidden rounded-full bg-white/10" role="img" aria-label="Where the fund has gone">
          {parts.map((p) => (
            <span key={p.label} className={`${p.colour} h-full transition-[width] duration-700 ease-out`} style={{ width: `${(p.cents / total) * 100}%` }} />
          ))}
        </div>
        <ul className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {parts.map((p) => (
            <li key={p.label} className="flex items-center gap-2">
              <span aria-hidden className={`size-2.5 rounded-full ${p.colour}`} />
              <span className="text-white/75">{p.label}</span>
              <span className="ml-auto font-semibold tabular-nums">{formatUsd(p.cents)}</span>
            </li>
          ))}
        </ul>
        {wallet.bonusCents > 0 && (
          <p className="mt-2 text-sm text-white/70">
            Plus <span className="font-semibold tabular-nums text-white">{formatUsd(wallet.bonusCents)}</span> in good-practice bonuses, paid by the buyer on top of the fund.
          </p>
        )}

        {paypal && (
          <p className={`mb-5 mt-5 rounded-xl px-3 py-2 text-sm ${covered ? 'bg-white/10' : 'bg-cherry text-white'}`}>
            PayPal last reported <span className="font-semibold tabular-nums">{formatUsd(paypal.availableCents)}</span> in the paying account
            {paypal.asOf && ` at ${new Date(paypal.asOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
            {covered ? '. Each season fund paid in tops it up.' : `, less than the next stage payment of ${formatUsd(wallet.nextPaymentCents)}. Payouts fail until it is topped up.`}
          </p>
        )}

        <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-white/15 pt-4 sm:grid-cols-4">
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="sr-only">{f.label}</dt>
              <dd className="text-lg font-bold tabular-nums">{f.value}</dd>
              <dd className="text-xs text-white/65">{f.label}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="rounded-3xl bg-canopy p-5 text-white">
        <p className="text-sm text-white/70">Money in motion</p>
        <Flow wallet={wallet} />
        <ul className="mt-2 divide-y divide-white/10">
          {wallet.payments.slice(0, 5).map((p, i) => {
            const status = STATUS[p.status] ?? { text: p.status, tone: 'bg-white/15 text-white' };
            return (
              <li key={p.id} className="pay-row flex items-center gap-3 py-2" style={{ animationDelay: `${i * 80}ms` }}>
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 text-sm font-bold">
                  {p.name.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p.name}</span>
                  <span className="block truncate text-xs text-white/60">{p.stage}</span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold tabular-nums">{formatUsd(p.cents)}</span>
                  <span className={`inline-block rounded-full px-2 text-xs ${status.tone}`}>{status.text}</span>
                </span>
              </li>
            );
          })}
          {!wallet.payments.length && <li className="py-3 text-sm text-white/60">No payments yet. The first one goes out when a farm proves its first stage.</li>}
        </ul>
      </div>
    </section>
  );
}
