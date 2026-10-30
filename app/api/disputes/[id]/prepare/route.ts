import { db } from '@/lib/db/client';
import { handle, type IdContext } from '@/lib/http';
import { withinAiBudget } from '@/lib/rate-limit';
import { prepareResponse } from '@/lib/services/disputes';

export const POST = handle<IdContext>(async (_request, { params }) => {
  const { id } = await params;
  if (!withinAiBudget('dispute')) return Response.json({ error: 'The AI budget for today is used up. Try again tomorrow.' }, { status: 429 });
  return Response.json(await prepareResponse(await db(), id));
});
