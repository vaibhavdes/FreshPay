import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/client';
import { contracts, inputDealers, milestones } from '@/lib/db/schema';
import { HttpError } from '@/lib/services/errors';
import { registerPlot } from '@/lib/services/onboarding';
import { listOpportunities, opportunity, postOpportunity, type PostOpportunity } from '@/lib/services/opportunities';
import { NOW, freshDb } from '../helpers';

const POTATO: PostOpportunity = {
  company: 'Crisp Valley Foods',
  companyCountry: 'Netherlands',
  country: 'IN',
  region: 'Banaskantha, Gujarat',
  templateId: 'potato',
  hectaresWanted: 40,
  yieldKgPerHa: 30_000,
  priceCentsPerKg: 15,
  advancePercent: 50,
  applyBy: '2026-11-30',
};

// About 1.2 ha near Deesa, Banaskantha.
const FIELD: [number, number][] = [
  [72.18, 24.25],
  [72.1911, 24.25],
  [72.1911, 24.251],
  [72.18, 24.251],
];

let db: Db;

beforeEach(async () => {
  db = await freshDb();
  await db.insert(inputDealers).values([
    { id: 'dealer-1', name: 'Deesa Agro Inputs', kind: 'INPUTS', paypalEmail: 'dealer@farmproof.test', createdAt: NOW },
    { id: 'labour-1', name: 'Deesa Farm Workers Group', kind: 'LABOUR', paypalEmail: 'labour@farmproof.test', createdAt: NOW },
  ]);
});

describe('opportunities', () => {
  it('posts a crop season that farmers join on its own terms', async () => {
    const { id, contractId } = await postOpportunity(db, POTATO, 'buyer@farmproof.test', NOW);
    const joined = await registerPlot(db, { contractId, farmerName: 'Bhavna Patel', paypalEmail: 'bhavna@farmproof.test', plotName: 'Deesa east field', ring: FIELD }, async () => null, NOW);

    const stages = await db.select().from(milestones).where(eq(milestones.contractId, contractId));
    expect(stages.map((m) => m.label).sort()).toEqual(['Blight spray', 'Delivered to the factory', 'Farm mapped', 'Harvest dug and graded', 'Seed potatoes planted']);
    const planting = stages.find((m) => m.type === 'INPUTS')!;
    expect(planting.rule!.lines.map((l) => [l.kind, l.capCents])).toEqual([
      ['INPUTS', Math.round(joined.valueCents * 0.2)],
      ['LABOUR', Math.round(joined.valueCents * 0.03)],
    ]);
    expect(planting.opensAt).toBe(Date.parse('2026-10-15T00:00:00Z'));

    const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
    expect(contract).toMatchObject({ state: 'DRAFT', totalCents: joined.valueCents, advanceCents: Math.round(joined.valueCents / 2 / 100) * 100, commodity: 'potato' });

    const detail = await opportunity(db, id);
    expect(detail).toMatchObject({ company: 'Crisp Valley Foods', title: 'Processing potato from Banaskantha, Gujarat', farms: [{ farmer: 'Bhavna Patel' }] });
    expect((await listOpportunities(db))[0]).toMatchObject({ farms: 1, hectaresJoined: joined.areaHa });
  });

  it('refuses terms whose stages pay more than the advance, and farms outside the country', async () => {
    await expect(postOpportunity(db, { ...POTATO, advancePercent: 30 }, 'buyer@farmproof.test', NOW)).rejects.toThrow(/more than the 30% paid ahead/);

    const { contractId } = await postOpportunity(db, { ...POTATO, country: 'PE', templateId: 'cocoa', advancePercent: 40 }, 'buyer@farmproof.test', NOW);
    const outside = registerPlot(db, { contractId, farmerName: 'Bhavna Patel', paypalEmail: 'bhavna@farmproof.test', plotName: 'Deesa east field', ring: FIELD }, async () => null, NOW);
    await expect(outside).rejects.toBeInstanceOf(HttpError);
    await expect(outside).rejects.toThrow(/isn't in Peru/);
  });
});
