import { db } from '@/lib/db/client';
import { handle, parseBody } from '@/lib/http';
import { PostOpportunity, postOpportunity } from '@/lib/services/opportunities';

export const POST = handle(async (request: Request) => {
  const input = await parseBody(request, PostOpportunity);
  // Posted companies fund their season from the sandbox buyer account, like the shared season.
  const buyerEmail = process.env.SANDBOX_BUYER_EMAIL || 'buyer@farmproof.test';
  return Response.json(await postOpportunity(await db(), input, buyerEmail), { status: 201 });
});
