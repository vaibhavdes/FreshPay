import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { eq } from 'drizzle-orm';
import { MILESTONE_LABELS, REASON_COPY, SUPPLIER_ROLE } from '@/lib/claim-copy';
import { db } from '@/lib/db/client';
import { contracts, farmers, inputDealers, milestones, payoutItems, plots } from '@/lib/db/schema';
import { centroid } from '@/lib/engine/geo';
import { PLOT_MILESTONES } from '@/lib/engine/stateMachine';
import { env } from '@/lib/env';
import { formatHa, formatUsd } from '@/lib/format';
import { LiveRefresh } from '../../ui/live-refresh';
import { SatelliteMap } from '../../ui/satellite-map';
import { NextStep, StepRail, TopBar } from '../../ui/shell';
import { farmerCents, StageMark, stageStatus, STATUS_TEXT } from '../../ui/stage-mark';
import { ClaimFlow } from './claim-flow';

export const metadata: Metadata = { title: 'My farm' };

const PAYOUT_STATUS: Record<string, string> = {
  PENDING: 'On its way',
  SUCCESS: 'Received',
  UNCLAIMED: 'Claim it in PayPal',
  RETURNED: 'Returned',
  FAILED: 'Failed',
};

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default async function MyFarm({ params }: PageProps<'/m/[plotId]'>) {
  await connection();
  const { plotId } = await params;
  const database = await db();

  const [row] = await database.select({ plot: plots, farmer: farmers }).from(plots).innerJoin(farmers, eq(plots.farmerId, farmers.id)).where(eq(plots.id, plotId));
  if (!row) notFound();
  const { plot, farmer } = row;

  const rows = await database.select().from(milestones).where(eq(milestones.plotId, plot.id));
  const stages = PLOT_MILESTONES.flatMap((type) => rows.filter((m) => m.type === type)).map((m) => ({
    ...m,
    reasons: ((m.decision as { reasons?: string[] } | null)?.reasons ?? []) as string[],
  }));
  const next = stages.find((m) => m.state !== 'RELEASED');
  const [contract] = next ? await database.select().from(contracts).where(eq(contracts.id, next.contractId)) : [];
  const received = await database.select().from(payoutItems).where(eq(payoutItems.payeeId, farmer.id));
  const paidCents = received.filter((i) => i.status !== 'FAILED' && i.status !== 'RETURNED').reduce((sum, i) => sum + i.cents, 0);
  const seasonCents = stages.reduce((sum, s) => sum + farmerCents(s, farmer.id), 0);
  const refused = plot.eudrStatus === 'FAIL';
  const suppliers = (await database.select().from(inputDealers)).map((x) => ({ id: x.id, name: x.name, kind: x.kind, role: SUPPLIER_ROLE[x.kind] }));
  const names = Object.fromEntries([[farmer.id, { name: farmer.name, role: 'Farmer' }], ...suppliers.map((x) => [x.id, { name: x.name, role: x.role }])]);

  return (
    <>
      <LiveRefresh />
      <TopBar role="farmer" />
      <StepRail current={3} />
      <main className="mx-auto grid w-full max-w-6xl gap-8 px-6 pb-16 pt-8 sm:px-10 lg:grid-cols-12">
        <aside className="lg:col-span-5">
        <div className="overflow-hidden rounded-2xl border border-contour bg-sheet lg:sticky lg:top-6">
          <SatelliteMap plots={[{ id: plot.id, name: plot.name, ring: plot.ring, status: plot.eudrStatus }]} width={460} title={`Satellite view of ${plot.name}`} />
          <div className="p-5">
            <p className="text-canopy-soft">Hello, {farmer.name.split(' ')[0]}</p>
            <h1 className="text-3xl font-bold tracking-tight">{plot.name}</h1>
            <p className="text-canopy-soft">
              {formatHa(plot.areaHa)} of {plot.variety ?? plot.commodity}
            </p>
            <div className="mt-4 flex items-end justify-between gap-4 rounded-xl bg-leaf-wash px-4 py-3">
              <div>
                <p className="text-sm text-canopy-soft">Paid to you so far</p>
                <p className="text-3xl font-bold tabular-nums">{formatUsd(paidCents)}</p>
              </div>
              <p className="text-right text-sm text-canopy-soft">
                of {formatUsd(seasonCents)}
                <br />
                before harvest sale
              </p>
            </div>
          </div>
        </div>
        </aside>

        <div className="lg:col-span-7">
        {refused && <p className="mb-4 rounded-xl bg-cherry-wash px-4 py-3 leading-relaxed text-cherry">{REASON_COPY.EUDR_FAILED}</p>}

        <h2 className="text-xl font-bold">This season&apos;s stages</h2>
        <ol className="mt-3 space-y-3">
          {stages.map((stage) => {
            const isNext = stage.id === next?.id;
            const status = refused && stage.state !== 'RELEASED' ? 'refused' : stageStatus(stage, isNext);
            return (
              <li key={stage.id} className={`rounded-xl border bg-sheet p-4 ${isNext && !refused ? 'border-leaf' : 'border-contour'}`}>
                <div className="flex items-center gap-3">
                  <StageMark status={status} />
                  <div className="flex-1">
                    <p className="font-semibold">{MILESTONE_LABELS[stage.type].title}</p>
                    <p className="text-sm text-canopy-soft">
                      {status === 'later' ? `Opens ${day(stage.opensAt)}` : STATUS_TEXT[status]}
                      {stage.rule && ' · bills paid separately'}
                    </p>
                  </div>
                  <p className="font-semibold tabular-nums">{formatUsd(farmerCents(stage, farmer.id))}</p>
                </div>
                {isNext && stage.state === 'REVIEW' && stage.reasons[0] && (
                  <p className="mt-3 rounded-lg bg-monsoon-wash px-3 py-2 text-sm">{REASON_COPY[stage.reasons[0] as keyof typeof REASON_COPY]}</p>
                )}
                {isNext && !refused && contract && stage.state !== 'REVIEW' && (
                  <ClaimFlow
                    plotId={plot.id}
                    milestoneId={stage.id}
                    milestone={stage.type}
                    prompt={MILESTONE_LABELS[stage.type].prompt}
                    farmCentre={env().DEMO_MODE ? centroid(plot.ring) : null}
                    bills={(stage.rule?.lines ?? []).map((l) => ({ kind: l.kind, defaultId: l.payeeId, suppliers: suppliers.filter((x) => x.kind === l.kind) }))}
                    names={names}
                  />
                )}
              </li>
            );
          })}
        </ol>

        <section className="mt-8">
          <h2 className="font-bold">Payments to you</h2>
          {received.length ? (
            <ul className="mt-2 divide-y divide-contour rounded-xl border border-contour bg-sheet px-4">
              {received.map((item) => (
                <li key={item.id} className={`flex items-baseline justify-between gap-4 py-3 ${item.status === 'PENDING' ? 'in-transit' : ''}`}>
                  <span className="text-canopy-soft">{PAYOUT_STATUS[item.status] ?? item.status}</span>
                  <span className="font-semibold tabular-nums">{formatUsd(item.cents)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-canopy-soft">Nothing yet. The first payment comes when your farm is mapped and checked.</p>
          )}
        </section>

        <NextStep href={`/farms/${plot.id}`} label="See this farm's record" />
        </div>
      </main>
    </>
  );
}
