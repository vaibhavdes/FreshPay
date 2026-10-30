import { cronAuthorized } from '@/lib/cron';
import { db } from '@/lib/db/client';
import { sweepAuthorizations } from '@/lib/services/authorizations';

// Daily: reauthorize delivery balances whose 3-day honour period has ended.
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response('Not found', { status: 404 });
  return Response.json(await sweepAuthorizations(await db()));
}
