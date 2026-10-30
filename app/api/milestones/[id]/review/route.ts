import { after } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { milestones } from '@/lib/db/schema';
import { handle, parseBody, type IdContext } from '@/lib/http';
import { approveHeldClaim, refuseHeldClaim } from '@/lib/services/milestones';
import { chargePremiumsWithVault } from '@/lib/services/premium';

const Body = z.object({ action: z.enum(['approve', 'refuse']), note: z.string().max(500).optional() });

// The demo has one cooperative officer; a real deployment would take the reviewer from the session.
const REVIEWER = 'Malnad FPO field officer';

export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  const { action, note } = await parseBody(request, Body);
  const database = await db();
  const review = action === 'approve' ? approveHeldClaim : refuseHeldClaim;
  const result = await review(database, { milestoneId: id, reviewer: REVIEWER, note });
  if (result.decision.kind === 'RELEASE') {
    const [{ contractId }] = await database.select({ contractId: milestones.contractId }).from(milestones).where(eq(milestones.id, id));
    after(() => chargePremiumsWithVault(database, contractId).catch((error: unknown) => console.error('Premium charge failed', error instanceof Error ? error.message : error)));
  }
  return Response.json(result);
});
