import { z } from 'zod';
import { db } from '@/lib/db/client';
import { handle, parseBody, type IdContext } from '@/lib/http';
import { approveHeldClaim, refuseHeldClaim } from '@/lib/services/milestones';

const Body = z.object({ action: z.enum(['approve', 'refuse']), note: z.string().max(500).optional() });

// The demo has one cooperative officer; a real deployment would take the reviewer from the session.
const REVIEWER = 'Malnad FPO field officer';

export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  const { action, note } = await parseBody(request, Body);
  const review = action === 'approve' ? approveHeldClaim : refuseHeldClaim;
  return Response.json(await review(await db(), { milestoneId: id, reviewer: REVIEWER, note }));
});
