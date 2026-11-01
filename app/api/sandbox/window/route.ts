import { z } from 'zod';
import { db } from '@/lib/db/client';
import { PLOT_MILESTONES } from '@/lib/engine/stateMachine';
import { handle, parseBody } from '@/lib/http';
import { openWindowNow } from '@/lib/services/season-clock';

const Body = z.object({ contractId: z.string().min(1), milestone: z.enum(PLOT_MILESTONES) });

export const POST = handle(async (request: Request) => {
  const { contractId, milestone } = await parseBody(request, Body);
  return Response.json(await openWindowNow(await db(), contractId, milestone));
});
