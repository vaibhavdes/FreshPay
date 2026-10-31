import { asc, eq, inArray, like } from 'drizzle-orm';
import { SUPPLIER_ROLE } from '../claim-copy';
import type { Db } from '../db/client';
import { buyers, contracts, cooperatives, evidence, farmers, inputDealers, ledgerReceipts, milestones, payoutItems, paypalOps, plots } from '../db/schema';
import { buildEudrRecord, type GeoCheck } from '../engine/eudr';
import { PLOT_MILESTONES } from '../engine/stateMachine';
import { notFound } from './errors';

type Reading = { transcript?: string; spokenLanguage?: string | null; originalTranscript?: string | null; challengeCodeRead?: string | null; cropStage?: string; inputsBought?: string | null; confidence?: number; notes?: string };

// Everything that happened to one plot this season: the land check, each piece of evidence with
// what the model read from it, each PayPal payment and the ledger receipts behind them. The
// buyer files the GeoJSON part; the rest is what a person reads to trust it.
export async function plotRecord(db: Db, plotId: string, now = Date.now()) {
  const [row] = await db
    .select({ plot: plots, farmer: farmers.name, cooperative: cooperatives.name })
    .from(plots)
    .innerJoin(farmers, eq(plots.farmerId, farmers.id))
    .innerJoin(cooperatives, eq(farmers.cooperativeId, cooperatives.id))
    .where(eq(plots.id, plotId));
  if (!row) throw notFound(`Plot ${plotId}`);
  const { plot } = row;

  const plotMilestones = (await db.select().from(milestones).where(eq(milestones.plotId, plotId))).sort(
    (a, b) => PLOT_MILESTONES.indexOf(a.type) - PLOT_MILESTONES.indexOf(b.type),
  );
  const contractId = plotMilestones[0]?.contractId;
  const [contract] = contractId ? await db.select().from(contracts).where(eq(contracts.id, contractId)) : [];
  const [buyer] = contract ? await db.select().from(buyers).where(eq(buyers.id, contract.buyerId)) : [];

  const proofs = plotMilestones.length
    ? await db.select().from(evidence).where(inArray(evidence.milestoneId, plotMilestones.map((m) => m.id))).orderBy(asc(evidence.createdAt))
    : [];
  const ops = contractId ? await db.select().from(paypalOps).where(like(paypalOps.key, `${contractId}/${plotId}/%`)) : [];
  const items = ops.length ? await db.select().from(payoutItems).where(inArray(payoutItems.opId, ops.map((o) => o.id))) : [];
  const payees = new Map([
    ...(await db.select({ id: farmers.id, name: farmers.name }).from(farmers)).map((f) => [f.id, { name: f.name, role: 'Farmer' }] as const),
    ...(await db.select({ id: inputDealers.id, name: inputDealers.name, kind: inputDealers.kind }).from(inputDealers)).map(
      (d) => [d.id, { name: d.name, role: SUPPLIER_ROLE[d.kind] as string }] as const,
    ),
  ]);
  const keys = new Set(ops.map((o) => o.key));
  const receipts = (await db.select().from(ledgerReceipts).orderBy(asc(ledgerReceipts.seq))).filter((r) => keys.has(String(r.payload.key)));

  const steps = plotMilestones.map((m) => {
    const op = ops.find((o) => o.key.startsWith(`${contractId}/${plotId}/${m.type}/release/`) && o.status === 'COMPLETED');
    return {
      id: m.id,
      type: m.type,
      label: m.label,
      state: m.state,
      reasons: ((m.decision as { reasons?: string[] } | null)?.reasons ?? []) as string[],
      // Why a person was asked to check this stage before approving it; empty if it paid on its own.
      approvedAfter: receipts
        .filter((r) => r.payload.kind === 'REVIEW_APPROVED' && r.payload.milestoneId === m.id)
        .flatMap((r) => (r.payload.heldFor as string[] | undefined) ?? []),
      trancheCents: m.trancheCents,
      rule: m.rule,
      bills: m.bills,
      opensAt: m.opensAt,
      closesAt: m.closesAt,
      decidedAt: m.decidedAt,
      evidence: proofs
        .filter((e) => e.milestoneId === m.id)
        .map((e) => ({
          kind: e.kind,
          sha256: e.sha256,
          gps: e.gps,
          at: e.createdAt,
          reading: ((e.oracle as { reading?: Reading } | null)?.reading ?? null) as Reading | null,
        })),
      payment: op && {
        batchId: op.paypalId,
        confirmedBy: op.learnedFrom,
        items: items.filter((i) => i.opId === op.id).map((i) => ({ payee: payees.get(i.payeeId)?.name ?? i.payeeId, role: payees.get(i.payeeId)?.role ?? '', cents: i.cents, status: i.status })),
        receipts: receipts.filter((r) => r.payload.key === op.key).map((r) => ({ seq: r.seq, hash: r.hash, kind: String(r.payload.kind) })),
      },
    };
  });

  const check = plot.eudrCheck as GeoCheck | null;
  const geojson = buildEudrRecord({
    plot: { id: plot.id, name: plot.name, ring: plot.ring, areaHa: plot.areaHa, country: plot.country, commodity: plot.commodity },
    producer: { name: row.farmer, cooperative: row.cooperative },
    operator: { name: buyer?.name ?? 'Unassigned', country: buyer?.country ?? '' },
    check,
    evidence: steps.flatMap((s) => s.evidence.map((e) => ({ milestone: s.type, sha256: e.sha256, verifiedAt: new Date(e.at).toISOString() }))),
    payments: steps.flatMap((s) => (s.payment?.batchId ? [{ milestone: s.type, paypalId: s.payment.batchId, cents: s.payment.items.reduce((sum, i) => sum + i.cents, 0) }] : [])),
    generatedAt: new Date(now).toISOString(),
  });

  return {
    plot: { id: plot.id, name: plot.name, ring: plot.ring, areaHa: plot.areaHa, country: plot.country, commodity: plot.commodity, variety: plot.variety, status: plot.eudrStatus },
    farmer: row.farmer,
    cooperative: row.cooperative,
    buyer: buyer?.name ?? null,
    contract: contract ? { id: contract.id, season: contract.season } : null,
    landCheck: check,
    steps,
    geojson,
  };
}

export type PlotRecord = Awaited<ReturnType<typeof plotRecord>>;
