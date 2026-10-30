import { z } from 'zod';
import { db } from '@/lib/db/client';
import { handle, parseBody, type IdContext } from '@/lib/http';
import { capturePremiumOrder } from '@/lib/services/premium';

const Body = z.object({ orderId: z.string().min(1) });

export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  const { orderId } = await parseBody(request, Body);
  return Response.json(await capturePremiumOrder(await db(), id, orderId));
});
