import { db } from '@/lib/db/client';
import { env } from '@/lib/env';
import { runReconciliation } from '@/lib/services/reconciliation';

// Called on a schedule by the Render cron job with the shared secret.
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Not found', { status: 404 });
  const run = await runReconciliation(await db());
  return Response.json({ id: run.id, result: run.result });
}
