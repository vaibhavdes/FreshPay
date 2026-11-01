import { runReviewAgent } from '@/lib/agents/review-agent';
import { db } from '@/lib/db/client';
import { handle, type IdContext } from '@/lib/http';
import { withinAiBudget } from '@/lib/rate-limit';

export const POST = handle<IdContext>(async (_request, { params }) => {
  const { id } = await params;
  if (!withinAiBudget('review')) return Response.json({ error: 'The AI budget for today is used up. Try again tomorrow.' }, { status: 429 });
  const review = await runReviewAgent(await db(), id);
  if (!review) return Response.json({ error: 'The AI review agent could not answer just now, so the claim waits for the field officer.' }, { status: 503 });
  return Response.json(review);
});
