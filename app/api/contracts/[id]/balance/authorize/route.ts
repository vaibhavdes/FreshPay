import { z } from 'zod';
import { db } from '@/lib/db/client';
import { handle, parseBody, type IdContext } from '@/lib/http';
import { authorizeBalance } from '@/lib/services/delivery';

const Body = z.object({ orderId: z.string().min(1) });

export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  const { orderId } = await parseBody(request, Body);
  const contract = await authorizeBalance(await db(), id, orderId);
  return Response.json({ state: contract.state, authorizationId: contract.balanceAuthorizationId, authorizedCents: contract.balanceAuthorizedCents });
});
