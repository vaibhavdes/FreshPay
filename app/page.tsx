import Link from 'next/link';
import { connection } from 'next/server';
import { db } from '@/lib/db/client';
import { formatHa, formatUsd } from '@/lib/format';
import { showcasePlots } from '@/lib/services/showcase';
import { PlotOutline } from './ui/plot-outline';

const STEPS = [
  { title: 'Fund', body: 'The buyer pays the season advance with PayPal. It is held for this contract only.' },
  { title: 'Prove', body: "The farmer photographs today's code on the plot and records a short voice note." },
  { title: 'Verify', body: 'AI reads the photo and voice. Code then checks the location, the timing, satellite data and the funds left.' },
  { title: 'Pay', body: "PayPal Payouts sends the farmer's share, and the input dealer's, in one batch." },
];

function Check({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <li className="check-item flex gap-3" style={{ animationDelay: `${delay}ms` }}>
      <svg viewBox="0 0 20 20" aria-hidden className="mt-0.5 size-5 shrink-0 text-leaf">
        <circle cx="10" cy="10" r="9" fill="currentColor" />
        <path d="M6 10.5l2.5 2.5L14 7.5" fill="none" stroke="var(--at-sheet)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

export default async function Home() {
  await connection();
  const { contract, passing, failing } = await showcasePlots(await db());

  return (
    <div className="mx-auto w-full max-w-6xl px-6 pb-16 sm:px-10">
      <header className="flex items-center justify-between py-6">
        <span className="text-xl font-bold tracking-tight">AgriTranche</span>
        <nav className="flex gap-6 font-semibold text-leaf">
          {contract && (
            <Link href={`/contracts/${contract.id}`} className="underline-offset-4 hover:underline">
              Buyer
            </Link>
          )}
          {passing && (
            <Link href={`/m/${passing.id}`} className="underline-offset-4 hover:underline">
              Farmer app
            </Link>
          )}
        </nav>
      </header>

      <section className="grid gap-12 border-t border-contour pt-12 lg:grid-cols-12 lg:gap-10 lg:pt-16">
        <div className="lg:col-span-5 lg:pt-6">
          <h1 className="text-[2.75rem] font-bold leading-[1.05] tracking-tight sm:text-6xl">EUDR compliance that pays the farmer</h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-canopy-soft">
            An EU buyer funds the coffee season through PayPal. Smallholders prove each stage with a photo, a code and their location.
            Satellite data confirms no forest was cleared after 2020, and the payment goes out the same minute.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {passing && (
              <Link href={`/m/${passing.id}`} className="rounded-md bg-leaf px-5 py-3 font-semibold text-sheet hover:bg-canopy">
                Open the farmer app
              </Link>
            )}
            <a href="#how" className="rounded-md border border-canopy/25 px-5 py-3 font-semibold hover:border-canopy">
              How money moves
            </a>
          </div>
        </div>

        {passing ? (
          <figure className="self-start rounded-lg border border-contour bg-sheet p-6 lg:col-span-7 sm:p-8">
            <figcaption className="flex flex-wrap items-baseline justify-between gap-2 border-b border-contour pb-4">
              <span className="font-semibold">Field record, {passing.name}</span>
              <span className="text-canopy-soft">
                {passing.farmer}, {formatHa(passing.areaHa)}
              </span>
            </figcaption>
            <div className="mt-6 grid items-center gap-6 sm:grid-cols-[minmax(0,13rem)_1fr]">
              <PlotOutline ring={passing.ring} title={`Boundary of ${passing.name}`} className="mx-auto w-48 sm:w-full" />
              <ul className="space-y-4">
                <Check delay={900}>Phone inside the plot boundary when the photo was taken</Check>
                <Check delay={1150}>Today&apos;s code read from the photo by Gemini</Check>
                <Check delay={1400}>
                  Forest loss since 2021: {formatHa(passing.lossHa)}, from Global Forest Watch
                </Check>
              </ul>
            </div>
            <p className="check-item mt-6 rounded-md bg-leaf-wash px-4 py-3 leading-relaxed" style={{ animationDelay: '1700ms' }}>
              When these checks pass, PayPal Payouts releases the <strong>{formatUsd(passing.inputsCents)}</strong> inputs payment:{' '}
              {formatUsd(passing.dealerCents)} to {passing.dealer} for fertiliser and {formatUsd(passing.farmerCents)} to {passing.farmer}.
            </p>
          </figure>
        ) : (
          <p className="self-center text-canopy-soft lg:col-span-7">No season loaded yet. Run npm run seed to load the Karnataka coffee contract.</p>
        )}
      </section>

      <section id="how" className="mt-24 border-t border-contour pt-12">
        <h2 className="text-3xl font-bold tracking-tight">How money moves</h2>
        <ol className="mt-10 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {STEPS.map((step, i) => (
            <li key={step.title} className="border-t-2 border-leaf pt-4">
              <span className="font-mono text-sm text-canopy-soft">{i + 1}</span>
              <h3 className="mt-1 text-xl font-bold">{step.title}</h3>
              <p className="mt-2 leading-relaxed text-canopy-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {failing && (
        <section className="mt-24 grid items-center gap-10 border-t border-contour pt-12 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <h2 className="text-3xl font-bold tracking-tight">When the satellite says no, the money stays put</h2>
            <p className="mt-5 max-w-[36rem] text-lg leading-relaxed text-canopy-soft">
              {failing.name} lost {formatHa(failing.lossHa)} of its {formatHa(failing.areaHa)} to tree cover loss after the EUDR cut-off of 31 December 2020.
              Every payment for that plot is withheld, and the buyer sees exactly why.
            </p>
          </div>
          <div className="flex items-center gap-6 lg:col-span-5">
            <PlotOutline ring={failing.ring} tone="cherry" title={`Boundary of ${failing.name}`} className="w-40 shrink-0" />
            <dl className="space-y-3">
              <div>
                <dt className="text-canopy-soft">Tree cover lost since 2021</dt>
                <dd className="text-2xl font-bold text-cherry">{formatHa(failing.lossHa)}</dd>
              </div>
              <div>
                <dt className="text-canopy-soft">Payments</dt>
                <dd className="font-semibold">Withheld</dd>
              </div>
            </dl>
          </div>
        </section>
      )}

      <footer className="mt-24 border-t border-contour pt-6 text-sm leading-relaxed text-canopy-soft">
        Runs on the PayPal sandbox. Farmers and plot owners are fictional; tree cover loss comes from Global Forest Watch (University of Maryland) data.
      </footer>
    </div>
  );
}
