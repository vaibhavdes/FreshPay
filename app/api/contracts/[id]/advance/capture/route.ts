import { z } from 'zod';
import { db } from '@/lib/db/client';
import { handle, parseBody, type IdContext } from '@/lib/http';
import { captureAdvance } from '@/lib/services/contracts';

const Body = z.object({ orderId: z.string().min(1), mockResponse: z.string().optional() });

export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  const { orderId, mockResponse } = await parseBody(request, Body);
  const contract = await captureAdvance(await db(), id, orderId, mockResponse);
  return Response.json({ state: contract.state, escrowRemainingCents: contract.escrowRemainingCents, captureId: contract.advanceCaptureId });
});
