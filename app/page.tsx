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

const panel = 'rounded-2xl border border-night-line bg-night-panel';

const PROBLEMS = [
  'The farmer pays for seed, fertiliser and labour now, but the company pays only after harvest.',
  'So the farmer borrows, often at high interest, to grow a crop that is already sold.',
  "The company won't pay earlier, because it can't see the money reaching the crop.",
];

const USEFUL_FOR = ['Contract farming', 'Input finance', 'Labour and machinery payments', 'Deforestation-free sourcing', 'Good-practice bonuses'];

const PAYPAL = ['Checkout', 'Payouts', 'Authorize, capture, void', 'Refunds', 'Order tracking', 'Webhooks', 'Disputes', 'Transaction Search', 'Subscriptions', 'Saved PayPal'];

const STAGE_TONE = {
  RELEASED: { dot: 'bg-night-leaf text-black', text: 'text-night-leaf', label: 'Paid' },
  REVIEW: { dot: 'bg-night-monsoon text-black', text: 'text-night-monsoon', label: 'Checking' },
  PENDING: { dot: 'border border-night-line text-night-muted', text: 'text-night-faint', label: 'Later' },
  REJECTED: { dot: 'bg-night-cherry text-black', text: 'text-night-cherry', label: 'Refused' },
} as const;

function Story({ n, title, body, children }: { n: number; title: string; body: string; children: React.ReactNode }) {
  return (
    <li className="grid items-center gap-5 rounded-2xl border border-night-line bg-night-panel p-5 md:grid-cols-[auto_1fr_minmax(0,24rem)]">
      <span className="grid size-11 place-items-center rounded-full bg-night-leaf text-lg font-bold text-black tabular-nums">{n}</span>
      <div>
        <h3 className="text-xl font-bold">{title}</h3>
        <p className="mt-1 text-night-muted">{body}</p>
      </div>
      <div className="min-w-0 md:justify-self-end">{children}</div>
    </li>
  );
}

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

// Today the farmer pays for every input (red) and is paid once after harvest; with FarmProof
// each of those bills is paid the day its proof is checked.
function SeasonChart() {
  return (
    <svg
      viewBox="0 0 680 250"
      role="img"
      aria-label="Today the farmer pays for seed, fertiliser, spray and pickers and is paid once after harvest. With FarmProof each bill is paid when its stage is proven."
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
        With FarmProof: every bill paid when proven
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
  const sellerLine = inputs?.rule?.lines.find((l) => l.kind === 'INPUTS');
  const billRupees = sellerLine ? Math.round((sellerLine.capCents / 100) * INR_PER_USD) : 0;
  const [seller] = await database.select({ name: inputDealers.name }).from(inputDealers).where(eq(inputDealers.id, sellerLine?.payeeId ?? ''));

  return (
    <div className="min-h-full bg-night-canvas text-night-ink">
      <header className="sticky top-0 z-10 border-b border-night-line bg-night-canvas/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4 sm:px-10">
          <span className="text-lg font-bold tracking-tight">FarmProof</span>
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
              Contract farming without the wait. The company funds the season. The farmer proves each stage with one photo. PayPal pays the farmer, and the
              people they buy from, within minutes.
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
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">The problem</h2>
          <div className="mt-8 grid items-center gap-6 lg:grid-cols-[1fr_1.4fr]">
            <ul className="space-y-4 text-lg">
              {PROBLEMS.map((line) => (
                <li key={line} className="flex gap-3">
                  <span aria-hidden className="mt-2 size-2.5 shrink-0 rounded-full bg-night-cherry" />
                  {line}
                </li>
              ))}
            </ul>
            <div className={`${panel} p-6`}>
              <SeasonChart />
            </div>
          </div>
        </section>

        {inputs?.rule && sellerLine && seller && farm && (
          <section className="mt-28">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">How it works: one bill, start to finish</h2>
            <p className="mt-3 max-w-2xl text-lg text-night-muted">
              {farm.farmer} grows coffee in {farm.plot.name}. The contract pays the fertiliser stage once the purchase is proven.
            </p>
            <ol className="mt-10 space-y-4">
              <Story n={1} title={`${farm.farmer} buys fertiliser from ${seller.name}`} body="The shop gives a bill, as it always does.">
                <div className="w-56 rotate-[-1.5deg] rounded-md bg-survey p-3 text-canopy">
                  <p className="font-semibold">{seller.name}</p>
                  <p className="text-xs text-canopy-soft">Tax invoice · fertiliser</p>
                  <p className="mt-2 flex items-baseline justify-between">
                    <span className="text-sm">Total</span>
                    <span className="font-mono text-lg font-bold">₹{billRupees.toLocaleString('en-IN')}</span>
                  </p>
                </div>
              </Story>
              <Story n={2} title="The bill is photographed on the farm" body="With today's code written on paper beside it, so an old or borrowed photo can't be reused.">
                <div className="w-56 rounded-md bg-survey p-3 text-canopy">
                  <p className="text-xs text-canopy-soft">Today&apos;s code</p>
                  <p className="font-mono text-2xl font-bold tracking-[0.15em]">K7Q2MX</p>
                  <p className="mt-1 text-xs text-canopy-soft">Sent from inside the farm boundary</p>
                </div>
              </Story>
              <Story n={3} title="FarmProof checks it in seconds" body="The AI only reads the photo. Code decides, and anything unsure goes to a person.">
                <ul className="space-y-1.5">
                  {["Today's code is in the photo", 'The phone is on the farm', `Bill total read: ₹${billRupees.toLocaleString('en-IN')}`, 'No forest cleared since 2020', 'The season fund covers it'].map((check) => (
                    <li key={check} className="flex gap-2">
                      <Tick />
                      {check}
                    </li>
                  ))}
                </ul>
              </Story>
              <Story n={4} title="PayPal pays both, in one go" body="The fertiliser money goes straight to the shop, so it can't be spent on anything else.">
                <div className="w-full max-w-sm rounded-xl bg-survey p-3 text-canopy">
                  <PaymentFlow
                    payees={[
                      { name: seller.name, role: 'Input seller', cents: sellerLine.capCents },
                      { name: farm.farmer, role: 'Farmer', cents: inputs.rule.labourCents },
                    ]}
                  />
                </div>
              </Story>
              <Story n={5} title="The company sees it, with the proof" body="Every payment keeps its photo, its checks and its PayPal receipt, ready for any audit.">
                <Link href={`/farms/${farm.plot.id}`} className="font-semibold text-night-leaf underline-offset-4 hover:underline">
                  Open {farm.farmer}&apos;s farm record
                </Link>
              </Story>
            </ol>
            <ul className="mt-8 flex flex-wrap gap-2">
              {USEFUL_FOR.map((use) => (
                <li key={use} className="rounded-full border border-night-line px-3 py-1 text-sm text-night-muted">
                  {use}
                </li>
              ))}
            </ul>
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
        Payment on proof, not on promises. Runs on the PayPal sandbox: companies, farmers and farms are fictional; prices, yields and the tree cover loss at
        each farm are real public data.
      </footer>
    </div>
  );
}
