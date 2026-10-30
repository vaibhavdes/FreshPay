import Link from 'next/link';
import { connection } from 'next/server';
import { MILESTONE_LABELS } from '@/lib/claim-copy';
import { db } from '@/lib/db/client';
import { formatHa, formatUsd } from '@/lib/format';
import { contractRows, type PlotRow } from '@/lib/services/contract-rows';
import { showcasePlots } from '@/lib/services/showcase';
import { PlotOutline } from './ui/plot-outline';

type Story = NonNullable<Awaited<ReturnType<typeof showcasePlots>>['passing']>;

const STEPS = [
  { title: 'Fund', body: 'The buyer pays the season advance with PayPal. It is held for that contract only.' },
  { title: 'Prove', body: "The farmer photographs today's code on the plot and says what they did." },
  { title: 'Verify', body: 'AI reads the evidence. Code checks location, timing, satellite data and the funds left.' },
  { title: 'Pay', body: "PayPal Payouts sends the farmer's share and the input dealer's in one batch." },
];

const PAYPAL_USES = [
  { api: 'Orders v2 and JS SDK v6', use: 'The buyer funds the season advance with the PayPal button.' },
  { api: 'Payouts', use: 'Each verified milestone pays the farmer and their input dealer in one batch.' },
  { api: 'Webhooks', use: 'Signed events confirm every payout; replays are recognised and ignored.' },
  { api: 'Authorize and capture', use: 'At delivery only the accepted weight and grade is captured; the rest is voided.' },
  { api: 'Refunds', use: 'If verified bad weather ends the season, the unearned advance goes back.' },
  { api: 'Vault', use: 'The buyer approves a capped mandate for the per-plot traceability premium.' },
];

const BUILT_WITH = ['PayPal Orders v2', 'PayPal JS SDK v6', 'PayPal Payouts', 'PayPal Webhooks', 'PayPal Server SDK', 'Gemini on Vertex AI', 'Global Forest Watch', 'Open-Meteo', 'AG Grid', 'Render'];

const panel = 'rounded-xl border border-night-line bg-night-panel';
const solidPanel = 'rounded-xl border border-night-line bg-[#0a0d0b]';

