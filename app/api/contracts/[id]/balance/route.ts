import { db } from '@/lib/db/client';
import { handle, type IdContext } from '@/lib/http';
import { createBalanceOrder } from '@/lib/services/delivery';

export const POST = handle<IdContext>(async (_request, { params }) => {
  const { id } = await params;
  return Response.json({ orderId: await createBalanceOrder(await db(), id) });
});
