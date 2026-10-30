import { z } from 'zod';
import { db } from '@/lib/db/client';
import { handle, parseBody, type IdContext } from '@/lib/http';
import { setMandate } from '@/lib/services/premium';

const Body = z.object({ perPlotCents: z.number().int().positive(), capCents: z.number().int().positive() }).refine((b) => b.capCents >= b.perPlotCents, {
  message: 'The cap must cover at least one plot',
});

export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  return Response.json(await setMandate(await db(), id, await parseBody(request, Body)));
});
