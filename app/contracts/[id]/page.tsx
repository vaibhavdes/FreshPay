import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { and, eq, sum } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { buyers, contracts, cooperatives, disputes, milestones, premiums } from '@/lib/db/schema';
import { formatUsd } from '@/lib/format';
import { contractRows } from '@/lib/services/contract-rows';
import { deliverySummary } from '@/lib/services/delivery';
import { mandateFor } from '@/lib/services/premium';
import { latestReconciliation } from '@/lib/services/reconciliation';
import { LiveRefresh } from '../../ui/live-refresh';
import { BooksCard } from './books-card';
import { DeliveryForm } from './delivery-form';
import { DisputesPanel } from './disputes-panel';
import { ForceMajeureForm } from './force-majeure-form';
import { PayPalCheckout } from './paypal-checkout';
import { PremiumPanel } from './premium-panel';
import { LedgerGrid } from './ledger-grid';

export const metadata: Metadata = { title: 'Season contract' };

const STATE_COPY = {
  DRAFT: 'Waiting for the season advance',
  FUNDED: 'Funded, waiting for the first verified plot',
  ACTIVE: 'Active: paying verified milestones',
  DELIVERING: 'Lot in delivery',
  SETTLED: 'Settled',
  FRUSTRATED: 'Ended by force majeure',
} as const;

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border-t border-contour pt-3">
      <dt className="text-canopy-soft">{label}</dt>
      <dd className={`mt-1 text-2xl font-bold tabular-nums ${tone ?? ''}`}>{value}</dd>
    </div>
  );
}

