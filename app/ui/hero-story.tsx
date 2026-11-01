'use client';

import { useEffect, useState } from 'react';
import { formatUsd } from '@/lib/format';

export type StoryStage = {
  title: string;
  short: string;
  caption: string;
  photo: { src: string; alt: string };
  checks: string[];
  payees: { name: string; role: string; cents: number; farmer: boolean }[];
};

const STEP_MS = 4200;
const CODES = ['K7Q2MX', 'R4TP9C', 'H8WN3V', 'M2XK7D', 'P9FJ4B'];

export function HeroStory({ buyer, farmer, fundCents, stages }: { buyer: string; farmer: string; fundCents: number; stages: StoryStage[] }) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState(3);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timers = [setTimeout(() => setPhase(0), 0), setTimeout(() => setPhase(1), 700), setTimeout(() => setPhase(2), 1700), setTimeout(() => setPhase(3), 2600)];
    const next = setTimeout(() => setIndex((i) => (i + 1) % stages.length), STEP_MS);
    return () => [...timers, next].forEach(clearTimeout);
  }, [index, paused, stages.length]);

  const stage = stages[index];
  const paidThrough = (upTo: number, farmerOnly: boolean) =>
    stages.slice(0, upTo).reduce((sum, s) => sum + s.payees.filter((p) => !farmerOnly || p.farmer).reduce((a, p) => a + p.cents, 0), 0);
  const done = phase >= 3 ? index + 1 : index;
  const farmerCash = paidThrough(done, true);
  const fundLeft = fundCents - paidThrough(done, false);
  const seasonFarmer = paidThrough(stages.length, true);
  const rows = Math.max(...stages.map((s) => s.payees.length));

  return (
    <div
      className="rounded-3xl border border-night-line bg-night-panel p-5"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-night-muted">
          {buyer} paid in <span className="font-semibold text-night-ink">{formatUsd(fundCents)}</span> with PayPal
        </span>
        <span className="rounded-full border border-night-line px-3 py-1 tabular-nums">
          Fund <span className="font-semibold text-night-leaf">{formatUsd(Math.max(0, fundLeft))}</span>
        </span>
      </div>

      <div className="relative mt-4 aspect-[16/10] overflow-hidden rounded-2xl">
        {stages.map((s, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- stacked stage photos cross-fade
          <img key={s.photo.src} src={s.photo.src} alt={i === index ? s.photo.alt : ''} className={`absolute inset-0 size-full object-cover transition-opacity duration-700 ${i === index ? 'opacity-100' : 'opacity-0'}`} />
        ))}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
        <span className={`absolute left-4 top-4 rotate-[-3deg] rounded-md bg-[#fbf8f0] px-3 py-1.5 font-mono text-lg font-bold text-[#1d2a22] shadow transition-all duration-500 ${phase >= 0 ? 'opacity-100' : 'opacity-0'}`}>
          {CODES[index % CODES.length]}
        </span>
        <ul className="absolute bottom-4 left-4 right-4 space-y-1.5 text-sm">
          {stage.checks.map((c, i) => (
            <li key={c} className={`flex items-center gap-2 transition-all duration-300 ${phase >= 1 ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0'}`} style={{ transitionDelay: `${i * 220}ms` }}>
              <span className="grid size-5 place-items-center rounded-full bg-night-leaf text-xs font-bold text-black">✓</span>
              <span className="text-white">{c}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="relative mt-4 grid content-start gap-1.5" style={{ height: `${rows * 2.5 + (rows - 1) * 0.375}rem` }}>
        <p className={`absolute inset-0 grid place-items-center rounded-xl border border-dashed border-night-line text-sm text-night-muted transition-opacity duration-300 ${phase >= 2 ? 'opacity-0' : 'opacity-100'}`}>
          Checking the proof
        </p>
        {stage.payees.map((p, i) => (
          <div
            key={p.name}
            className={`flex h-10 items-center justify-between gap-3 rounded-xl border border-night-line px-3 transition-all duration-500 ${phase >= 2 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}
            style={{ transitionDelay: `${i * 180}ms` }}
          >
            <span className="min-w-0 truncate">
              <span className="font-semibold">{p.name}</span> <span className="text-sm text-night-faint">· {p.role}</span>
            </span>
            <span className="font-semibold tabular-nums text-night-leaf">+{formatUsd(p.cents)}</span>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <p className="flex justify-between text-sm text-night-muted">
          <span>{farmer}&apos;s cash in hand this season</span>
          <span className="font-semibold tabular-nums text-night-ink">{formatUsd(farmerCash)}</span>
        </p>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-night-line">
          <span className="block h-full rounded-full bg-night-leaf transition-[width] duration-700 ease-out" style={{ width: `${seasonFarmer ? (farmerCash / seasonFarmer) * 100 : 0}%` }} />
        </div>
      </div>

      <ol className="mt-5 flex items-start justify-between gap-1">
        {stages.map((s, i) => (
          <li key={s.title} className="flex flex-1 flex-col items-center gap-1 text-center">
            <button
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show ${s.title}`}
              aria-current={i === index ? 'step' : undefined}
              className={`size-3 rounded-full transition-colors ${i < done ? 'bg-night-leaf' : i === index ? 'bg-night-ink' : 'bg-night-line'}`}
            />
            <span className={`hidden whitespace-nowrap text-xs sm:block ${i === index ? 'text-night-ink' : 'text-night-faint'}`}>{s.short}</span>
          </li>
        ))}
      </ol>
      <p aria-live="polite" className="mt-3 h-[4.5rem] overflow-hidden text-night-muted">
        <span className="font-semibold text-night-ink">{stage.title}.</span> {stage.caption}
      </p>
    </div>
  );
}
