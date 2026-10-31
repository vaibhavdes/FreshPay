import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { contracts, milestones, plots } from '@/lib/db/schema';
import { verifyLedger } from '@/lib/services/ledger';
import { registerPlot } from '@/lib/services/onboarding';
import { freshDb, NOW, seed } from '../helpers';

// About 90 m by 58 m near Mudigere: roughly half a hectare.
const RING: [number, number][] = [
  [75.6401, 13.2752],
  [75.64093, 13.27524],
  [75.64091, 13.27576],
  [75.64008, 13.27572],
];

const input = { contractId: 'contract-1', farmerName: 'Shantha Gowda', paypalEmail: 'shantha@example.com', plotName: 'Hosahalli upper block', variety: 'arabica' as const, ring: RING };

describe('registerPlot', () => {
  it('adds the plot to the season with its milestones and grows the contract', async () => {
    const db = await freshDb();
    await seed(db);
    const [before] = await db.select().from(contracts).where(eq(contracts.id, 'contract-1'));

    const result = await registerPlot(db, input, async () => ({ lossSince2021Ha: 0.6, source: 'test', fetchedAt: new Date(NOW).toISOString() }), NOW);

    expect(result).toMatchObject({ landCheck: 'FAIL' });
    expect(result.areaHa).toBeGreaterThan(0.4);
    const [plot] = await db.select().from(plots).where(eq(plots.id, result.plotId));
    expect(plot).toMatchObject({ eudrStatus: 'FAIL', variety: 'arabica', valueCents: result.valueCents });
    expect((await db.select().from(milestones).where(eq(milestones.plotId, result.plotId))).map((m) => m.type)).toEqual(['PLOT_VERIFIED', 'INPUTS', 'CROP_CARE', 'HARVEST', 'PROCESSING']);
    const [after] = await db.select().from(contracts).where(eq(contracts.id, 'contract-1'));
    expect(after.totalCents).toBe(before.totalCents + result.valueCents);
    expect(await verifyLedger(db)).toEqual({ ok: true });
  });

  it('refuses an outline too small to be a plot', async () => {
    const db = await freshDb();
    await seed(db);
    const tiny: [number, number][] = [
      [75.6401, 13.2752],
      [75.64012, 13.2752],
      [75.64012, 13.27522],
    ];
    await expect(registerPlot(db, { ...input, ring: tiny }, async () => null, NOW)).rejects.toThrow('Walk the plot');
  });
});