function Tick({ tone = 'leaf' }: { tone?: 'leaf' | 'cherry' }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={`mt-0.5 size-5 shrink-0 ${tone === 'leaf' ? 'text-night-leaf' : 'text-night-cherry'}`}>
      <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {tone === 'leaf' ? (
        <path d="M6 10.5l2.5 2.5L14 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M7 7l6 6M13 7l-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

function Phone({ story, large = false, paid = false }: { story: Story; large?: boolean; paid?: boolean }) {
  return (
    <div className={`mx-auto w-full ${large ? 'max-w-[19rem]' : 'max-w-[15rem]'} rounded-[1.75rem] border border-night-line bg-[#0c110d] p-3`}>
      <div className="rounded-[1.25rem] bg-survey p-4 text-canopy">
        <p className="text-sm text-canopy-soft">Hello, {story.farmer.split(' ')[0]}</p>
        <p className="font-bold leading-tight">{story.name}</p>
        {paid ? (
          <div className="mt-3 rounded-md bg-leaf-wash px-3 py-3">
            <p className="text-lg font-bold">Payment sent</p>
            <p className="mt-1">{formatUsd(story.farmerCents)} sent with PayPal</p>
            <p className="mt-2 text-sm text-canopy-soft">
              {formatUsd(story.dealerCents)} went to {story.dealer} for the fertiliser.
            </p>
            <p className="mt-2 border-t border-canopy/15 pt-2 text-sm text-canopy-soft">
              Code read from photo: <span className="font-mono">6VT4GN</span>
            </p>
          </div>
        ) : (
          <>
            <div className="mt-3 rounded-md border border-contour bg-sheet px-3 py-2">
              <p className="text-xs text-canopy-soft">Today&apos;s code</p>
              <p className={`font-mono font-bold tracking-[0.12em] ${large ? 'text-3xl' : 'text-2xl'}`}>6VT4GN</p>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm">
              <li>Photo with the code</li>
              <li>Voice note: &ldquo;Bought two bags of fertiliser&rdquo;</li>
              <li className="text-canopy-soft">At the plot, 13.2752 N 75.6401 E</li>
            </ul>
            <p className="mt-3 rounded-md bg-leaf py-2 text-center text-sm font-semibold text-sheet">Send evidence</p>
          </>
        )}
      </div>
    </div>
  );
}

function Json({ title, value }: { title: string; value: unknown }) {
  return (
    <figure className={`${panel} overflow-hidden`}>
      <figcaption className="border-b border-night-line px-4 py-2.5 text-sm text-night-muted">{title}</figcaption>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-6">
        {JSON.stringify(value, null, 2)
          .split('\n')
          .map((line, i) => {
            const match = line.match(/^(\s*)"([^"]+)":(.*)$/);
            return (
              <span key={i}>
                {match ? (
                  <>
                    {match[1]}
                    <span className="text-night-muted">&quot;{match[2]}&quot;</span>:
                    <span className={match[3].includes('RELEASE') ? 'text-night-leaf' : undefined}>{match[3]}</span>
                  </>
                ) : (
                  line
                )}
                {'\n'}
              </span>
            );
          })}
      </pre>
    </figure>
  );
}

function NextStep({ row }: { row: PlotRow }) {
  const next = row.milestones.find((m) => m.state !== 'RELEASED');
  if (row.eudrStatus === 'FAIL') return <span className="text-night-cherry">Withheld: forest cleared</span>;
  if (!next) return <span className="text-night-leaf">Season paid</span>;
  if (next.state === 'REVIEW') return <span className="text-night-monsoon">Held for review</span>;
  return <span className="text-night-muted">{MILESTONE_LABELS[next.type].title}</span>;
}

export default async function Home() {
  await connection();
  const database = await db();
  const { contract, passing, failing, plotCount, passingCount } = await showcasePlots(database);
  const rows = contract ? await contractRows(database, contract.id) : [];

  const buyerHref = contract ? `/contracts/${contract.id}` : '/';
  const farmerHref = passing ? `/m/${passing.id}` : '/';

  return (
    <div className="min-h-full bg-night-canvas text-night-ink">
      <header className="sticky top-0 z-10 border-b border-night-line bg-night-canvas/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 sm:px-10">
          <span className="text-lg font-bold tracking-tight">AgriTranche</span>
          <nav className="hidden gap-8 text-night-muted md:flex">
            <a href="#how" className="hover:text-night-ink">
              How it works
            </a>
            <a href="#evidence" className="hover:text-night-ink">
              Evidence
            </a>
            <a href="#satellite" className="hover:text-night-ink">
              Satellite
            </a>
            <a href="#paypal" className="hover:text-night-ink">
              PayPal
            </a>
          </nav>
          <Link href={buyerHref} className="rounded-md bg-night-ink px-4 py-2 text-sm font-semibold text-night-canvas hover:bg-white">
            Buyer console
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 sm:px-10">
        <section className="pt-20 text-center sm:pt-28">
          <h1 className="mx-auto max-w-4xl text-5xl font-bold leading-[1.02] tracking-tight sm:text-7xl">EUDR compliance that pays the farmer</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-night-muted sm:text-xl">
            EU buyers pay coffee smallholders through PayPal the moment field evidence and satellite data prove each stage of the season.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href={buyerHref} className="rounded-md bg-night-ink px-6 py-3 font-semibold text-night-canvas hover:bg-white">
              Open the buyer console
            </Link>
            <Link href={farmerHref} className="rounded-md border border-night-line px-6 py-3 font-semibold hover:border-night-muted">
              Try the farmer app
            </Link>
          </div>
        </section>

        {passing && (
          <section aria-label="One payment, end to end" className="relative mt-20">
            <svg aria-hidden viewBox="0 0 100 2" preserveAspectRatio="none" className="absolute left-[16%] top-1/2 hidden h-0.5 w-[68%] lg:block">
              <line x1="0" y1="1" x2="100" y2="1" pathLength={1} className="flow-line" stroke="var(--night-leaf)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="relative grid gap-6 lg:grid-cols-3">
              <div className={`${solidPanel} p-5`}>
                <p className="mb-4 text-night-muted">On the plot</p>
                <Phone story={passing} />
              </div>
              <div className={`${solidPanel} p-5`}>
                <p className="mb-4 text-night-muted">Checked in seconds</p>
                <PlotOutline ring={passing.ring} night title={`Boundary of ${passing.name}`} className="mx-auto w-36" />
                <ul className="mt-4 space-y-3">
                  <li className="check-item flex gap-3" style={{ animationDelay: '900ms' }}>
                    <Tick />
                    Code read from the photo by Gemini
                  </li>
                  <li className="check-item flex gap-3" style={{ animationDelay: '1100ms' }}>
                    <Tick />
                    Phone inside the plot boundary
                  </li>
                  <li className="check-item flex gap-3" style={{ animationDelay: '1300ms' }}>
                    <Tick />
                    No forest loss since 2021
                  </li>
                  <li className="check-item flex gap-3" style={{ animationDelay: '1500ms' }}>
                    <Tick />
                    Season advance covers it
                  </li>
                </ul>
              </div>
              <div className={`${solidPanel} flex flex-col p-5`}>
                <p className="mb-4 text-night-muted">Paid with PayPal Payouts</p>
                <p className="text-sm text-night-muted">
                  {MILESTONE_LABELS.INPUTS.title}, {passing.name}
                </p>
                <p className="mt-1 text-4xl font-bold tabular-nums">{formatUsd(passing.inputsCents)}</p>
                <dl className="mt-6 space-y-3 border-t border-night-line pt-4">
                  <div className="flex justify-between gap-4">
                    <dt>{passing.dealer}</dt>
                    <dd className="tabular-nums">{formatUsd(passing.dealerCents)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>{passing.farmer}</dt>
                    <dd className="tabular-nums">{formatUsd(passing.farmerCents)}</dd>
                  </div>
                </dl>
                <p className="mt-auto pt-6 text-sm text-night-muted">Both payees are paid in one batch, confirmed by a signed PayPal webhook.</p>
              </div>
            </div>
          </section>
        )}

        <section id="how" className="mt-32 scroll-mt-24">
          <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">How money moves</h2>
          <ol className="mt-12 grid gap-px overflow-hidden rounded-xl border border-night-line bg-night-line sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="bg-night-canvas p-6">
                <span className="font-mono text-sm text-night-faint">{i + 1}</span>
                <h3 className="mt-3 text-xl font-bold">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-night-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {passing && (
          <section id="evidence" className="mt-32 grid scroll-mt-24 items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 className="text-4xl font-bold tracking-tight">A minute of evidence from the plot</h2>
              <p className="mt-5 max-w-lg text-lg leading-relaxed text-night-muted">
                The farmer gets a one-time code, writes it on paper and photographs it with the crop. A short voice note in English says what they did. The
                code expires after 15 minutes and the phone must be inside the surveyed plot, so an old photo or one taken elsewhere is refused.
              </p>
              <p className="mt-4 max-w-lg leading-relaxed text-night-muted">
                The screens use a typeface designed for low-vision readers and one large action per step, because they are read outdoors on small phones.
              </p>
            </div>
            <Phone story={passing} large paid />
          </section>
        )}

        {passing && (
          <section className="mt-32 grid items-start gap-12 lg:grid-cols-2">
            <div className="lg:sticky lg:top-28">
              <h2 className="text-4xl font-bold tracking-tight">The model proposes, code decides</h2>
              <p className="mt-5 max-w-lg text-lg leading-relaxed text-night-muted">
                Gemini reads the handwritten code, the crop stage and the voice note. It is never told which code to expect. A deterministic gate in plain
                TypeScript then checks the code, location, timing, satellite result and remaining funds, and only then asks PayPal to pay.
              </p>
              <p className="mt-4 max-w-lg leading-relaxed text-night-muted">If no model answers, the claim waits for a person. It is never paid on a guess.</p>
            </div>
            <div className="space-y-4">
              <Json
                title="Gemini on Vertex AI reads the photo"
                value={{ challengeCodeRead: '6VT4GN', cropStage: 'GREEN_CHERRY', claimedMilestone: 'INPUTS', confidence: 0.91 }}
              />
              <Json
                title="The release gate decides"
                value={{
                  kind: 'RELEASE',
                  payouts: [
                    { id: passing.dealerId, cents: passing.dealerCents },
                    { id: passing.farmerId, cents: passing.farmerCents },
                  ],
                }}
              />
            </div>
          </section>
        )}

        {passing && failing && (
          <section id="satellite" className="mt-32 scroll-mt-24">
            <h2 className="max-w-3xl text-4xl font-bold tracking-tight">Every plot is checked against the EUDR cut-off</h2>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-night-muted">
              Plot outlines are compared with University of Maryland tree cover loss from Global Forest Watch. Any clearing after 31 December 2020 stops that
              plot&apos;s payments, and the buyer sees why. {passingCount} of {plotCount} plots in this season pass.
            </p>
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              {[
                { story: passing, tone: 'leaf' as const, verdict: 'Passes', detail: 'No tree cover lost since 2021' },
                { story: failing, tone: 'cherry' as const, verdict: 'Payments withheld', detail: `${formatHa(failing.lossHa)} of tree cover lost in 2024` },
              ].map(({ story, tone, verdict, detail }) => (
                <div key={story.id} className={`${panel} flex items-center gap-6 p-6`}>
                  <PlotOutline ring={story.ring} tone={tone} night title={`Boundary of ${story.name}`} className="w-32 shrink-0" />
                  <div>
                    <p className="text-night-muted">
                      {story.name}, {formatHa(story.areaHa)}
                    </p>
                    <p className={`mt-1 flex items-center gap-2 text-xl font-bold ${tone === 'leaf' ? 'text-night-leaf' : 'text-night-cherry'}`}>
                      <Tick tone={tone} />
                      {verdict}
                    </p>
                    <p className="mt-1 text-night-muted">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section id="paypal" className="mt-32 scroll-mt-24">
          <h2 className="text-4xl font-bold tracking-tight">PayPal moves every dollar</h2>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-night-muted">
            Every PayPal call carries a request id derived from the business action, so a retry can never pay twice. Each payment is written to a
            hash-chained ledger before PayPal is asked.
          </p>
          <dl className="mt-12 grid gap-px overflow-hidden rounded-xl border border-night-line bg-night-line md:grid-cols-2 lg:grid-cols-3">
            {PAYPAL_USES.map(({ api, use }) => (
              <div key={api} className="bg-night-canvas p-6">
                <dt className="font-semibold">{api}</dt>
                <dd className="mt-2 leading-relaxed text-night-muted">{use}</dd>
              </div>
            ))}
          </dl>
        </section>

        {rows.length > 0 && (
          <section className="mt-32">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className="text-4xl font-bold tracking-tight">The buyer sees every plot</h2>
              <Link href={buyerHref} className="rounded-md border border-night-line px-5 py-2.5 font-semibold hover:border-night-muted">
                Open the buyer console
              </Link>
            </div>
            <div className={`${panel} mt-10 overflow-x-auto`}>
              <table className="w-full min-w-[40rem] text-left">
                <thead className="text-sm text-night-muted">
                  <tr className="border-b border-night-line">
                    <th className="px-5 py-3 font-medium">Plot</th>
                    <th className="px-5 py-3 font-medium">Farmer</th>
                    <th className="px-5 py-3 text-right font-medium">Area</th>
                    <th className="px-5 py-3 font-medium">Next step</th>
                    <th className="px-5 py-3 text-right font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row) => (
                    <tr key={row.plotId} className="border-b border-night-line last:border-0">
                      <td className="px-5 py-3.5">{row.plot}</td>
                      <td className="px-5 py-3.5 text-night-muted">{row.farmer}</td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-night-muted">{formatHa(row.areaHa)}</td>
                      <td className="px-5 py-3.5">
                        <NextStep row={row} />
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums">{formatUsd(row.paidCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="mt-32">
          <h2 className="text-2xl font-bold tracking-tight">Built with</h2>
          <ul className="mt-6 flex flex-wrap gap-2">
            {BUILT_WITH.map((name) => (
              <li key={name} className="rounded-full border border-night-line px-4 py-1.5 text-night-muted">
                {name}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="mx-auto mt-32 max-w-6xl border-t border-night-line px-6 py-8 text-sm leading-relaxed text-night-faint sm:px-10">
        Runs on the PayPal sandbox. Farmers and plot owners are fictional; tree cover loss is real University of Maryland data from Global Forest Watch.
      </footer>
    </div>
  );
}
