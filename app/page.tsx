import Image from 'next/image';
import Link from 'next/link';
import { connection } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { MILESTONE_LABELS } from '@/lib/claim-copy';
import { db } from '@/lib/db/client';
import { buyers, contracts, inputDealers } from '@/lib/db/schema';
import { formatUsd } from '@/lib/format';
import { STAGE_PHOTOS } from '@/lib/photos';
import { PROGRAMMES } from '@/lib/programmes';
import { INR_PER_USD } from '@/lib/season-terms';
import { seasonEntry } from '@/lib/services/entry';
import { plotRecord } from '@/lib/services/plot-record';
import { visitorSeason } from '@/lib/visitor';
import { HeroStory, type StoryStage } from './ui/hero-story';
import { CropIcon } from './ui/crop-icon';
import { PaymentFlow } from './ui/payment-flow';
import { SatelliteMap } from './ui/satellite-map';

const panel = 'rounded-2xl border border-night-line bg-night-panel';

const CAPTIONS = {
  PLOT_VERIFIED: 'On the farm with today’s code. The land check passes and the first payment goes out.',
  INPUTS: 'The shop’s bill is photographed on the farm. The shop is paid from the fund; the farmer gets a share.',
  CROP_CARE: 'Spray and crew bills are proven the same way. Satellite and weather checks back up the photo.',
  HARVEST: 'The pickers’ wage sheet is paid the day the cherries are picked, not months later.',
  PROCESSING: 'Pulper and lorry hire are paid when the dried coffee leaves the farm.',
} as const;

const SHORT = { PLOT_VERIFIED: 'Mapped', INPUTS: 'Fertiliser', CROP_CARE: 'Crop care', HARVEST: 'Harvest', PROCESSING: 'Processing' } as const;

const CHECKS = {
  PLOT_VERIFIED: ['Today’s code in the photo', 'Phone inside the farm boundary', 'No forest cleared since 2020'],
  INPUTS: ['Today’s code in the photo', 'Bill from the registered shop', 'Fund covers the bill'],
  CROP_CARE: ['Today’s code in the photo', 'No downpour on spraying day', 'Green canopy from space'],
  HARVEST: ['Today’s code in the photo', 'Ripe crop in the photo', 'Wage sheet not paid before'],
  PROCESSING: ['Today’s code in the photo', 'Picked crop in the photo', 'Hire bill dated this stage'],
} as const;

const FACTS = [
  { value: '50.2%', text: 'of farming households in India are in debt, a third of it to informal lenders', source: 'NSO, Report 587' },
  { value: '$200B+', text: 'a year: the financing gap smallholders face worldwide', source: 'ISF Advisors, 2025' },
  { value: '4–9 months', text: 'from sowing to sale with no income from the crop', source: 'Crop calendars of the four contracts on FarmProof' },
];

const CHECKED = [
  { kind: 'Rule', name: 'Today’s code', text: 'A one-time code from the app is written on paper in the photo, so an old or borrowed photo can’t pass.' },
  { kind: 'Rule', name: 'On the farm', text: 'The phone is inside the farm’s mapped boundary when the proof is sent.' },
  { kind: 'Rule', name: 'Right stage, right time', text: 'Stages are paid in order, and only while each stage’s window in the crop calendar is open.' },
  { kind: 'Rule', name: 'Crop stage in the photo', text: 'AI reads what the photo shows, from sowing to harvest, and it has to fit the stage being claimed.' },
  { kind: 'Rule', name: 'The bills', text: 'Each bill names the supplier being paid, is dated within the stage and stays within that stage’s limit.' },
  { kind: 'Rule', name: 'Never paid twice', text: 'A copy of an earlier photo, or a bill already paid this season, is caught.' },
  { kind: 'Rule', name: 'Land check', text: 'No forest has been cleared on the farm since 2020, from Global Forest Watch satellite data.' },
  { kind: 'Rule', name: 'Fund covers it', text: 'The season fund holds enough for the payment before anything is sent.' },
  { kind: 'Signal', name: 'Camera location and time', text: 'Where and when the camera says the photo was taken.' },
  { kind: 'Signal', name: 'Crop from space', text: 'Monthly greenness from Sentinel-2 shows the crop growing on that land.' },
  { kind: 'Signal', name: 'Weather', text: 'No downpour on a day fertiliser or spray was put on.' },
  { kind: 'Signal', name: 'Seller confirms', text: 'After payment, the seller confirms the bill was really theirs.' },
] as const;

