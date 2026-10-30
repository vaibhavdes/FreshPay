import { db } from '@/lib/db/client';
import { handle, type IdContext } from '@/lib/http';
import { prepareResponse } from '@/lib/services/disputes';

export const POST = handle<IdContext>(async (_request, { params }) => {
  const { id } = await params;
  return Response.json(await prepareResponse(await db(), id));
});
