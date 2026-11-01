import { z } from 'zod';
import { db } from '@/lib/db/client';
import { handle, parseBody, publicOrigin, type IdContext } from '@/lib/http';
import { startSubscription } from '@/lib/services/subscription';

const Body = z.object({ returnTo: z.string().startsWith('/') });

export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  const { returnTo } = await parseBody(request, Body);
  const origin = publicOrigin(request);
  const back = `${origin}/api/subscription/return?next=${encodeURIComponent(returnTo)}`;
  return Response.json(await startSubscription(await db(), id, back, `${origin}${returnTo}`));
});
