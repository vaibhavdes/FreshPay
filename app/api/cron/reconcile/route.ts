import { cronAuthorized } from '@/lib/cron';
import { db } from '@/lib/db/client';
import { restoreIfIdle } from '@/lib/services/demo-reset';
import { runReconciliation } from '@/lib/services/reconciliation';

// Called on a schedule by the Render cron job with the shared secret.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response('Not found', { status: 404 });
  const database = await db();
  const run = await runReconciliation(database);
  const restored = await restoreIfIdle(database);
  return Response.json({ id: run.id, result: run.result, restored });
}
