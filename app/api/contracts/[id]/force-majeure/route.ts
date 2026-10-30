import { z } from 'zod';
import { db } from '@/lib/db/client';
import { handle, parseBody, type IdContext } from '@/lib/http';
import { declareForceMajeure } from '@/lib/services/force-majeure';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.object({ startDate: date, endDate: date }).refine((b) => b.startDate <= b.endDate, { message: 'The window must end after it starts' });

export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  const { decision, evidence, contract } = await declareForceMajeure(await db(), id, await parseBody(request, Body));
  return Response.json({ decision, evidence, state: contract.state, refundId: contract.refundId });
});
