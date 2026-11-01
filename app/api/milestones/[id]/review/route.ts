import { after } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { contracts, cooperatives, milestones } from '@/lib/db/schema';
import { handle, parseBody, type IdContext } from '@/lib/http';
import { SUPPLIER_KINDS, type SupplierKind } from '@/lib/engine/gate';
import { billToUsdCents } from '@/lib/season-terms';
import { approveHeldClaim, refuseHeldClaim } from '@/lib/services/milestones';
import { chargePremiumsWithVault } from '@/lib/services/premium';

// billRupees: totals of bills the model couldn't read, by kind, as printed; code converts them to dollars.
const Body = z.object({
  action: z.enum(['approve', 'refuse']),
  note: z.string().max(500).optional(),
  billRupees: z.partialRecord(z.enum(SUPPLIER_KINDS), z.number().positive().max(10_000_000)).optional(),
});


export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  const { action, note, billRupees } = await parseBody(request, Body);
  const database = await db();
  const [coop] = await database
    .select({ name: cooperatives.name })
    .from(milestones)
    .innerJoin(contracts, eq(milestones.contractId, contracts.id))
    .innerJoin(cooperatives, eq(contracts.cooperativeId, cooperatives.id))
    .where(eq(milestones.id, id));
  // One field officer per cooperative for now; a real deployment would take the reviewer from the session.
  const reviewer = `${coop?.name ?? 'Cooperative'} field officer`;
  const review = action === 'approve' ? approveHeldClaim : refuseHeldClaim;
  const bills = billRupees && (Object.entries(billRupees) as [SupplierKind, number][]).map(([kind, amount]) => ({ kind, cents: billToUsdCents({ amount, currency: 'INR' }) ?? 0 }));
  const result = await review(database, { milestoneId: id, reviewer, note, bills });
  if (result.decision.kind === 'RELEASE') {
    const [{ contractId }] = await database.select({ contractId: milestones.contractId }).from(milestones).where(eq(milestones.id, id));
    after(() => chargePremiumsWithVault(database, contractId).catch((error: unknown) => console.error('Premium charge failed', error instanceof Error ? error.message : error)));
  }
  return Response.json(result);
});
