import { db } from '@/lib/db/client';
import { handle, type IdContext } from '@/lib/http';
import { createPremiumOrder } from '@/lib/services/premium';

export const POST = handle<IdContext>(async (_request, { params }) => {
  const { id } = await params;
  return Response.json({ orderId: await createPremiumOrder(await db(), id) });
});
