import { runReviewAgent } from '@/lib/agents/review-agent';
import { db } from '@/lib/db/client';
import { handle, type IdContext } from '@/lib/http';

export const POST = handle<IdContext>(async (_request, { params }) => {
  const { id } = await params;
  const review = await runReviewAgent(await db(), id);
  if (!review) return Response.json({ error: 'No AI model is configured, so the claim waits for a person.' }, { status: 503 });
  return Response.json(review);
});
