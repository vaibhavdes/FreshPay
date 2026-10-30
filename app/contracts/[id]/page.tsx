import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { and, eq, sum } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { buyers, contracts, cooperatives, milestones } from '@/lib/db/schema';
import { formatUsd } from '@/lib/format';
import { contractRows } from '@/lib/services/contract-rows';
import { LiveRefresh } from '../../ui/live-refresh';
import { FundAdvance } from './fund-advance';
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
            <FundAdvance contractId={contract.id} amount={formatUsd(contract.advanceCents)} />
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

      {contract.advanceCaptureId && (
        <p className="mt-8 text-canopy-soft">
          Advance captured with PayPal, capture <span className="font-mono">{contract.advanceCaptureId}</span>
        </p>
      )}
    </div>
  );
}
