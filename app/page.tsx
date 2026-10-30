import Link from 'next/link';
import { connection } from 'next/server';
import { MILESTONE_LABELS } from '@/lib/claim-copy';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { inputDealers } from '@/lib/db/schema';
import { formatUsd } from '@/lib/format';
import { PROGRAMMES } from '@/lib/programmes';
import { INR_PER_USD } from '@/lib/season-terms';
import { demoEntry } from '@/lib/services/entry';
import { plotRecord } from '@/lib/services/plot-record';
import { PaymentFlow } from './ui/payment-flow';
import { STEPS } from './ui/shell';

const panel = 'rounded-2xl border border-night-line bg-night-panel';

const STEP_NOTES: Record<number, string> = {
  1: 'Company sets stages and pays the season fund',
  2: 'Field officer walks the farm boundary',
  3: 'Farmer sends a photo and voice note',
  4: 'Code, GPS, AI, land and fund checks',
  5: 'PayPal pays farmer and dealer at once',
  6: 'Everyone sees every stage, live',
};

const PAYPAL = ['Checkout', 'Payouts', 'Authorize, capture, void', 'Refunds', 'Order tracking', 'Webhooks', 'Disputes', 'Transaction Search', 'Subscriptions', 'Saved PayPal'];

const STAGE_TONE = {
  RELEASED: { dot: 'bg-night-leaf text-black', text: 'text-night-leaf', label: 'Paid' },
  REVIEW: { dot: 'bg-night-monsoon text-black', text: 'text-night-monsoon', label: 'Checking' },
  PENDING: { dot: 'border border-night-line text-night-muted', text: 'text-night-faint', label: 'Later' },
  REJECTED: { dot: 'bg-night-cherry text-black', text: 'text-night-cherry', label: 'Refused' },
} as const;

function Tick() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="mt-0.5 size-5 shrink-0 text-night-leaf">
      <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 10.5l2.5 2.5L14 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SPEND = [
  { day: 10, label: 'Seed' },
  { day: 45, label: 'Fertiliser' },
  { day: 80, label: 'Spray' },
  { day: 125, label: 'Pickers' },
];
const dayX = (day: number) => 40 + (day / 160) * 600;

