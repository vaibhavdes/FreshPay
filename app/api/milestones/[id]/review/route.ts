import { after } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { milestones } from '@/lib/db/schema';
import { handle, parseBody, type IdContext } from '@/lib/http';
import { billToUsdCents } from '@/lib/season-terms';
import { approveHeldClaim, refuseHeldClaim } from '@/lib/services/milestones';
import { chargePremiumsWithVault } from '@/lib/services/premium';

// billRupees: the total on a bill the model couldn't read, as printed; code converts it to dollars.
const Body = z.object({ action: z.enum(['approve', 'refuse']), note: z.string().max(500).optional(), billRupees: z.number().positive().max(10_000_000).optional() });

// The demo has one cooperative officer; a real deployment would take the reviewer from the session.
const REVIEWER = 'Malnad FPO field officer';

export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  const { action, note, billRupees } = await parseBody(request, Body);
  const database = await db();
  const review = action === 'approve' ? approveHeldClaim : refuseHeldClaim;
  const billCents = billRupees === undefined ? undefined : (billToUsdCents({ amount: billRupees, currency: 'INR' }) ?? undefined);
  const result = await review(database, { milestoneId: id, reviewer: REVIEWER, note, billCents });
  if (result.decision.kind === 'RELEASE') {
    const [{ contractId }] = await database.select({ contractId: milestones.contractId }).from(milestones).where(eq(milestones.id, id));
    after(() => chargePremiumsWithVault(database, contractId).catch((error: unknown) => console.error('Premium charge failed', error instanceof Error ? error.message : error)));
  }
  return Response.json(result);
});
