import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ledgerReceipts, milestones } from '@/lib/db/schema';
import { openWindowNow } from '@/lib/services/season-clock';
import { verifyLedger } from '@/lib/services/ledger';
import { freshDb, NOW, createSeason } from '../helpers';

describe('time machine', () => {
  it('opens a closed payment window now and records it as a test change', async () => {
    const db = await freshDb();
    await createSeason(db);
    const later = NOW + 400 * 24 * 60 * 60_000;

    await openWindowNow(db, 'contract-1', 'INPUTS', later);

    const [inputs] = await db.select().from(milestones).where(eq(milestones.id, 'm-inputs'));
    expect(inputs.opensAt).toBeLessThanOrEqual(later);
    expect(inputs.closesAt).toBeGreaterThan(later);
    const [receipt] = await db.select().from(ledgerReceipts);
    expect(receipt.payload).toMatchObject({ kind: 'TEST_WINDOW_OPENED', milestone: 'INPUTS' });
    expect(await verifyLedger(db)).toEqual({ ok: true });
  });
});