const USEFUL_FOR = ['Contract farming', 'Input finance', 'Labour and machinery payments', 'Deforestation-free sourcing', 'Good-practice bonuses'];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-6 text-night-leaf" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  checkout: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6M10 21h.01M17 21h.01',
  payouts: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z',
  identity: 'M20 21a8 8 0 1 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  books: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM20 17v4H6.5A2.5 2.5 0 0 1 4 18.5M9 7h7M9 11h5',
  plan: 'M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3',
  agent: 'M12 8V4H8M4 12h16v8H4zM2 16h2M20 16h2M9 15v1M15 15v1',
  ai: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z',
  satellite: 'M13 7 9 3 5 7l4 4M17 11l4 4-4 4-4-4M8 12l4 4M16 8l3-3M9 21a6 6 0 0 1-6-6',
  weather: 'M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3M8 19v2M8 13v2M12 21v2M12 15v2M16 19v2M16 13v2',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  cloud: 'M17.5 19H7a5 5 0 1 1 1.2-9.86A6 6 0 0 1 19.5 11a4 4 0 0 1-2 8z',
};

const SERVICES = [
  { icon: 'checkout', name: 'Checkout and Orders', job: 'The company funds the season, and pays the delivery balance only for what passes quality.', features: ['Checkout', 'Authorize, capture, void', 'Order tracking', 'Refunds'] },
  { icon: 'payouts', name: 'Payouts', job: 'Each proven stage pays the seller, the labour group and the farmer in one batch, confirmed by webhook.', features: ['Payouts batches', 'Webhooks'] },
  { icon: 'identity', name: 'Identity', job: 'Farmers join with their own PayPal account, which is where their money lands.', features: ['Log in with PayPal', 'Saved PayPal (Vault)'] },
  { icon: 'books', name: 'Reporting and disputes', job: 'The books are checked against PayPal every day. A buyer dispute gets an AI-drafted evidence pack, sent only after a person approves.', features: ['Transaction Search', 'Balances', 'Disputes'] },
  { icon: 'plan', name: 'Subscriptions', job: 'The company’s workspace plan.', features: ['Subscriptions'] },
  { icon: 'agent', name: 'Agent Toolkit', job: 'The Season Agent looks things up in PayPal. It can read, never pay.', features: ['Transactions', 'Orders', 'Tracking', 'Disputes'] },
  { icon: 'grid', name: 'AG Grid and AG Studio', job: 'The company’s season dashboard: every farm and payment as grids and charts, and an AI agent that answers in charts.', features: ['AG Grid', 'AG Studio', 'Season Agent'] },
  { icon: 'cloud', name: 'Render', job: 'Hosts the app and its database, deploys only after the tests pass, and runs the daily checks of the books.', features: ['Web service', 'Disk', 'Cron jobs'] },
] as const;

const ALSO = [
  { icon: 'ai', name: 'Gemini AI', job: 'Reads the code, the crop stage, every bill and the voice note in any language.' },
  { icon: 'satellite', name: 'Copernicus and Global Forest Watch', job: 'Monthly crop greenness from Sentinel-2 and tree cover lost since 2020.' },
  { icon: 'weather', name: 'Open-Meteo', job: 'Rain on the day a spray or fertiliser stage is claimed.' },
] as const;

