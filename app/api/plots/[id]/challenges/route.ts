import { z } from 'zod';
import { db } from '@/lib/db/client';
import { PLOT_MILESTONES } from '@/lib/engine/stateMachine';
import { handle, parseBody, type IdContext } from '@/lib/http';
import { issueChallenge } from '@/lib/services/challenges';

const Body = z.object({ milestone: z.enum(PLOT_MILESTONES) });

export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  const { milestone } = await parseBody(request, Body);
  return Response.json(await issueChallenge(await db(), id, milestone), { status: 201 });
});
