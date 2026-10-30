import { cronAuthorized } from '@/lib/cron';
import { db } from '@/lib/db/client';
import { recoverPendingOps } from '@/lib/services/recovery';

// Every few minutes: settle PayPal payments whose webhook never arrived.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response('Not found', { status: 404 });
  return Response.json(await recoverPendingOps(await db()));
}
