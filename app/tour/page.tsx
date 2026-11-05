import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { connection } from 'next/server';
import { db } from '@/lib/db/client';
import { armedFault } from '@/lib/faults';
import { STAGE_PHOTOS } from '@/lib/photos';
import { seasonState } from '@/lib/services/season-clock';
import { seasonFor } from '@/lib/services/entry';
import { isVisitorSeason } from '@/lib/services/visitor-season';
import { visitorSeason } from '@/lib/visitor';
import { SatelliteMap } from '../ui/satellite-map';
import { StepRail, TopBar } from '../ui/shell';
import { FaultPanel, TimeMachine } from './test-controls';

export const metadata: Metadata = { title: 'Guided tour' };

type Stop = { map?: boolean; refused?: boolean; who: 'Company' | 'Field officer' | 'Farmer' | 'Anyone'; title: string; look: string; href: string; action: string; photo: { src: string; alt: string } };

const photos = STAGE_PHOTOS.coffee;

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
    { who: 'Company', title: 'Read the contract and fund the season', look: 'Five paid stages per farm, each with its share of the crop value. The season fund is paid once with PayPal Checkout.', href: `${board}?tab=terms`, action: 'Open the contract', photo: photos.PROCESSING },
    { who: 'Field officer', title: 'Map a farm and check the land', look: 'Walk the boundary or paste its corners. Satellite data shows at once whether forest was cleared since 2020.', href: '/coop/onboard', action: 'Map a farm', photo: photos.PLOT_VERIFIED, map: true },
    ...(clear ? [{ who: 'Farmer' as const, title: `Prove a stage on ${clear.farmer}'s phone`, look: "Get today's code, take the photo with the bills, add a voice note in any language. Paid in about a minute.", href: `/m/${clear.id}`, action: "Open the farmer's phone", photo: photos.INPUTS }] : []),
    ...(unclear ? [{ who: 'Field officer' as const, title: 'Decide a claim that was held', look: `${unclear.farmer}'s bill needs a person. The AI review agent investigates and recommends; the officer decides.`, href: '/coop', action: 'Open the check queue', photo: photos.CROP_CARE }] : []),
    ...(cleared ? [{ who: 'Anyone' as const, title: 'See a farm refused by the land check', look: `${cleared.farmer}'s farm sits on forest cleared after 2020, so no stage is paid, whatever the photo shows.`, href: `/farms/${cleared.id}`, action: 'See the farm', photo: photos.PLOT_VERIFIED, refused: true, map: true }] : []),
    ...(clear ? [{ who: 'Anyone' as const, title: 'Open a farm record', look: 'Every stage with its photo, the checks behind it, how the money was split and the PayPal receipt.', href: `/farms/${clear.id}`, action: 'Open the farm record', photo: photos.HARVEST }] : []),
    { who: 'Company', title: 'Track the season', look: 'The season wallet, every farm on the board, and the Season Agent answering from PayPal itself.', href: board, action: 'Open the company view', photo: photos.INPUTS },
    { who: 'Company', title: 'Close the season', look: 'Pay the delivery balance only for the weight and grade accepted, track the shipment, or refund after a verified disaster.', href: `${board}?tab=season-end`, action: 'Open season end', photo: photos.PROCESSING },
  ];

  return (
    <>
      <TopBar role="tour" />
      <StepRail />
      <main className="mx-auto w-full max-w-5xl px-6 pb-16 pt-8 sm:px-10">
        <p className="font-semibold text-leaf">Guided tour · about 3 minutes</p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">Follow one coffee season from contract to harvest</h1>
        <p className="mt-2 max-w-2xl text-lg text-canopy-soft">
          {contract.season} season in Kodagu, Karnataka: three farms, one company, every payment on the PayPal sandbox. Open the stops in order; each one opens the
          real screen.
        </p>
        <form action="/api/sandbox/season" method="post" className={`mt-6 flex flex-wrap items-center gap-4 rounded-2xl p-4 ${own ? 'bg-leaf-wash' : 'bg-monsoon-wash'}`}>
          <p className="flex-1">
            {own
              ? 'You are in your own copy of the season. Nobody else sees your payments, and you can start again at any time.'
              : 'You are viewing the shared season. Start your own copy to fund it with PayPal and pay farmers yourself.'}
          </p>
          <button type="submit" className="rounded-md bg-canopy px-4 py-2 font-semibold text-sheet hover:bg-canopy/90">
            {own ? 'Start over' : 'Start my own season'}
          </button>
        </form>

        <ol className="mt-8 grid gap-4 sm:grid-cols-2">
          {stops.map((stop, i) => (
            <li key={stop.title} className="group flex flex-col overflow-hidden rounded-2xl border border-contour bg-sheet transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="relative aspect-[16/7]">
                {stop.map ? (
                  <SatelliteMap
                    plots={stop.refused && cleared ? [{ id: cleared.id, name: cleared.farmer, ring: cleared.ring, status: 'FAIL' }] : plots.filter((p) => p.status === 'PASS').map((p) => ({ id: p.id, name: p.farmer, ring: p.ring, status: 'PASS' as const }))}
                    width={560}
                    ratio={7 / 16}
                    linked={false}
                    caption={false}
                    title={stop.title}
                    className="[&_svg]:rounded-none"
                  />
                ) : (
                  <Image src={stop.photo.src} alt={stop.photo.alt} fill sizes="(min-width: 640px) 45vw, 100vw" className={`object-cover ${stop.refused ? 'grayscale' : ''}`} />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
                <span className="absolute left-3 top-3 grid size-9 place-items-center rounded-full bg-sheet text-lg font-bold text-canopy tabular-nums">{i + 1}</span>
                <span className="absolute bottom-3 left-3 rounded-full bg-black/45 px-2.5 py-0.5 text-xs font-semibold text-white">{stop.who}</span>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <h2 className="text-lg font-bold">{stop.title}</h2>
                <p className="mt-1 flex-1 text-canopy-soft">{stop.look}</p>
                <Link href={stop.href} className="mt-4 self-start rounded-md bg-leaf px-4 py-2 font-semibold text-sheet hover:bg-canopy">
                  {stop.action}
                </Link>
              </div>
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
                <FaultPanel armed={armedFault(contract.id)} contractId={contract.id} />
              </div>
            </div>
          </div>
        </details>
      </main>
    </>
  );
}
