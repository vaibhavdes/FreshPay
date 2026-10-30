import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { MILESTONE_LABELS, REASON_COPY } from '@/lib/claim-copy';
import { db } from '@/lib/db/client';
import { contracts, farmers, milestones, payoutItems, plots } from '@/lib/db/schema';
import { centroid } from '@/lib/engine/geo';
import { allocate } from '@/lib/engine/splits';
import { PLOT_MILESTONES } from '@/lib/engine/stateMachine';
import { env } from '@/lib/env';
import { formatHa, formatUsd } from '@/lib/format';
import { PlotOutline } from '../../ui/plot-outline';
import { ClaimFlow } from './claim-flow';

export const metadata: Metadata = { title: 'Farmer' };

const STATUS_COPY: Record<string, string> = {
  PENDING: 'Sending',
  SUCCESS: 'Received',
  UNCLAIMED: 'Waiting for you to claim it in PayPal',
  RETURNED: 'Returned',
  FAILED: 'Failed',
};

export default async function FarmerPlot({ params }: PageProps<'/m/[plotId]'>) {
  await connection();
  const { plotId } = await params;
  const database = await db();

  const [row] = await database.select({ plot: plots, farmer: farmers }).from(plots).innerJoin(farmers, eq(plots.farmerId, farmers.id)).where(eq(plots.id, plotId));
  if (!row) notFound();
  const { plot, farmer } = row;

  const plotMilestones = await database.select().from(milestones).where(eq(milestones.plotId, plot.id));
  const ordered = PLOT_MILESTONES.map((type) => plotMilestones.find((m) => m.type === type)).filter((m) => m !== undefined);
  const next = ordered.find((m) => m.state !== 'RELEASED');
  const [contract] = next ? await database.select().from(contracts).where(eq(contracts.id, next.contractId)) : [];
  const received = await database.select().from(payoutItems).where(and(eq(payoutItems.payeeId, farmer.id)));
  const lastDecision = next?.decision as { kind?: string; reasons?: (keyof typeof REASON_COPY)[] } | null | undefined;

  return (
    <main className="mx-auto w-full max-w-md px-5 pb-16 pt-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-canopy-soft">Hello, {farmer.name.split(' ')[0]}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{plot.name}</h1>
          <p className="mt-1 text-canopy-soft">
            {formatHa(plot.areaHa)}, {plot.commodity}
          </p>
        </div>
        <PlotOutline ring={plot.ring} tone={plot.eudrStatus === 'FAIL' ? 'cherry' : 'leaf'} title={`Boundary of ${plot.name}`} className="w-24 shrink-0" />
      </header>

      {plot.eudrStatus === 'FAIL' && (
        <p className="mt-6 rounded-md bg-cherry-wash px-4 py-3 leading-relaxed text-cherry">{REASON_COPY.EUDR_FAILED}</p>
      )}

      {next ? (
        <section className="mt-8 border-t border-contour pt-6">
          <h2 className="text-xl font-bold">Next payment: {MILESTONE_LABELS[next.type].title}</h2>
          <p className="mt-2 text-lg">
            You receive{' '}
            <strong>{formatUsd(allocate(next.trancheCents, next.shares).find((s) => s.id === farmer.id)?.cents ?? 0)}</strong>
            {next.shares.length > 1 && <span className="text-canopy-soft"> (the rest goes to your input dealer)</span>}
          </p>
          {next.state === 'REVIEW' && lastDecision?.reasons?.[0] && (
            <p className="mt-4 rounded-md bg-monsoon-wash px-4 py-3 leading-relaxed">{REASON_COPY[lastDecision.reasons[0]]}</p>
          )}
          {contract && (
            <ClaimFlow
              plotId={plot.id}
              milestoneId={next.id}
              milestone={next.type}
              prompt={MILESTONE_LABELS[next.type].prompt}
              demoLocation={env().DEMO_MODE ? centroid(plot.ring) : null}
            />
          )}
        </section>
      ) : (
        <p className="mt-8 border-t border-contour pt-6 text-lg">All payments for this season are done.</p>
      )}

      <section className="mt-10 border-t border-contour pt-6">
        <h2 className="text-xl font-bold">Payments</h2>
        {received.length ? (
          <ul className="mt-3 divide-y divide-contour">
            {received.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-4 py-3">
                <span className="text-canopy-soft">{STATUS_COPY[item.status] ?? item.status}</span>
                <span className="text-lg font-semibold">{formatUsd(item.cents)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-canopy-soft">Nothing yet. Your first payment arrives when your plot is registered.</p>
        )}
      </section>
    </main>
  );
}
