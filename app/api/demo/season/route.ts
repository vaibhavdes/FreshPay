import { db } from '@/lib/db/client';
import { allow } from '@/lib/rate-limit';
import { EXAMPLE_SEASON_ID } from '@/lib/services/entry';
import { startVisitorSeason } from '@/lib/services/visitor-season';
import { SEASON_COOKIE } from '@/lib/visitor';

const HOUR = 60 * 60_000;

// Starts a fresh copy of the example season for this browser and opens the tour on it.
export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!allow(`season:${ip}`, 10, HOUR)) return Response.json({ error: 'Too many new seasons from here. Try again in an hour.' }, { status: 429 });

  const contractId = await startVisitorSeason(await db(), EXAMPLE_SEASON_ID);
  const response = Response.redirect(new URL('/tour', request.url), 303);
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', `${SEASON_COOKIE}=${contractId}; Path=/; Max-Age=${30 * 24 * 3600}; HttpOnly; SameSite=Lax${request.url.startsWith('https:') ? '; Secure' : ''}`);
  return new Response(null, { status: 303, headers });
}
