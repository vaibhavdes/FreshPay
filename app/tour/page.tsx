import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { db } from '@/lib/db/client';
import { armedFault } from '@/lib/faults';
import { seasonState } from '@/lib/services/season-clock';
import { seasonFor } from '@/lib/services/entry';
import { isVisitorSeason } from '@/lib/services/visitor-season';
import { visitorSeason } from '@/lib/visitor';
import { StepRail, TopBar } from '../ui/shell';
import { FaultPanel, TimeMachine } from './test-controls';

export const metadata: Metadata = { title: 'Guided tour' };

type Stop = { step: string; title: string; look: string; href: string; action: string };

export default async function TourPage() {
  await connection();
  const database = await db();
  const seasonId = await seasonFor(database, await visitorSeason(database));
  const state = seasonId ? await seasonState(database, seasonId) : null;
  if (!state) return <p className="mx-auto max-w-2xl px-6 py-16">No season is set up yet. Run npm run season.</p>;
  const own = isVisitorSeason(state.contract.id);

  const { contract, windows, plots } = state;
  const [clear, unclear] = plots.filter((p) => p.status === 'PASS');
  const cleared = plots.find((p) => p.status === 'FAIL');
  const board = `/contracts/${contract.id}`;

  const stops: Stop[] = [
    { step: '1', title: 'The company sets the contract', look: 'Four paid stages per farm, then pay the season fund with PayPal.', href: `${board}?tab=terms`, action: 'Open the contract' },
    { step: '2', title: 'A field officer maps a farm', look: 'Walk the boundary or paste its corners. The land check runs at once.', href: '/coop/onboard', action: 'Map a farm' },
    ...(clear ? [{ step: '3', title: `${clear.farmer} proves a stage`, look: "Today's code, a photo, a voice note in any language. Paid in about a minute.", href: `/m/${clear.id}`, action: "Open the farmer's phone" }] : []),
    ...(unclear ? [{ step: '4', title: `${unclear.farmer}'s bill is too blurry`, look: 'Nothing is paid on a guess. The agent investigates; the officer enters the bill total.', href: '/coop', action: 'Open the check queue' }] : []),
    ...(cleared ? [{ step: '4', title: `${cleared.farmer}'s farm fails the land check`, look: 'Forest cleared after 2020: every payment refused, whatever the photo shows.', href: `/farms/${cleared.id}`, action: 'See the farm' }] : []),
    ...(clear ? [{ step: '5', title: 'See what was paid, and why', look: 'Each stage: the photo, the checks, the split, the PayPal payment.', href: `/farms/${clear.id}`, action: 'Open the farm record' }] : []),
    { step: '6', title: 'Track every farm', look: 'The board, the satellite map, and the Season Agent reading PayPal itself.', href: board, action: 'Open the board' },
    { step: '+', title: 'End the season', look: 'Capture only what passes quality and void the rest, or refund after verified hail.', href: `${board}?tab=season-end`, action: 'Open season end' },
  ];

  return (
    <>
      <TopBar role="tour" />
      <StepRail />
      <main className="mx-auto w-full max-w-4xl px-6 pb-16 pt-8 sm:px-10">
        <h1 className="text-4xl font-bold tracking-tight">Guided tour</h1>
        <p className="mt-2 text-lg text-canopy-soft">One coffee season, three farmers. Open each stop in order.</p>
        <form action="/api/sandbox/season" method="post" className={`mt-5 flex flex-wrap items-center gap-4 rounded-xl p-4 ${own ? 'bg-leaf-wash' : 'bg-monsoon-wash'}`}>
          <p className="flex-1">
            {own
              ? 'This is your own copy of the season: nobody else sees your payments. Start again any time.'
              : 'You are looking at the shared season. Start your own copy to fund it and pay farmers yourself.'}
          </p>
          <button type="submit" className="rounded-md bg-canopy px-4 py-2 font-semibold text-sheet hover:bg-canopy/90">
            {own ? 'Start over' : 'Start my own season'}
          </button>
        </form>

        <ol className="mt-8 space-y-3">
          {stops.map((stop) => (
            <li key={stop.title} className="flex flex-wrap items-center gap-4 rounded-xl border border-contour bg-sheet p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-canopy text-lg font-bold text-sheet">{stop.step}</span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold">{stop.title}</h2>
                <p className="text-canopy-soft">{stop.look}</p>
              </div>
              <Link href={stop.href} className="rounded-md bg-leaf px-4 py-2 font-semibold text-sheet hover:bg-canopy">
                {stop.action}
              </Link>
            </li>
          ))}
        </ol>

        <details className="mt-10 rounded-xl border border-contour bg-sheet p-5">
          <summary className="cursor-pointer text-lg font-bold">Test controls (PayPal sandbox)</summary>
          <div className="mt-5 grid gap-10 lg:grid-cols-2">
            <div>
              <h2 className="font-bold">Time machine</h2>
              <p className="mt-1 text-sm text-canopy-soft">Open a stage&apos;s payment window today. Each change is written to the payment record.</p>
              <div className="mt-3">
                <TimeMachine contractId={contract.id} windows={windows} />
              </div>
            </div>
            <div>
              <h2 className="font-bold">Make PayPal fail</h2>
              <p className="mt-1 text-sm text-canopy-soft">PayPal&apos;s sandbox returns the failure on the next matching call. Nothing is paid twice.</p>
              <div className="mt-3">
                <FaultPanel armed={armedFault()} />
              </div>
            </div>
          </div>
        </details>
      </main>
    </>
  );
}
