import { z } from 'zod';
import { db } from '@/lib/db/client';
import { handle, parseBody, type IdContext } from '@/lib/http';
import { sendEvidence } from '@/lib/services/disputes';

const Body = z.object({ narrative: z.string().min(20).max(2000).optional() });

export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  const { narrative } = await parseBody(request, Body);
  return Response.json(await sendEvidence(await db(), id, narrative));
});
