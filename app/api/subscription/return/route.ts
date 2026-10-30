import { db } from '@/lib/db/client';
import { handle } from '@/lib/http';
import { syncSubscription } from '@/lib/services/subscription';

// PayPal sends the buyer back here with subscription_id after approving the plan.
export const GET = handle(async (request) => {
  const url = new URL(request.url);
  const subscriptionId = url.searchParams.get('subscription_id');
  if (subscriptionId) await syncSubscription(await db(), subscriptionId);
  const next = url.searchParams.get('next') ?? '/';
  return Response.redirect(new URL(next.startsWith('/') ? next : '/', request.url), 303);
});
