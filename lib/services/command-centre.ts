import { eq, inArray } from 'drizzle-orm';
import { MILESTONE_LABELS } from '../claim-copy';
import type { Db } from '../db/client';
import { contracts, farmers, inputDealers, milestones, payoutItems, paypalOps, plots, premiums } from '../db/schema';

// Rows for the buyer's AG Studio command centre. Amounts are in dollars for display; every money
// decision elsewhere stays in integer cents.
const usd = (cents: number | null | undefined) => (cents ?? 0) / 100;
const day = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(0, 10) : null);
const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const EUDR_LABEL = { PASS: 'Deforestation-free', REVIEW: 'Needs review', FAIL: 'Tree cover lost' } as const;

export async function commandCentreData(db: Db, contractId: string) {
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!contract) return null;

  const contractMilestones = await db.select().from(milestones).where(eq(milestones.contractId, contractId));
  const plotIds = [...new Set(contractMilestones.map((m) => m.plotId))];
  const plotRows = plotIds.length ? await db.select({ plot: plots, farmer: farmers.name }).from(plots).innerJoin(farmers, eq(plots.farmerId, farmers.id)).where(inArray(plots.id, plotIds)) : [];
  const ops = (await db.select().from(paypalOps)).filter((o) => o.key.startsWith(`${contractId}/`));
  const items = ops.length ? await db.select().from(payoutItems).where(inArray(payoutItems.opId, ops.map((o) => o.id))) : [];
  const contractPremiums = await db.select().from(premiums).where(eq(premiums.contractId, contractId));

  const names = new Map<string, { name: string; type: 'Farmer' | 'Input dealer' }>([
    ...(await db.select({ id: farmers.id, name: farmers.name }).from(farmers)).map((f) => [f.id, { name: f.name, type: 'Farmer' as const }] as const),
    ...(await db.select({ id: inputDealers.id, name: inputDealers.name }).from(inputDealers)).map((d) => [d.id, { name: d.name, type: 'Input dealer' as const }] as const),
  ]);
  const purposeOf = (key: string) => (key.includes('/premium/') ? 'Premium' : key.includes('/balance/') ? 'Delivery balance' : key.split('/')[2]?.replace('_', ' ').toLowerCase() ?? 'payment');

  return {
    asOf: new Date().toISOString(),
    contract: {
      id: contract.id,
      season: contract.season,
      state: contract.state,
      totalUsd: usd(contract.totalCents),
      advanceUsd: usd(contract.advanceCents),
      heldUsd: usd(contract.escrowRemainingCents),
      paypalFundOrderId: contract.advanceOrderId,
      paypalBalanceOrderId: contract.balanceOrderId,
      carrier: contract.carrier,
      trackingNumber: contract.trackingNumber,
    },
    plots: plotRows.map(({ plot, farmer }) => ({
      id: plot.id,
      plot: plot.name,
      farmer,
      variety: capitalise(plot.variety ?? plot.commodity),
      areaHa: plot.areaHa,
      eudrStatus: EUDR_LABEL[plot.eudrStatus],
      lossHa: (plot.eudrCheck as { lossSince2021Ha?: number } | null)?.lossSince2021Ha ?? 0,
      contractValueUsd: usd(plot.valueCents),
      paidUsd: usd(contractMilestones.filter((m) => m.plotId === plot.id && m.state === 'RELEASED').reduce((s, m) => s + (m.reservedCents || m.trancheCents), 0)),
    })),
    milestones: contractMilestones.map((m) => ({
      id: m.id,
      plotId: m.plotId,
      milestone: MILESTONE_LABELS[m.type].title,
      state: m.state === 'RELEASED' ? 'Paid' : m.state === 'REVIEW' ? 'Held for review' : (m.decision as { reasons?: string[] } | null)?.reasons?.length ? 'Refused' : 'Open',
      reason: (m.decision as { reasons?: string[] } | null)?.reasons?.[0] ?? '',
      trancheUsd: usd(m.state === 'RELEASED' ? m.reservedCents || m.trancheCents : m.trancheCents),
      opensOn: day(m.opensAt),
      decidedOn: day(m.decidedAt),
    })),
    payouts: items.map((i) => {
      const op = ops.find((o) => o.id === i.opId)!;
      const payee = names.get(i.payeeId);
      return {
        id: i.id,
        payee: payee?.name ?? i.payeeId,
        payeeType: payee?.type ?? 'Farmer',
        purpose: purposeOf(op.key),
        status: i.status,
        amountUsd: usd(i.cents),
        paidOn: day(op.createdAt),
      };
    }),
    premiums: contractPremiums.map((p) => ({ id: p.id, plotId: p.plotId, state: p.state, amountUsd: usd(p.cents), accruedOn: day(p.createdAt) })),
    paypalCalls: ops.map((o) => ({
      id: o.id,
      call: o.op,
      status: o.status,
      amountUsd: usd(o.cents),
      confirmedBy: o.learnedFrom === 'WEBHOOK' ? 'Webhook first' : o.learnedFrom === 'SYNC' ? 'API response' : 'Pending',
      apiSeconds: o.syncMs === null ? null : o.syncMs / 1000,
      webhookSeconds: o.webhookMs === null ? null : o.webhookMs / 1000,
      on: day(o.createdAt),
    })),
  };
}

export type CommandCentreData = NonNullable<Awaited<ReturnType<typeof commandCentreData>>>;
