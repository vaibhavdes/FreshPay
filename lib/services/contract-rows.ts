import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { farmers, inputDealers, milestones, payoutItems, paypalOps, plots } from '../db/schema';
import type { EudrStatus } from '../engine/gate';
import { releaseKey } from '../engine/gate';
import { PLOT_MILESTONES, type PlotMilestone } from '../engine/stateMachine';

export type MilestoneRow = {
  id: string;
  type: PlotMilestone;
  state: string;
  trancheCents: number;
  decidedAt: number | null;
  reasons: string[];
  batchId: string | null;
  opStatus: string | null;
  learnedFrom: string | null;
  syncMs: number | null;
  webhookMs: number | null;
  debugId: string | null;
  payouts: { payee: string; cents: number; status: string }[];
};

export type PlotRow = {
  plotId: string;
  plot: string;
  farmer: string;
  areaHa: number;
  eudrStatus: EudrStatus;
  lossHa: number | null;
  paidCents: number;
  milestones: MilestoneRow[];
};

// One row per plot in the contract, each carrying its milestones, PayPal ops and payout items.
export async function contractRows(db: Db, contractId: string): Promise<PlotRow[]> {
  const contractMilestones = await db.select().from(milestones).where(eq(milestones.contractId, contractId));
  const plotIds = [...new Set(contractMilestones.map((m) => m.plotId))];
  if (!plotIds.length) return [];

  const plotRows = await db
    .select({ plot: plots, farmer: farmers.name })
    .from(plots)
    .innerJoin(farmers, eq(plots.farmerId, farmers.id))
    .where(inArray(plots.id, plotIds));

  const keys = contractMilestones.map((m) => releaseKey(contractId, m.plotId, m.type, m.version));
  const ops = await db.select().from(paypalOps).where(inArray(paypalOps.key, keys));
  const items = ops.length ? await db.select().from(payoutItems).where(inArray(payoutItems.opId, ops.map((o) => o.id))) : [];

  const names = new Map<string, string>([
    ...(await db.select({ id: farmers.id, name: farmers.name }).from(farmers)).map((r) => [r.id, r.name] as const),
    ...(await db.select({ id: inputDealers.id, name: inputDealers.name }).from(inputDealers)).map((r) => [r.id, r.name] as const),
  ]);

  return plotRows
    .map(({ plot, farmer }) => {
      const rows = PLOT_MILESTONES.flatMap((type) => {
        const m = contractMilestones.find((x) => x.plotId === plot.id && x.type === type);
        if (!m) return [];
        const op = ops.find((o) => o.key === releaseKey(contractId, m.plotId, m.type, m.version));
        const decision = m.decision as { reasons?: string[] } | null;
        return [
          {
            id: m.id,
            type,
            state: m.state,
            trancheCents: m.trancheCents,
            decidedAt: m.decidedAt,
            reasons: decision?.reasons ?? [],
            batchId: op?.paypalId ?? null,
            opStatus: op?.status ?? null,
            learnedFrom: op?.learnedFrom ?? null,
            syncMs: op?.syncMs ?? null,
            webhookMs: op?.webhookMs ?? null,
            debugId: op?.debugId ?? null,
            payouts: items
              .filter((i) => i.opId === op?.id)
              .map((i) => ({ payee: names.get(i.payeeId) ?? i.payeeId, cents: i.cents, status: i.status })),
          },
        ];
      });
      return {
        plotId: plot.id,
        plot: plot.name,
        farmer,
        areaHa: plot.areaHa,
        eudrStatus: plot.eudrStatus,
        lossHa: plot.eudrCheck ? Number(plot.eudrCheck.lossSince2021Ha) : null,
        paidCents: rows.filter((r) => r.state === 'RELEASED').reduce((sum, r) => sum + r.trancheCents, 0),
        milestones: rows,
      };
    })
    .sort((a, b) => a.plotId.localeCompare(b.plotId));
}
