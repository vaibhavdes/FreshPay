import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { contracts, farmers, milestones, plots } from '../db/schema';
import { PLOT_MILESTONES, type PlotMilestone } from '../engine/stateMachine';
import { notFound } from './errors';
import { appendLedger } from './ledger';

const DAY = 24 * 60 * 60_000;

// The time machine: a real season spreads these steps over months, so the demo opens a step's
// payment window now. The change is written to the ledger, so the record shows it was a demo.
export async function openWindowNow(db: Db, contractId: string, type: PlotMilestone, now = Date.now()) {
  const rows = await db.select().from(milestones).where(and(eq(milestones.contractId, contractId), eq(milestones.type, type)));
  if (!rows.length) throw notFound(`${type} milestones on ${contractId}`);
  const scheduled = { opensAt: Math.min(...rows.map((m) => m.opensAt)), closesAt: Math.max(...rows.map((m) => m.closesAt)) };
  const opened = { opensAt: Math.min(scheduled.opensAt, now - 60_000), closesAt: Math.max(scheduled.closesAt, now + 14 * DAY) };

  await db.update(milestones).set(opened).where(and(eq(milestones.contractId, contractId), eq(milestones.type, type)));
  await appendLedger(db, { kind: 'DEMO_WINDOW_OPENED', contractId, milestone: type, scheduled, opened }, now);
  return opened;
}

export async function demoState(db: Db, contractId: string, now = Date.now()) {
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!contract) return null;
  const all = await db.select().from(milestones).where(eq(milestones.contractId, contract.id));
  const windows = PLOT_MILESTONES.map((type) => {
    const rows = all.filter((m) => m.type === type);
    const opensAt = Math.min(...rows.map((m) => m.opensAt));
    const closesAt = Math.max(...rows.map((m) => m.closesAt));
    return { type, opensAt, closesAt, open: now >= opensAt && now <= closesAt };
  });
  const plotIds = [...new Set(all.map((m) => m.plotId))];
  const plotRows = (
    await db
      .select({ id: plots.id, name: plots.name, farmer: farmers.name, status: plots.eudrStatus })
      .from(plots)
      .innerJoin(farmers, eq(plots.farmerId, farmers.id))
      .orderBy(asc(plots.id))
  ).filter((p) => plotIds.includes(p.id));
  return { contract: { id: contract.id, state: contract.state, season: contract.season }, windows, plots: plotRows };
}
