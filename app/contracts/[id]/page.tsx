import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { BILL_LABEL, MILESTONE_LABELS } from '@/lib/claim-copy';
import { buyers, contracts, cooperatives, disputes, plots, premiums } from '@/lib/db/schema';
import type { SupplierKind } from '@/lib/engine/gate';
import { PLOT_MILESTONES } from '@/lib/engine/stateMachine';
import { formatUsd } from '@/lib/format';
import { contractRows } from '@/lib/services/contract-rows';
import { seasonImpact } from '@/lib/services/impact';
import { paypalBalance, seasonWallet } from '@/lib/services/wallet';
import { SeasonWallet } from '../../ui/season-wallet';
import { deliverySummary } from '@/lib/services/delivery';
import { mandateFor } from '@/lib/services/premium';
import { latestReconciliation } from '@/lib/services/reconciliation';
import { WORKSPACE_PRICE_CENTS } from '@/lib/services/subscription';
import { env } from '@/lib/env';
import { stagePrompt } from '@/lib/programmes';
import { CROP_CARE, FERTILISER, HARVEST, PROCESSING, VERIFIED_PLOT_CENTS, type BillStageTerms, type SeasonTerms } from '@/lib/season-terms';
import { LiveRefresh } from '../../ui/live-refresh';
import { SatelliteMap } from '../../ui/satellite-map';
import { NextStep, StepRail, TopBar } from '../../ui/shell';
import { StageMark, type StageStatus } from '../../ui/stage-mark';
import { BooksCard } from './books-card';
import { DeliveryForm } from './delivery-form';
import { DisputesPanel } from './disputes-panel';
import { ForceMajeureForm } from './force-majeure-form';
import { PayPalCheckout } from './paypal-checkout';
import { SandboxLogin } from '../../ui/sandbox-login';
import { PremiumPanel } from './premium-panel';
import { WorkspacePlan } from './workspace-plan';
import { LedgerGrid } from './ledger-grid';

export const metadata: Metadata = { title: 'Season contract' };

type Tab = 'board' | 'terms' | 'season-end';

const TABS: { tab: Tab; label: string }[] = [
  { tab: 'board', label: 'Board' },
  { tab: 'terms', label: 'Contract' },
  { tab: 'season-end', label: 'Season end' },
];

function billTerms({ caps, farmerPercent }: BillStageTerms) {
  const bills = (Object.entries(caps) as [SupplierKind, number][]).map(([kind, percent]) => `${BILL_LABEL[kind]} up to ${percent}%`).join(' and ');
  return `${bills[0].toUpperCase()}${bills.slice(1)}, plus ${farmerPercent}% to the farmer`;
}

const TERMS = [
  { title: MILESTONE_LABELS.PLOT_VERIFIED.title, paid: `${formatUsd(VERIFIED_PLOT_CENTS)} to the farmer`, proof: 'photo on the farm and the land check' },
  { title: MILESTONE_LABELS.INPUTS.title, paid: billTerms(FERTILISER), proof: "the seller's and labour bills and the bags" },
  { title: MILESTONE_LABELS.CROP_CARE.title, paid: billTerms(CROP_CARE), proof: 'the spray and crew bills and the plants' },
  { title: MILESTONE_LABELS.HARVEST.title, paid: billTerms(HARVEST), proof: "the pickers' wage sheet and the cherries" },
  { title: MILESTONE_LABELS.PROCESSING.title, paid: billTerms(PROCESSING), proof: 'the pulper or lorry bill and the dried coffee' },
];

// A posted opportunity carries its own stages; the coffee season uses the terms above.
function termsOf(terms: SeasonTerms | null, commodity: string) {
  if (!terms) return TERMS;
  return PLOT_MILESTONES.map((type) => ({
    title: terms.stages[type].label,
    paid: type === 'PLOT_VERIFIED' ? `${formatUsd(VERIFIED_PLOT_CENTS)} to the farmer` : billTerms(terms.stages[type]),
    proof: stagePrompt(commodity, type).replace(/^Photograph /, '').replace(/, with today's code\.$/, ''),
  }));
}

function boardStatus(m: { state: string; reasons: string[] }, land: string, isNext: boolean): StageStatus {
  if (m.state === 'RELEASED') return 'paid';
  if (land === 'FAIL') return 'refused';
  if (m.state === 'REVIEW') return 'held';
  if (m.reasons.length) return 'refused';
  return isNext ? 'open' : 'later';
}

function EndStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-contour bg-sheet p-6">
      <h2 className="flex items-center gap-3 text-xl font-bold">
        <span className="grid size-8 place-items-center rounded-full bg-canopy text-sm text-sheet tabular-nums">{n}</span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </li>
  );
}



