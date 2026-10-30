import { db } from '@/lib/db/client';
import { handle, type IdContext } from '@/lib/http';
import { createAdvanceOrder } from '@/lib/services/contracts';

export const POST = handle<IdContext>(async (_request, { params }) => {
  const { id } = await params;
  return Response.json({ orderId: await createAdvanceOrder(await db(), id) });
});
