import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/client';
import { contracts, milestones, plots } from '@/lib/db/schema';
import { seasonState } from '@/lib/services/season-clock';
import { seasonEntry } from '@/lib/services/entry';
import { verifyLedger } from '@/lib/services/ledger';
import { startVisitorSeason } from '@/lib/services/visitor-season';
import { freshDb, NOW, createSeason } from '../helpers';

let db: Db;

beforeEach(async () => {
  db = await freshDb();
  await createSeason(db);
  await db.update(milestones).set({ state: 'RELEASED' }).where(eq(milestones.id, 'm-verified'));
});

describe('startVisitorSeason', () => {
  it('copies the season with its farms and stages, unfunded and unpaid', async () => {
    const id = await startVisitorSeason(db, 'contract-1', NOW);

    const [copy] = await db.select().from(contracts).where(eq(contracts.id, id));
    expect(copy).toMatchObject({ state: 'DRAFT', escrowRemainingCents: 0, advanceCents: 200_000, advanceOrderId: null });
    const stages = await db.select().from(milestones).where(eq(milestones.contractId, id));
    expect(stages.map((m) => [m.type, m.state])).toEqual([
      ['INPUTS', 'PENDING'],
      ['PLOT_VERIFIED', 'PENDING'],
    ]);
    const [farm] = await db.select().from(plots).where(eq(plots.id, stages[0].plotId));
    expect(farm).toMatchObject({ farmerId: 'farmer-1', eudrStatus: 'PASS', name: 'Hill plot 1' });
    expect(await verifyLedger(db)).toEqual({ ok: true });
  });

  it('gives each visitor a separate season the entry points and tour follow', async () => {
    const [a, b] = [await startVisitorSeason(db, 'contract-1', NOW + 1), await startVisitorSeason(db, 'contract-1', NOW + 2)];
    expect(a).not.toBe(b);

    const entry = await seasonEntry(db, a);
    expect(entry.contractId).toBe(a);
    expect(entry.farmId).toMatch(/^plot-1-/);
    expect((await seasonState(db, a, NOW))!.plots.map((p) => p.id)).toEqual([entry.farmId]);
    expect((await seasonEntry(db)).contractId).toBe('contract-1');
  });
});