const STATE_COPY = {
  DRAFT: 'Waiting for the season fund',
  FUNDED: 'Funded: waiting for the first proof',
  ACTIVE: 'Running: paying proven stages',
  DELIVERING: 'Crop in delivery',
  SETTLED: 'Season settled',
  FRUSTRATED: 'Ended by bad weather',
} as const;

function Figure({ label, value, tone, note }: { label: string; value: string; tone?: string; note?: string }) {
  return (
    <div className="rounded-xl border border-contour bg-sheet px-4 py-3">
      <dt className="text-sm text-canopy-soft">{label}</dt>
      <dd className={`mt-1 text-2xl font-bold tabular-nums ${tone ?? ''}`}>{value}</dd>
      {note && <dd className="text-sm text-canopy-soft">{note}</dd>}
    </div>
  );
}

export default async function ContractPage({ params, searchParams }: PageProps<'/contracts/[id]'>) {
  await connection();
  const { id } = await params;
  const tabParam = (await searchParams).tab;
  const tab: Tab = tabParam === 'terms' || tabParam === 'season-end' ? tabParam : 'board';
  const database = await db();

  const [row] = await database
    .select({ contract: contracts, buyer: buyers, cooperative: cooperatives })
    .from(contracts)
    .innerJoin(buyers, eq(contracts.buyerId, buyers.id))
    .innerJoin(cooperatives, eq(contracts.cooperativeId, cooperatives.id))
    .where(eq(contracts.id, id));
  if (!row) notFound();
  const { contract, buyer, cooperative } = row;


  const rows = await contractRows(database, contract.id);
  const delivery = await deliverySummary(database, contract.id);
  const mandate = await mandateFor(database, contract.id);
  const contractPremiums = await database.select().from(premiums).where(eq(premiums.contractId, contract.id));
  const owedPremiums = contractPremiums.filter((p) => p.state === 'OWED');
  const contractDisputes = await database.select().from(disputes).where(eq(disputes.contractId, contract.id));
  const books = await latestReconciliation(database);
  const impact = await seasonImpact(database, contract.id);
  const wallet = (await seasonWallet(database, contract.id))!;
  const paypal = await paypalBalance();
  const share = (part: number, whole: number) => {
    const percent = (part / whole) * 100;
    return `${percent > 0 && percent < 1 ? percent.toFixed(1) : Math.round(percent)}%`;
  };
  const facts = [
    { value: formatUsd(contract.totalCents), label: 'crop value under contract' },
    ...(impact.paidCents ? [{ value: share(impact.paidCents, contract.totalCents), label: 'of it paid before the crop is sold' }] : []),
    ...(impact.supplierCents ? [{ value: share(impact.supplierCents, impact.paidCents), label: 'of payments straight to sellers, labour and hire' }] : []),
    ...(impact.medianMinutes !== null
      ? [{ value: impact.medianMinutes < 1 ? '<1 min' : impact.medianMinutes < 90 ? `${Math.round(impact.medianMinutes)} min` : `${Math.round(impact.medianMinutes / 60)} h`, label: 'median from proof to payment' }]
      : []),
  ];
  const mapPlots = (await database.select({ id: plots.id, name: plots.name, ring: plots.ring, status: plots.eudrStatus }).from(plots)).filter((p) =>
    rows.some((r) => r.plotId === p.id),
  );

  const stageTypes = PLOT_MILESTONES.filter((type) => rows.some((r) => r.milestones.some((m) => m.type === type)));
  const tabHref = (t: Tab) => `/contracts/${contract.id}${t === 'board' ? '' : `?tab=${t}`}`;

  return (
    <>
      <LiveRefresh />
      <TopBar role="company" />
      <StepRail current={tab === 'terms' ? 1 : 6} />
      <main className="mx-auto w-full max-w-6xl px-6 pb-16 pt-8 sm:px-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-canopy-soft">
              {buyer.name} · {cooperative.name}
            </p>
            <h1 className="mt-1 text-4xl font-bold tracking-tight">
              {contract.commodity === 'coffee' ? 'Coffee' : contract.commodity} season {contract.season}
            </h1>
            <p className="mt-2 inline-block rounded-full bg-leaf-wash px-3 py-1 font-semibold">{STATE_COPY[contract.state]}</p>
          </div>
          {env().PAYPAL_WORKSPACE_PLAN_ID && (
            <WorkspacePlan buyerId={buyer.id} status={buyer.subscriptionStatus} priceCents={WORKSPACE_PRICE_CENTS} returnTo={`/contracts/${contract.id}`} />
          )}
        </div>

        <div className="mt-8">
          <SeasonWallet wallet={wallet} buyer={buyer.name} funded={contract.state !== 'DRAFT'} paypal={paypal} facts={facts} />
        </div>

        <Link
          href={`/contracts/${contract.id}/command-centre`}
          className="group mt-4 flex flex-wrap items-center gap-4 rounded-2xl border border-leaf/40 bg-leaf-wash p-5 transition hover:border-leaf hover:shadow-md"
        >
          <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-xl bg-canopy text-sheet">
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18M7 15l4-4 3 3 5-6" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold">Season dashboard and AI agent</span>
              <span className="rounded-full bg-canopy px-2 py-0.5 text-xs font-semibold text-sheet">AG Grid · AG Studio</span>
            </span>
            <span className="mt-1 block text-canopy-soft">
              Every farm, stage and payment as charts and grids. Ask in plain words, such as &ldquo;which claims are held?&rdquo;; the agent answers with a chart and
              checks PayPal itself.
            </span>
          </span>
          <span className="rounded-md bg-canopy px-4 py-2 font-semibold text-sheet group-hover:bg-leaf">Open the dashboard</span>
        </Link>

        <nav aria-label="Contract" className="mt-10 flex flex-wrap gap-1 border-b border-contour">
          {TABS.map((t) => (
            <Link
              key={t.tab}
              href={tabHref(t.tab)}
              aria-current={tab === t.tab ? 'page' : undefined}
              className={`-mb-px border-b-2 px-4 py-2 font-semibold ${tab === t.tab ? 'border-leaf text-canopy' : 'border-transparent text-canopy-soft hover:text-canopy'}`}
            >
              {t.label}
            </Link>
          ))}
          <Link href={`/contracts/${contract.id}/command-centre`} className="-mb-px ml-auto border-b-2 border-transparent px-4 py-2 font-semibold text-leaf hover:text-canopy">
            Dashboard
          </Link>
        </nav>

        {tab === 'board' && (
          <section className="mt-8">
            {contract.state === 'DRAFT' && (
              <p className="mb-6 rounded-xl bg-monsoon-wash px-5 py-4">
                Nothing can be paid until the season fund is in.{' '}
                <Link href={tabHref('terms')} className="font-semibold underline underline-offset-4">
                  Review the contract and pay the fund
                </Link>
              </p>
            )}
            <div className="overflow-x-auto rounded-xl border border-contour bg-sheet">
              <table className="w-full min-w-[44rem] text-left">
                <thead className="text-sm text-canopy-soft">
                  <tr className="border-b border-contour">
                    <th className="px-4 py-3 font-medium">Farm</th>
                    {stageTypes.map((type) => (
                      <th key={type} className="px-4 py-3 font-medium">
                        {contract.terms?.stages[type].label ?? MILESTONE_LABELS[type].title}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const next = row.milestones.find((m) => m.state !== 'RELEASED');
                    return (
                      <tr key={row.plotId} className="border-b border-contour last:border-0">
                        <td className="px-4 py-3">
                          <Link href={`/farms/${row.plotId}`} className="font-semibold underline-offset-4 hover:underline">
                            {row.farmer}
                          </Link>
                          <p className="text-sm text-canopy-soft">{row.plot}</p>
                        </td>
                        {stageTypes.map((type) => {
                          const m = row.milestones.find((x) => x.type === type);
                          if (!m) return <td key={type} />;
                          const status = boardStatus(m, row.eudrStatus, m.id === next?.id);
                          return (
                            <td key={type} className="px-4 py-3">
                              <Link href={status === 'held' ? '/coop' : `/farms/${row.plotId}#${type}`} className="flex items-center gap-2">
                                <StageMark status={status} />
                                <span className="text-sm">
                                  {status === 'paid' ? formatUsd(m.paidCents) : status === 'held' ? 'Check' : status === 'refused' ? 'Refused' : status === 'open' ? 'Open' : ''}
                                </span>
                              </Link>
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatUsd(row.paidCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <SatelliteMap plots={mapPlots} width={900} title="Satellite map of the farms, coloured by land check" className="mt-6" />
            <details className="mt-6 rounded-xl border border-contour bg-sheet p-5">
              <summary className="cursor-pointer font-semibold">Every payment, with how PayPal confirmed it</summary>
              <div className="mt-4">
                <LedgerGrid rows={rows} />
              </div>
            </details>
            <NextStep href={`/contracts/${contract.id}/command-centre`} label="Open the season dashboard and ask the AI agent" note="Held stages are approved in the field officer's queue." />
          </section>
        )}

        {tab === 'terms' && (
          <section className="mt-8 space-y-8">
            <div>
              <h2 className="text-2xl font-bold">How each farm is paid</h2>
              <ol className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {termsOf(contract.terms, contract.commodity).map((term, i) => (
                  <li key={term.title} className="rounded-xl border border-contour bg-sheet p-4">
                    <p className="text-sm font-semibold text-canopy-soft tabular-nums">Stage {i + 1}</p>
                    <p className="text-lg font-bold">{term.title}</p>
                    <p className="mt-1 font-semibold text-leaf">{term.paid}</p>
                    <p className="mt-2 text-sm text-canopy-soft">Proof: {term.proof}</p>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-canopy-soft">At delivery, the balance is paid for what passes quality. Amounts are shares of each farm&apos;s expected crop value.</p>
            </div>

            <div>
              <h2 className="text-2xl font-bold">Farms on this contract</h2>
              <ul className="mt-4 grid gap-3 md:grid-cols-3">
                {rows.map((row) => (
                  <li key={row.plotId} className="rounded-xl border border-contour bg-sheet p-4">
                    <p className="font-semibold">{row.farmer}</p>
                    <p className="text-sm text-canopy-soft">
                      {row.plot} · {row.areaHa} ha
                    </p>
                    <p className={`mt-2 text-sm font-semibold ${row.eudrStatus === 'FAIL' ? 'text-cherry' : 'text-leaf'}`}>
                      {row.eudrStatus === 'FAIL' ? 'Land check failed' : row.eudrStatus === 'PASS' ? 'Land check passed' : 'Land check pending'}
                    </p>
                  </li>
                ))}
                <li className="grid place-items-center rounded-xl border border-dashed border-contour p-4">
                  <Link href="/coop/onboard" className="font-semibold text-leaf underline-offset-4 hover:underline">
                    + Map a new farm
                  </Link>
                </li>
              </ul>
            </div>

            <div className="grid gap-6 rounded-xl border border-contour bg-sheet p-6 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <h2 className="text-2xl font-bold">Season fund: {formatUsd(contract.advanceCents)}</h2>
                <p className="mt-2 text-canopy-soft">
                  {Math.round((contract.advanceCents / Math.max(1, contract.totalCents)) * 100)}% of the contract value, paid once with PayPal. It is held for these farms and paid out only against proof; anything unearned is
                  refunded if the season fails.
                </p>
              </div>
              <div className="lg:col-span-5 lg:self-center">
                {contract.state === 'DRAFT' ? (
                  <>
                    <PayPalCheckout
                      createPath={`/api/contracts/${contract.id}/advance`}
                      approvePath={`/api/contracts/${contract.id}/advance/capture`}
                      approvedStates={['FUNDED', 'ACTIVE']}
                      approvedText={`${formatUsd(contract.advanceCents)} received. The season is funded.`}
                    />
                    <SandboxLogin account="buyer" />
                  </>
                ) : (
                  <p className="font-semibold text-leaf">
                    Paid with PayPal{contract.advanceCaptureId && <span className="ml-1 font-mono text-sm text-canopy-soft">{contract.advanceCaptureId}</span>}
                  </p>
                )}
              </div>
            </div>

            {contract.state !== 'DRAFT' && contract.state !== 'FRUSTRATED' && (
              <div className="rounded-xl border border-contour bg-sheet p-6">
                <h2 className="text-2xl font-bold">Good-practice bonus</h2>
                <p className="mt-2 text-canopy-soft">An extra payment to each farm that proves it kept its forest, charged to your saved PayPal within your cap.</p>
                <div className="mt-5">
                  <PremiumPanel
                    contractId={contract.id}
                    mandate={mandate && { perPlotCents: mandate.perPlotCents, capCents: mandate.capCents, vaultStatus: mandate.vaultStatus }}
                    owedCents={owedPremiums.reduce((sum, p) => sum + p.cents, 0)}
                    owedPlots={owedPremiums.length}
                    paidCents={contractPremiums.filter((p) => p.state === 'PAID').reduce((sum, p) => sum + p.cents, 0)}
                  />
                </div>
              </div>
            )}
            <NextStep href="/farmer" label="Next: a farmer proves a stage" />
          </section>
        )}

        {tab === 'season-end' && (
          <ol className="mt-8 space-y-6">
            <EndStep n={1} title="Deliver the crop and pay for what passes quality">
              {contract.state === 'ACTIVE' && delivery.balanceDueCents > 0 && (
                <>
                  <p className="mb-4 text-canopy-soft">
                    Authorize {formatUsd(delivery.balanceDueCents)} now; nothing is charged until quality is checked.
                    {delivery.excludedPlots.length > 0 && ` Not in this lot: ${delivery.excludedPlots.join(', ')} (land check failed).`}
                  </p>
                  <PayPalCheckout
                    createPath={`/api/contracts/${contract.id}/balance`}
                    approvePath={`/api/contracts/${contract.id}/balance/authorize`}
                    approvedStates={['DELIVERING']}
                    approvedText={`Balance of ${formatUsd(delivery.balanceDueCents)} authorized. Record the quality result when the lot arrives.`}
                  />
                  <SandboxLogin account="buyer" />
                </>
              )}
              {contract.state === 'DELIVERING' && contract.balanceAuthorizedCents !== null && (
                <>
                  <p className="mb-4 text-canopy-soft">{formatUsd(contract.balanceAuthorizedCents)} is authorized. Enter what arrived and what passed: that much is captured, the rest is voided.</p>
                  <DeliveryForm contractId={contract.id} authorizedCents={contract.balanceAuthorizedCents} />
                </>
              )}
              {contract.state === 'SETTLED' && contract.balanceAuthorizedCents !== null && (
                <dl className="grid gap-4 sm:grid-cols-4">
                  <Figure label="Accepted" value={`${contract.acceptedKg} of ${contract.deliveredKg} kg`} />
                  <Figure label="Quality" value={`${contract.qualityPercent}%`} />
                  <Figure label="Captured" value={formatUsd(contract.balanceCapturedCents ?? 0)} tone="text-leaf" />
                  <Figure label="Voided" value={formatUsd(contract.balanceAuthorizedCents - (contract.balanceCapturedCents ?? 0))} />
                </dl>
              )}
              {(contract.state === 'DRAFT' || contract.state === 'FUNDED' || (contract.state === 'ACTIVE' && delivery.balanceDueCents <= 0)) && (
                <p className="text-canopy-soft">Opens once farms have been paid for their stages.</p>
              )}
            </EndStep>

            <EndStep n={2} title="If bad weather ends the season">
              {contract.state === 'FRUSTRATED' ? (
                <p>
                  The unspent fund went back to you with PayPal{contract.refundId && <span className="ml-1 font-mono text-sm">{contract.refundId}</span>}. Farmers keep what they earned.
                </p>
              ) : contract.state === 'FUNDED' || contract.state === 'ACTIVE' || contract.state === 'DELIVERING' ? (
                <>
                  <p className="mb-4 text-canopy-soft">Weather records are checked at every farm. If hail, flood or drought hit at least half the contract, the unspent {formatUsd(contract.escrowRemainingCents)} comes back to you.</p>
                  <ForceMajeureForm contractId={contract.id} />
                </>
              ) : (
                <p className="text-canopy-soft">Available while the season is running.</p>
              )}
            </EndStep>

            <EndStep n={3} title="Disputes">
              <p className="mb-4 text-canopy-soft">If a payment is disputed in PayPal, the dispute agent drafts the reply from this season&apos;s proof. You check it and send it.</p>
              <DisputesPanel items={contractDisputes} />
            </EndStep>

            <EndStep n={4} title="Books against PayPal">
              <p className="mb-4 text-canopy-soft">Every payment in our records is matched against PayPal Transaction Search each night.</p>
              <BooksCard run={books && { createdAt: books.createdAt, result: books.result }} />
            </EndStep>
          </ol>
        )}
      </main>
    </>
  );
}
