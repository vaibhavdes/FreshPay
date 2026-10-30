import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { db } from '@/lib/db/client';
import { armedFault } from '@/lib/faults';
import { demoState } from '@/lib/services/demo';
import { FaultPanel, TimeMachine } from './demo-controls';

export const metadata: Metadata = { title: 'Run the season' };

type Step = { title: string; body: string; href: string; action: string };

export default async function DemoPage() {
  await connection();
  const state = await demoState(await db());
  if (!state) {
    return <p className="mx-auto max-w-2xl px-6 py-16">No season is set up yet. Run npm run seed.</p>;
  }
  const { contract, windows, plots } = state;
  const [clear, unclear] = plots.filter((p) => p.status === 'PASS');
  const cleared = plots.find((p) => p.status === 'FAIL');
  const contractPage = `/contracts/${contract.id}`;

  const steps: Step[] = [
    { title: 'The buyer funds the season', body: 'The roaster pays the season advance with PayPal Checkout. It is held for this contract and paid out only against proof.', href: contractPage, action: 'Open the contract' },
    ...(clear
      ? [{ title: `${clear.farmer} registers ${clear.name}`, body: "The farmer photographs today's code on the plot. The model reads it, every check passes and PayPal Payouts pays in about a minute.", href: `/m/${clear.id}`, action: 'Open the phone screen' }]
      : []),
    ...(unclear
      ? [{ title: `${unclear.farmer}'s photo is unclear`, body: 'Send a blurry photo: the model is not sure, so nothing is paid. The review agent investigates and the cooperative officer decides in the review queue.', href: `/m/${unclear.id}`, action: 'Open the phone screen' }]
      : []),
    ...(cleared
      ? [{ title: `${cleared.name} fails the land check`, body: `Satellite data shows forest cleared after 2020, so ${cleared.farmer}'s payments are refused, whatever the photo shows.`, href: `/m/${cleared.id}`, action: 'Open the phone screen' }]
      : []),
    { title: 'The buyer asks the Season Agent', body: 'Ask in plain words which claims are held or which plots failed. The agent can propose approvals; a person clicks to pay.', href: `${contractPage}/command-centre`, action: 'Open the command centre' },
    ...(clear ? [{ title: 'Read a plot record', body: 'Evidence, what the model read, each PayPal payment and its ledger receipts, and the record to file.', href: `/plots/${clear.id}`, action: 'Open the plot record' }] : []),
    { title: 'Deliver the lot, or end the season', body: 'Authorize the balance, capture only what passes quality and void the rest. Or check a hailstorm against weather records and refund the unspent advance.', href: contractPage, action: 'Open the contract' },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 pb-16 sm:px-10">
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="text-xl font-bold tracking-tight">
          AgriTranche
        </Link>
        {process.env.DEMO_PASSCODE && (
          <Link href="/unlock?next=/demo" className="font-semibold text-leaf underline-offset-4 hover:underline">
            Enter the demo passcode
          </Link>
        )}
      </header>

      <section className="border-t border-contour pt-10">
        <p className="text-canopy-soft">Season {contract.season}, PayPal sandbox</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">Run the season</h1>
        <p className="mt-3 max-w-[44rem] text-lg leading-relaxed">
          One coffee season, three farmers, every PayPal step. Follow these in order; each opens the screen the person in that step would use.
        </p>
        <ol className="mt-8 grid gap-4 md:grid-cols-2">
          {steps.map((step, i) => (
            <li key={step.title} className="flex flex-col rounded-lg border border-contour bg-sheet p-6">
              <p className="font-semibold text-canopy-soft tabular-nums">Step {i + 1}</p>
              <h2 className="mt-1 text-xl font-bold">{step.title}</h2>
              <p className="mt-2 flex-1 leading-relaxed text-canopy-soft">{step.body}</p>
              <Link href={step.href} className="mt-4 self-start rounded-md bg-canopy px-4 py-2 font-semibold text-sheet hover:bg-canopy/90">
                {step.action}
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-14 grid gap-12 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl font-bold">Time machine</h2>
          <p className="mt-2 leading-relaxed text-canopy-soft">
            A real season spreads these payments over months. Open a step&apos;s window now to try it today. Each change is written to the ledger as a demo
            change.
          </p>
          <div className="mt-5">
            <TimeMachine contractId={contract.id} windows={windows} />
          </div>
        </div>
        <div>
          <h2 className="text-2xl font-bold">Make PayPal fail</h2>
          <p className="mt-2 leading-relaxed text-canopy-soft">
            Arm a failure and PayPal&apos;s sandbox returns it on the next matching call. Watch the app hold the money, show what went wrong and retry
            without paying twice.
          </p>
          <div className="mt-5">
            <FaultPanel armed={armedFault()} />
          </div>
        </div>
      </section>
    </div>
  );
}