function Coin({ day, y, label, above = false }: { day: number; y: number; label: string; above?: boolean }) {
  return (
    <g>
      <circle cx={dayX(day)} cy={y} r={11} fill="var(--night-leaf)" />
      <text x={dayX(day)} y={y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="#000">
        $
      </text>
      <text x={dayX(day)} y={above ? y - 20 : y + 30} textAnchor="middle" fill="var(--night-leaf)" fontSize={13}>
        {label}
      </text>
    </g>
  );
}

// Today the farmer pays for every input (red) and is paid once after harvest; with AgriTranche
// each of those bills is paid the day its proof is checked.
function SeasonChart() {
  return (
    <svg
      viewBox="0 0 680 250"
      role="img"
      aria-label="Today the farmer pays for seed, fertiliser, spray and pickers and is paid once after harvest. With AgriTranche each bill is paid when its stage is proven."
      className="w-full"
    >
      <text x={0} y={30} fill="var(--night-muted)" fontSize={14}>
        Today: the farmer pays, then waits
      </text>
      <line x1={dayX(0)} x2={dayX(160)} y1={70} y2={70} stroke="var(--night-line)" strokeWidth={2} />
      {SPEND.map((s) => (
        <g key={s.label}>
          <circle cx={dayX(s.day)} cy={70} r={7} fill="var(--night-cherry)" />
          <text x={dayX(s.day)} y={98} textAnchor="middle" fill="var(--night-faint)" fontSize={13}>
            {s.label}
          </text>
        </g>
      ))}
      <Coin day={155} y={70} label="Paid once" above />

      <text x={0} y={150} fill="var(--night-muted)" fontSize={14}>
        With AgriTranche: every bill paid when proven
      </text>
      <line x1={dayX(0)} x2={dayX(160)} y1={190} y2={190} stroke="var(--night-leaf)" strokeOpacity={0.35} strokeWidth={2} />
      {SPEND.map((s) => (
        <Coin key={s.label} day={s.day} y={190} label={`${s.label} paid`} />
      ))}
    </svg>
  );
}

export default async function Home() {
  await connection();
  const database = await db();
  const { contractId, farmId } = await demoEntry(database);
  const farm = farmId ? await plotRecord(database, farmId) : null;
  const inputs = farm?.steps.find((s) => s.type === 'INPUTS');
  const [seller] = await database.select({ name: inputDealers.name }).from(inputDealers).where(eq(inputDealers.id, inputs?.rule?.dealerId ?? ''));

  return (
    <div className="min-h-full bg-night-canvas text-night-ink">
      <header className="sticky top-0 z-10 border-b border-night-line bg-night-canvas/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4 sm:px-10">
          <span className="text-lg font-bold tracking-tight">AgriTranche</span>
          <nav className="hidden gap-6 text-night-muted md:flex">
            <Link href="/company" className="hover:text-night-ink">
              Company
            </Link>
            <Link href="/farmer" className="hover:text-night-ink">
              Farmer
            </Link>
            <Link href="/coop" className="hover:text-night-ink">
              Field officer
            </Link>
          </nav>
          <Link href="/tour" className="rounded-md bg-night-ink px-4 py-2 text-sm font-semibold text-night-canvas hover:bg-white">
            Take the tour
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 sm:px-10">
        <section className="grid items-center gap-12 pt-16 sm:pt-24 lg:grid-cols-2">
          <div>
            <h1 className="text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl">Every stage of farm work, paid the moment it&apos;s proven.</h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-night-muted">
              Contract farming without the wait: the company funds the season, the farmer proves each stage from a phone, and PayPal pays in minutes.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/tour" className="rounded-md bg-night-ink px-6 py-3 font-semibold text-night-canvas hover:bg-white">
                Take the 3-minute tour
              </Link>
              <Link href={contractId ? `/contracts/${contractId}` : '/'} className="rounded-md border border-night-line px-6 py-3 font-semibold hover:border-night-muted">
                Open the company view
              </Link>
            </div>
          </div>

          {farm && (
            <Link href={`/farms/${farm.plot.id}`} className={`${panel} block p-6 hover:border-night-muted`}>
              <p className="text-night-muted">
                {farm.farmer}&apos;s farm · {farm.plot.name}
              </p>
              <p className="mt-1 text-sm text-night-faint">Live: season 2026-27</p>
              <ol className="mt-6 space-y-4">
                {farm.steps.map((stage) => {
                  const refused = farm.plot.status === 'FAIL' && stage.state !== 'RELEASED';
                  const tone = STAGE_TONE[refused ? 'REJECTED' : (stage.state as keyof typeof STAGE_TONE)] ?? STAGE_TONE.PENDING;
                  const paid = stage.payment?.items.reduce((sum, i) => sum + i.cents, 0);
                  const isNext = stage.id === farm.steps.find((s) => s.state !== 'RELEASED')?.id;
                  return (
                    <li key={stage.id} className="flex items-center gap-4">
                      <span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${tone.dot}`}>{stage.state === 'RELEASED' ? '✓' : ''}</span>
                      <span className="flex-1 text-lg">{MILESTONE_LABELS[stage.type].title}</span>
                      <span className={`tabular-nums ${isNext && stage.state === 'PENDING' && !refused ? 'text-night-ink' : tone.text}`}>
                        {paid ? formatUsd(paid) : isNext && stage.state === 'PENDING' && !refused ? 'Next' : tone.label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </Link>
          )}
        </section>

        <section className="mt-28">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Farmers grow the crop on credit</h2>
          <p className="mt-3 max-w-2xl text-lg text-night-muted">The company pays after harvest, so the farmer borrows for every input. Paying at each proven stage ends that.</p>
          <div className={`${panel} mt-8 p-6`}>
            <SeasonChart />
          </div>
        </section>

        <section className="mt-28">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">How it works</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.step}>
                <Link href={step.href} className={`${panel} flex h-full items-start gap-4 p-5 hover:border-night-muted`}>
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-night-ink text-lg font-bold text-night-canvas tabular-nums">{step.step}</span>
                  <span>
                    <span className="block text-lg font-bold">{step.label}</span>
                    <span className="mt-1 block text-night-muted">{STEP_NOTES[step.step]}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-28 grid items-center gap-10 lg:grid-cols-2">
          <div className={`${panel} mx-auto w-full max-w-sm p-3`}>
            <div className="rounded-xl bg-survey p-4 text-canopy">
              <p className="text-sm text-canopy-soft">{MILESTONE_LABELS.INPUTS.title} · proof</p>
              {inputs?.rule && seller && (
                <>
                  <div className="mt-2 rotate-[-1.5deg] rounded-md border border-contour bg-sheet p-3 shadow-sm">
                    <p className="font-semibold">{seller.name}</p>
                    <p className="text-xs text-canopy-soft">Tax invoice · fertiliser</p>
                    <p className="mt-2 flex items-baseline justify-between">
                      <span className="text-sm">Total</span>
                      <span className="font-mono text-lg font-bold">₹{Math.round((inputs.rule.capCents / 100) * INR_PER_USD).toLocaleString('en-IN')}</span>
                    </p>
                    <p className="mt-2 inline-block rounded border border-dashed border-canopy/40 px-2 font-mono text-sm tracking-[0.15em]">today&apos;s code</p>
                  </div>
                  <div className="mt-4">
                    <PaymentFlow
                      payees={[
                        { name: seller.name, role: 'Input seller', cents: inputs.rule.capCents },
                        { name: farm?.farmer ?? 'Farmer', role: 'Farmer', cents: inputs.rule.labourCents },
                      ]}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
          <div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Proof in one minute</h2>
            <ul className="mt-6 space-y-3 text-lg">
              {["Today's code is in the photo", 'The phone is on the farm', 'Gemini reads the photo, bill and voice note', 'Satellite shows no forest cleared since 2020', 'The season fund covers it'].map(
                (check) => (
                  <li key={check} className="flex gap-3">
                    <Tick />
                    {check}
                  </li>
                ),
              )}
            </ul>
            <p className="mt-5 text-night-muted">The AI only reads. Code decides the money, and anything unsure waits for a person.</p>
          </div>
        </section>

        {inputs?.rule && (
          <section className="mt-28">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Money goes where it should</h2>
            <p className="mt-3 text-lg text-night-muted">Fertiliser money goes to the dealer, so it can&apos;t be spent on anything else.</p>
            <div className={`${panel} mt-8 grid items-center gap-6 p-6 md:grid-cols-[1fr_auto_1fr]`}>
              <div>
                <p className="text-night-muted">
                  {farm?.farmer}: {MILESTONE_LABELS.INPUTS.title.toLowerCase()}
                </p>
                <p className="text-4xl font-bold tabular-nums">up to {formatUsd(inputs.trancheCents)}</p>
              </div>
              <svg viewBox="0 0 120 100" aria-hidden className="mx-auto hidden h-24 md:block">
                <path d="M0 50 C 60 50, 60 15, 120 15" fill="none" stroke="var(--night-leaf)" strokeWidth={3} />
                <path d="M0 50 C 60 50, 60 85, 120 85" fill="none" stroke="var(--night-leaf)" strokeWidth={3} />
              </svg>
              <dl className="space-y-4">
                <div>
                  <dt className="text-night-muted">Input dealer: the bill, up to</dt>
                  <dd className="text-2xl font-bold tabular-nums">{formatUsd(inputs.rule.capCents)}</dd>
                </div>
                <div>
                  <dt className="text-night-muted">Farmer: labour</dt>
                  <dd className="text-2xl font-bold tabular-nums">{formatUsd(inputs.rule.labourCents)}</dd>
                </div>
              </dl>
            </div>
          </section>
        )}

        <section className="mt-28">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Any crop, any company</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {PROGRAMMES.map((p) => (
              <article key={p.id} className={`${panel} p-5`}>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-xl font-bold">{p.crop}</h3>
                  <span className={p.live ? 'text-sm font-semibold text-night-leaf' : 'text-sm text-night-faint'}>{p.live ? 'Running now' : 'Ready to use'}</span>
                </div>
                <p className="text-night-muted">
                  {p.origin}, for {p.buyer}
                </p>
                <ol className="mt-4 flex flex-wrap gap-2">
                  {p.stages.map((stage, i) => (
                    <li key={stage} className="rounded-full border border-night-line px-3 py-1 text-sm">
                      <span className="text-night-faint tabular-nums">{i + 1}</span> {stage}
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-28">
          <h2 className="text-2xl font-bold tracking-tight">Built on PayPal</h2>
          <ul className="mt-5 flex flex-wrap gap-2">
            {PAYPAL.map((name) => (
              <li key={name} className="rounded-full border border-night-line px-4 py-1.5 text-night-muted">
                {name}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-night-muted">With Gemini on Vertex AI, Global Forest Watch, Open-Meteo, AG Studio and AG Grid.</p>
        </section>
      </main>

      <footer className="mx-auto mt-28 max-w-6xl border-t border-night-line px-6 py-8 text-sm leading-relaxed text-night-faint sm:px-10">
        Runs on the PayPal sandbox. Companies, farmers and farms are fictional. Prices, yields and the tree cover loss at each farm are real public data.
      </footer>
    </div>
  );
}