function Step({ n, title, body, children, last = false }: { n: number; title: string; body: string; children: React.ReactNode; last?: boolean }) {
  return (
    <li>
      <div className="grid items-center gap-5 rounded-2xl border border-night-line bg-night-panel p-5 md:grid-cols-[auto_1fr_minmax(0,22rem)]">
        <span className="grid size-11 place-items-center rounded-full bg-night-leaf text-lg font-bold text-black tabular-nums">{n}</span>
        <div>
          <h3 className="text-xl font-bold">{title}</h3>
          <p className="mt-1 text-night-muted">{body}</p>
        </div>
        <div className="min-w-0 md:justify-self-end">{children}</div>
      </div>
      {!last && (
        <svg viewBox="0 0 24 32" aria-hidden className="ml-[1.9rem] h-8 w-6 text-night-leaf">
          <path d="M12 2v24" stroke="currentColor" strokeWidth={2} strokeDasharray="3 3" className="money-flow" />
          <path d="M6 22l6 7 6-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
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

function SeasonChart() {
  return (
    <svg
      viewBox="0 0 680 250"
      role="img"
      aria-label="Today the farmer pays for seed, fertiliser, spray and pickers and is paid once after harvest. With FarmProof each bill is paid when its stage is proven."
      className="w-full"
    >
      <text x={0} y={30} fill="var(--night-muted)" fontSize={14}>
        Today: the farmer pays, borrows, then waits for harvest
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
        With FarmProof: money arrives as each cost falls due
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
  const { contractId, farmId } = await seasonEntry(database, await visitorSeason(database));
  const farm = farmId ? await plotRecord(database, farmId) : null;
  const [season] = contractId
    ? await database.select({ fundCents: contracts.advanceCents, buyer: buyers.name }).from(contracts).innerJoin(buyers, eq(contracts.buyerId, buyers.id)).where(eq(contracts.id, contractId))
    : [];
  const payeeIds = farm?.steps.flatMap((s) => s.rule?.lines.map((l) => l.payeeId) ?? []) ?? [];
  const suppliers = new Map(
    (payeeIds.length ? await database.select({ id: inputDealers.id, name: inputDealers.name, kind: inputDealers.kind }).from(inputDealers).where(inArray(inputDealers.id, payeeIds)) : []).map((s) => [s.id, s]),
  );
  const ROLE = { INPUTS: 'Input seller', LABOUR: 'Labour group', MACHINERY: 'Machinery hire' } as const;

  const story: StoryStage[] = (farm?.steps ?? []).map((s) => ({
    title: MILESTONE_LABELS[s.type].title,
    short: SHORT[s.type],
    caption: CAPTIONS[s.type],
    photo: STAGE_PHOTOS.coffee[s.type],
    map: s.type === 'PLOT_VERIFIED',
    checks: [...CHECKS[s.type]],
    payees: s.rule
      ? [
          ...s.rule.lines.map((l) => ({ name: suppliers.get(l.payeeId)?.name ?? 'Supplier', role: ROLE[l.kind], cents: l.capCents, farmer: false })),
          { name: farm!.farmer, role: 'Farmer', cents: s.rule.labourCents, farmer: true },
        ]
      : [{ name: farm!.farmer, role: 'Farmer', cents: s.trancheCents, farmer: true }],
  }));

  const inputs = farm?.steps.find((s) => s.type === 'INPUTS');
  const sellerLine = inputs?.rule?.lines.find((l) => l.kind === 'INPUTS');
  const seller = sellerLine ? suppliers.get(sellerLine.payeeId) : undefined;
  const billRupees = sellerLine ? Math.round((sellerLine.capCents / 100) * INR_PER_USD) : 0;

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
            <Link href="/company?view=dashboard" className="hover:text-night-ink">
              Dashboard
            </Link>
            <Link href="/opportunities" className="hover:text-night-ink">
              Opportunities
            </Link>
          </nav>
          <Link href="/tour" className="rounded-md bg-night-ink px-4 py-2 text-sm font-semibold text-night-canvas hover:bg-white">
            Take the tour
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 sm:px-10">
        <section className="grid items-center gap-12 pt-10 sm:pt-14 lg:min-h-[calc(100vh-4.5rem)] lg:grid-cols-[1fr_1.05fr] lg:pt-0">
          <div>
            <p className="font-semibold text-night-leaf">Contract farming without the cash crunch</p>
            <h1 className="mt-3 text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl">Money in the farmer&apos;s hand at every stage of the season.</h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-night-muted">
              A company funds the season once with PayPal. Each time the farmer proves a stage of work with one photo, PayPal pays the bills and the farmer&apos;s
              share within minutes. No loan to carry until harvest.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/tour" className="rounded-md bg-night-ink px-6 py-3 font-semibold text-night-canvas hover:bg-white">
                Take the 3-minute tour
              </Link>
              <Link href="/opportunities" className="rounded-md border border-night-line px-6 py-3 font-semibold hover:border-night-muted">
                See the open contracts
              </Link>
            </div>
          </div>
          {farm && season && story.length > 0 && <HeroStory buyer={season.buyer} farmer={farm.farmer.split(' ')[0]} fundCents={season.fundCents} stages={story} farm={{ id: farm.plot.id, name: farm.plot.name, ring: farm.plot.ring }} />}
        </section>

        <section className="mt-28">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">The problem: months of costs, no income, then one payment</h2>
          <p className="mt-3 max-w-3xl text-lg text-night-muted">
            In contract farming a company agrees to buy the crop before it is grown, but pays only on delivery. From sowing to sale takes four to nine months. In
            that time the farmer pays for seed, fertiliser, sprays and workers, and the household still has to eat, pay school fees and see a doctor, with no
            income from the crop. So the farmer borrows, often from a moneylender, against a crop that is already sold. The company would pay earlier, but it
            can&apos;t see its money turning into farm work.
          </p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {FACTS.map((f) => (
              <li key={f.value} className={`${panel} p-5`}>
                <p className="text-3xl font-bold text-night-cherry">{f.value}</p>
                <p className="mt-1 text-night-muted">{f.text}</p>
                <p className="mt-2 text-xs text-night-faint">{f.source}</p>
              </li>
            ))}
          </ul>
          <div className={`${panel} mt-4 p-6`}>
            <SeasonChart />
          </div>
          <p className="mt-4 max-w-3xl text-lg">
            FarmProof turns the season&apos;s payment into working money: each cost is paid when it falls due, so the farmer never runs dry mid-season and the
            company can see every dollar reach the crop.
          </p>
        </section>

        {farm && inputs?.rule && sellerLine && seller && season && (
          <section className="mt-28">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">How it works, from contract to harvest</h2>
            <ol className="mt-10">
              <Step n={1} title={`Buyer ${season.buyer} posts a contract and funds it`} body="Crop, price, expected yield and what each stage pays. The season fund is paid in once with PayPal Checkout.">
                <div className="w-60 rounded-md bg-survey p-3 text-canopy">
                  <p className="text-xs text-canopy-soft">Coffee season 2026-27 · Kodagu</p>
                  <p className="mt-1 flex justify-between">
                    <span>Season fund</span>
                    <span className="font-bold tabular-nums">{formatUsd(season.fundCents)}</span>
                  </p>
                  <p className="mt-1 text-xs text-leaf">Paid in with PayPal</p>
                </div>
              </Step>
              <Step n={2} title={`Farmer ${farm.farmer} joins and is verified`} body="The farmer signs in with PayPal and walks the farm boundary with a phone. A satellite land check confirms no forest was cleared since 2020.">
                <ul className="space-y-1.5">
                  {['PayPal account linked', `${farm.plot.name} mapped`, 'Land check passed'].map((c) => (
                    <li key={c} className="flex gap-2">
                      <Tick />
                      {c}
                    </li>
                  ))}
                </ul>
              </Step>
              <Step n={3} title={`The farmer buys fertiliser from input seller ${seller.name}`} body="The shop gives a bill, as it always does.">
                <div className="w-56 rotate-[-1.5deg] rounded-md bg-survey p-3 text-canopy">
                  <p className="font-semibold">{seller.name}</p>
                  <p className="text-xs text-canopy-soft">Tax invoice · fertiliser</p>
                  <p className="mt-2 flex items-baseline justify-between">
                    <span className="text-sm">Total</span>
                    <span className="font-mono text-lg font-bold">₹{billRupees.toLocaleString('en-IN')}</span>
                  </p>
                </div>
              </Step>
              <Step n={4} title="The bill is photographed on the farm" body="With today's code written on paper beside it, so an old or borrowed photo can't be reused.">
                <div className="w-56 rounded-md bg-survey p-3 text-canopy">
                  <p className="text-xs text-canopy-soft">Today&apos;s code</p>
                  <p className="font-mono text-2xl font-bold tracking-[0.15em]">K7Q2MX</p>
                  <p className="mt-1 text-xs text-canopy-soft">Sent from inside the farm boundary</p>
                </div>
              </Step>
              <Step n={5} title="FarmProof checks it in seconds" body="AI reads the photo and the bill. Fixed rules decide, and anything unsure goes to a field officer.">
                <ul className="space-y-1.5">
                  {["Today's code is in the photo", 'The phone is on the farm', `Bill total read: ₹${billRupees.toLocaleString('en-IN')}`, 'The season fund covers it'].map((check) => (
                    <li key={check} className="flex gap-2">
                      <Tick />
                      {check}
                    </li>
                  ))}
                </ul>
              </Step>
              <Step n={6} title="PayPal pays the shop and the farmer" body="The fertiliser money goes straight to the shop, so it can't be spent on anything else. The farmer's share lands in their own PayPal account the same minute.">
                <div className="w-full max-w-sm rounded-xl bg-survey p-3 text-canopy">
                  <PaymentFlow
                    payees={[
                      { name: seller.name, role: 'Input seller', cents: sellerLine.capCents },
                      { name: farm.farmer, role: 'Farmer', cents: inputs.rule.labourCents },
                    ]}
                  />
                </div>
              </Step>
              <Step n={7} last title="At harvest, the balance is paid for what passes quality" body="The company authorizes the balance, captures only the accepted weight and grade, and the shipment is tracked. Every payment keeps its photo, checks and PayPal receipt.">
                <Link href={`/farms/${farm.plot.id}`} className="font-semibold text-night-leaf underline-offset-4 hover:underline">
                  Open farmer {farm.farmer}&apos;s record
                </Link>
              </Step>
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
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">What is checked before every payment</h2>
          <p className="mt-3 max-w-3xl text-lg text-night-muted">
            The same checks run for every crop and every stage. Rules decide whether a stage is paid; signals back them up, and any signal that disagrees holds
            the claim.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CHECKED.map((c) => (
              <li key={c.name} className={`${panel} p-4`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold">{c.name}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.kind === 'Rule' ? 'bg-night-leaf/15 text-night-leaf' : 'bg-night-monsoon/15 text-night-monsoon'}`}>{c.kind}</span>
                </div>
                <p className="mt-1.5 text-sm text-night-muted">{c.text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-5 max-w-3xl text-night-muted">
            Anything doubtful is held, never paid on a guess. An AI review agent investigates and a second AI pass looks for reasons not to pay, then a field
            officer decides. AI only reads the evidence; fixed rules move the money.
          </p>
        </section>

        {farm && (
          <section className="mt-28">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">A coffee season in Karnataka</h2>
            <p className="mt-3 max-w-2xl text-lg text-night-muted">
              Five stages, each paid when it is proven. Coffee here grows under tall shade trees, which is why these farms look like forest from above.
            </p>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {farm.steps.map((stage) => {
                const photo = STAGE_PHOTOS.coffee[stage.type];
                return (
                  <li key={stage.id} className={`${panel} overflow-hidden`}>
                    <div className="relative aspect-[4/3]">
                      {stage.type === 'PLOT_VERIFIED' ? (
                        <SatelliteMap plots={[{ id: farm.plot.id, name: farm.plot.name, ring: farm.plot.ring, status: 'PASS' }]} width={480} ratio={0.75} linked={false} caption={false} title={`${farm.plot.name} mapped on satellite imagery`} className="[&_svg]:rounded-none" />
                      ) : (
                        <Image src={photo.src} alt={photo.alt} fill sizes="(min-width: 1024px) 20vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
                      )}
                    </div>
                    <div className="p-4">
                      <h3 className="font-bold">{MILESTONE_LABELS[stage.type].title}</h3>
                      <p className="mt-1 text-sm text-night-muted">Pays {formatUsd(stage.trancheCents)} on this farm</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 text-xs text-night-faint">
              Farm map: Esri, Maxar, Earthstar Geographics. Photos from Wikimedia Commons contributors.{' '}
              <Link href="/credits" className="underline underline-offset-2 hover:text-night-muted">
                Credits and licences
              </Link>
            </p>
          </section>
        )}

        <section className="mt-28">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Any crop, any company, any currency</h2>
            <Link href="/opportunities" className="font-semibold text-night-leaf underline-offset-4 hover:underline">
              See the opportunity board
            </Link>
          </div>
          <p className="mt-3 max-w-3xl text-lg text-night-muted">
            Each company sets its own crop, stages and price. Bills are read in the farmer&apos;s currency, rupees in India and US dollars in Peru, and PayPal
            carries the money across borders.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {PROGRAMMES.map((p) => (
              <article key={p.id} className={`${panel} p-5`}>
                <div className="flex items-center gap-4">
                  <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-night-leaf/10">
                    <CropIcon crop={p.id} />
                  </span>
                  <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-xl font-bold">{p.crop}</h3>
                  {p.live ? (
                    <span className="text-sm font-semibold text-night-leaf">Running now</span>
                  ) : (
                    <Link href="/opportunities/new" className="text-sm font-semibold text-night-leaf underline-offset-4 hover:underline">
                      Post one
                    </Link>
                  )}
                </div>
                <p className="text-night-muted">
                  {p.origin}, for {p.buyer}
                </p>
                  </div>
                </div>
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
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Built on</h2>
          <p className="mt-3 max-w-2xl text-lg text-night-muted">PayPal moves every dollar and each of its services has a job in the season. AG Grid shows the season to the company, and Render runs it all.</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SERVICES.map((s) => (
              <li key={s.name} className={`${panel} p-5`}>
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-xl bg-night-leaf/10">
                    <Icon d={ICONS[s.icon]} />
                  </span>
                  <h3 className="text-lg font-bold">{s.name}</h3>
                </div>
                <p className="mt-3 text-night-muted">{s.job}</p>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {s.features.map((f) => (
                    <li key={f} className="rounded-full border border-night-line px-2.5 py-0.5 text-xs">
                      {f}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <h3 className="mt-12 text-xl font-bold">With</h3>
          <ul className="mt-4 grid gap-4 sm:grid-cols-3">
            {ALSO.map((a) => (
              <li key={a.name} className={`${panel} p-4`}>
                <Icon d={ICONS[a.icon]} />
                <p className="mt-2 font-semibold">{a.name}</p>
                <p className="mt-1 text-sm text-night-muted">{a.job}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="mx-auto mt-28 max-w-6xl border-t border-night-line px-6 py-8 text-sm leading-relaxed text-night-faint sm:px-10">
        Payment on proof, not on promises. Runs on the PayPal sandbox; prices, yields, farm boundaries and tree cover loss come from public data.
      </footer>
    </div>
  );
}