export default async function ContractPage({ params }: PageProps<'/contracts/[id]'>) {
  await connection();
  const { id } = await params;
  const database = await db();

  const [row] = await database
    .select({ contract: contracts, buyer: buyers, cooperative: cooperatives })
    .from(contracts)
    .innerJoin(buyers, eq(contracts.buyerId, buyers.id))
    .innerJoin(cooperatives, eq(contracts.cooperativeId, cooperatives.id))
    .where(eq(contracts.id, id));
  if (!row) notFound();
  const { contract, buyer, cooperative } = row;

  const [{ released }] = await database
    .select({ released: sum(milestones.trancheCents).mapWith(Number) })
    .from(milestones)
    .where(and(eq(milestones.contractId, contract.id), eq(milestones.state, 'RELEASED')));

  const rows = await contractRows(database, contract.id);
  const delivery = await deliverySummary(database, contract.id);
  const mandate = await mandateFor(database, contract.id);
  const contractPremiums = await database.select().from(premiums).where(eq(premiums.contractId, contract.id));
  const owedPremiums = contractPremiums.filter((p) => p.state === 'OWED');
  const contractDisputes = await database.select().from(disputes).where(eq(disputes.contractId, contract.id));
  const books = await latestReconciliation(database);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 pb-16 sm:px-10">
      <LiveRefresh />
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="text-xl font-bold tracking-tight">
          AgriTranche
        </Link>
        <span className="text-canopy-soft">{buyer.name}</span>
      </header>

      <section className="border-t border-contour pt-10">
        <p className="text-canopy-soft">
          {contract.commodity === 'coffee' ? 'Coffee' : contract.commodity} season {contract.season}, {cooperative.region}
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">{cooperative.name}</h1>
        <p className="mt-3 text-lg">{STATE_COPY[contract.state]}</p>

        <dl className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Contract value" value={formatUsd(contract.totalCents)} />
          <Figure label="Season advance" value={formatUsd(contract.advanceCents)} />
          <Figure label="Held for this contract" value={formatUsd(contract.escrowRemainingCents)} tone={contract.state === 'DRAFT' ? 'text-canopy-soft' : 'text-leaf'} />
          <Figure label="Paid to farmers and dealers" value={formatUsd(released ?? 0)} />
        </dl>
      </section>

      {contract.state === 'DRAFT' && (
        <section className="mt-12 grid gap-8 rounded-lg border border-contour bg-sheet p-6 sm:p-8 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <h2 className="text-2xl font-bold">Fund the season advance</h2>
            <p className="mt-3 max-w-[38rem] leading-relaxed text-canopy-soft">
              Pay {formatUsd(contract.advanceCents)} with PayPal. It is held for this contract and released to farmers and their input dealers only when
              a plot passes its checks. Anything unearned is refunded if the season fails.
            </p>
          </div>
          <div className="lg:col-span-5 lg:self-center">
            <PayPalCheckout
              createPath={`/api/contracts/${contract.id}/advance`}
              approvePath={`/api/contracts/${contract.id}/advance/capture`}
              approvedStates={['FUNDED', 'ACTIVE']}
              approvedText={`${formatUsd(contract.advanceCents)} received. The season is funded.`}
            />
          </div>
        </section>
      )}

      {contract.state === 'ACTIVE' && delivery.balanceDueCents > 0 && (
        <section className="mt-12 grid gap-8 rounded-lg border border-contour bg-sheet p-6 sm:p-8 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <h2 className="text-2xl font-bold">Ship the lot and authorize the balance</h2>
            <p className="mt-3 max-w-[38rem] leading-relaxed text-canopy-soft">
              Authorize {formatUsd(delivery.balanceDueCents)} for the compliant coffee. Nothing is charged yet: when the lot arrives, only what passes QC is
              captured and the rest is released back to you.
            </p>
            {delivery.excludedPlots.length > 0 && (
              <p className="mt-3 max-w-[38rem] rounded-md bg-cherry-wash px-4 py-3 leading-relaxed text-cherry">
                Not in this lot: {delivery.excludedPlots.join(', ')}. Forest was cleared there after 2020, so its coffee cannot enter the EU.
              </p>
            )}
          </div>
          <div className="lg:col-span-5 lg:self-center">
            <PayPalCheckout
              createPath={`/api/contracts/${contract.id}/balance`}
              approvePath={`/api/contracts/${contract.id}/balance/authorize`}
              approvedStates={['DELIVERING']}
              approvedText={`Balance of ${formatUsd(delivery.balanceDueCents)} authorized. Record the QC result when the lot arrives.`}
            />
          </div>
        </section>
      )}

      {contract.state === 'DELIVERING' && contract.balanceAuthorizedCents !== null && (
        <section className="mt-12 rounded-lg border border-contour bg-sheet p-6 sm:p-8">
          <h2 className="text-2xl font-bold">Record the QC result</h2>
          <p className="mt-3 max-w-[44rem] leading-relaxed text-canopy-soft">
            {formatUsd(contract.balanceAuthorizedCents)} is authorized. Enter what arrived and what QC accepted: the matching amount is captured, the rest of the
            authorization is voided, the shipment is tracked on the PayPal order, and farmers are paid their share.
          </p>
          <div className="mt-6">
            <DeliveryForm contractId={contract.id} authorizedCents={contract.balanceAuthorizedCents} />
          </div>
        </section>
      )}

      {contract.state === 'SETTLED' && contract.balanceAuthorizedCents !== null && (
        <section className="mt-12 rounded-lg border border-contour bg-sheet p-6 sm:p-8">
          <h2 className="text-2xl font-bold">Delivered and settled</h2>
          <dl className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Accepted at QC" value={`${contract.acceptedKg} of ${contract.deliveredKg} kg`} />
            <Figure label="Quality" value={`${contract.qualityPercent}%`} />
            <Figure label="Captured" value={formatUsd(contract.balanceCapturedCents ?? 0)} tone="text-leaf" />
            <Figure label="Voided" value={formatUsd(contract.balanceAuthorizedCents - (contract.balanceCapturedCents ?? 0))} />
          </dl>
          <p className="mt-6 text-canopy-soft">
            Shipped with {contract.carrier}, tracking <span className="font-mono">{contract.trackingNumber}</span>
            {contract.balanceCaptureId && (
              <>
                , PayPal capture <span className="font-mono">{contract.balanceCaptureId}</span>
              </>
            )}
          </p>
        </section>
      )}

      {contract.state === 'FRUSTRATED' && (
        <section className="mt-12 rounded-lg border border-contour bg-sheet p-6 sm:p-8">
          <h2 className="text-2xl font-bold">Season ended by verified bad weather</h2>
          <p className="mt-3 leading-relaxed text-canopy-soft">
            The unearned advance was refunded to you with PayPal{contract.refundId && <>, refund <span className="font-mono">{contract.refundId}</span></>}. Payments
            already made to farmers for verified work stay with them.
          </p>
        </section>
      )}

      {(contract.state === 'FUNDED' || contract.state === 'ACTIVE' || contract.state === 'DELIVERING') && (
        <details className="mt-12 rounded-lg border border-contour bg-sheet p-6 sm:p-8">
          <summary className="cursor-pointer text-xl font-bold">Was the season lost to bad weather?</summary>
          <p className="mt-3 max-w-[44rem] leading-relaxed text-canopy-soft">
            Choose when it happened. Open-Meteo weather records for each plot are checked for hail, flood or drought. If plots carrying at least half of the
            contract value were hit, the unearned {formatUsd(contract.escrowRemainingCents)} goes back to you; payments already made for verified work stay with
            the farmers.
          </p>
          <div className="mt-6">
            <ForceMajeureForm contractId={contract.id} />
          </div>
        </details>
      )}

      {contract.state !== 'DRAFT' && contract.state !== 'FRUSTRATED' && (
        <section className="mt-12 rounded-lg border border-contour bg-sheet p-6 sm:p-8">
          <h2 className="text-2xl font-bold">Traceability premium</h2>
          <p className="mt-3 max-w-[44rem] leading-relaxed text-canopy-soft">
            Pay farmers a premium on top of the coffee price for every plot that passes its EUDR checks. It goes straight to them, and your cap is never exceeded.
          </p>
          <div className="mt-6">
            <PremiumPanel
              contractId={contract.id}
              mandate={mandate && { perPlotCents: mandate.perPlotCents, capCents: mandate.capCents, vaultStatus: mandate.vaultStatus }}
              owedCents={owedPremiums.reduce((sum, p) => sum + p.cents, 0)}
              owedPlots={owedPremiums.length}
              paidCents={contractPremiums.filter((p) => p.state === 'PAID').reduce((sum, p) => sum + p.cents, 0)}
            />
          </div>
        </section>
      )}

      <section className="mt-12">
        <h2 className="text-2xl font-bold">Plots and payments</h2>
        <p className="mt-2 text-canopy-soft">Open a plot to see each payment, who received it and how PayPal confirmed it.</p>
        <div className="mt-6">
          <LedgerGrid rows={rows} />
        </div>
      </section>

      {contract.state !== 'DRAFT' && (
        <section className="mt-12 rounded-lg border border-contour bg-sheet p-6 sm:p-8">
          <h2 className="text-2xl font-bold">Disputes</h2>
          <p className="mt-3 max-w-[44rem] leading-relaxed text-canopy-soft">
            If a payment is disputed in PayPal, the dispute agent drafts a response from this contract&apos;s ledger: verified evidence, satellite checks,
            payouts and delivery. You read it, edit it and send it with the evidence photos.
          </p>
          <div className="mt-6">
            <DisputesPanel items={contractDisputes} />
          </div>
        </section>
      )}

      {contract.state !== 'DRAFT' && (
        <section className="mt-12 rounded-lg border border-contour bg-sheet p-6 sm:p-8">
          <h2 className="text-2xl font-bold">Books against PayPal</h2>
          <p className="mt-3 max-w-[44rem] leading-relaxed text-canopy-soft">
            Every capture, refund and payout in our ledger is checked against PayPal Transaction Search, so any drift shows up here first.
          </p>
          <div className="mt-6">
            <BooksCard run={books && { createdAt: books.createdAt, result: books.result }} />
          </div>
        </section>
      )}

      {contract.advanceCaptureId && (
        <p className="mt-8 text-canopy-soft">
          Advance captured with PayPal, capture <span className="font-mono">{contract.advanceCaptureId}</span>
        </p>
      )}
    </div>
  );
}
