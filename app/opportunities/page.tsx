import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { payoutCountry } from '@/lib/countries';
import { db } from '@/lib/db/client';
import { formatUsd } from '@/lib/format';
import { listOpportunities } from '@/lib/services/opportunities';
import { TopBar } from '../ui/shell';

export const metadata: Metadata = { title: 'Opportunities' };

// What one hectare earns under these terms, and how much of it is paid before harvest.
const perHectare = (terms: { yieldKgPerHa: number; priceCentsPerKg: number; advancePercent: number }) => {
  const value = Math.round((terms.yieldKgPerHa * terms.priceCentsPerKg) / 100) * 100;
  return { value, ahead: Math.round((value * terms.advancePercent) / 100) };
};

export default async function OpportunitiesPage() {
  await connection();
  const board = await listOpportunities(await db());

  return (
    <>
      <TopBar />
      <main className="mx-auto w-full max-w-6xl px-6 pb-16 pt-8 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Opportunities</h1>
            <p className="mt-2 text-lg text-canopy-soft">Companies post a season. Farmers join with their farm and are paid at each stage they prove.</p>
          </div>
          <Link href="/opportunities/new" className="rounded-md bg-canopy px-5 py-3 font-semibold text-sheet hover:bg-canopy/90">
            Post an opportunity
          </Link>
        </div>

        {board.length === 0 ? (
          <p className="mt-10 rounded-lg border border-contour bg-sheet px-6 py-8 text-lg">
            No opportunities yet. Post the first one: pick a crop, set the price, and farmers can join straight away.
          </p>
        ) : (
          <ul className="mt-8 grid gap-5 md:grid-cols-2">
            {board.map((o) => {
              const { value, ahead } = perHectare(o.terms);
              const share = Math.min(1, o.hectaresJoined / o.hectaresWanted);
              return (
                <li key={o.id} className="flex flex-col rounded-xl border border-contour bg-sheet p-5">
                  <p className="text-sm text-canopy-soft">
                    {o.company} · {payoutCountry(o.country)?.name ?? o.country}
                  </p>
                  <h2 className="mt-1 text-2xl font-bold">{o.title}</h2>
                  <p className="mt-2">
                    About <strong>{formatUsd(value)}</strong> a hectare, <strong>{formatUsd(ahead)}</strong> of it paid stage by stage before the crop is sold.
                  </p>
                  <ol className="mt-3 flex flex-wrap gap-1.5 text-sm">
                    {Object.values(o.terms.stages).map((s) => (
                      <li key={s.label} className="rounded-full bg-survey px-2.5 py-1">
                        {s.label}
                      </li>
                    ))}
                  </ol>
                  <div className="mt-4">
                    <div className="h-2 overflow-hidden rounded-full bg-survey" role="img" aria-label={`${o.hectaresJoined} of ${o.hectaresWanted} hectares joined`}>
                      <div className="h-full bg-leaf" style={{ width: `${share * 100}%` }} />
                    </div>
                    <p className="mt-1 text-sm text-canopy-soft">
                      {o.farms} farm{o.farms === 1 ? '' : 's'}, {o.hectaresJoined} of {o.hectaresWanted} ha · apply by {o.applyBy}
                    </p>
                  </div>
                  <Link href={`/opportunities/${o.id}`} className="mt-5 self-start rounded-md bg-leaf px-4 py-2 font-semibold text-sheet hover:bg-canopy">
                    See the terms and join
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
