import { db } from '@/lib/db/client';
import { redirectTo } from '@/lib/http';
import { allow } from '@/lib/rate-limit';
import { SHARED_SEASON_ID } from '@/lib/services/entry';
import { startVisitorSeason } from '@/lib/services/visitor-season';
import { SEASON_COOKIE } from '@/lib/visitor';

const HOUR = 60 * 60_000;

// Starts a fresh copy of the shared season for this browser and opens the tour on it.
export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!allow(`season:${ip}`, 10, HOUR)) return Response.json({ error: 'Too many new seasons from here. Try again in an hour.' }, { status: 429 });

  const contractId = await startVisitorSeason(await db(), SHARED_SEASON_ID);
  const secure = request.headers.get('x-forwarded-proto') === 'https' || request.url.startsWith('https:');
  return redirectTo('/tour', 303, { 'Set-Cookie': `${SEASON_COOKIE}=${contractId}; Path=/; Max-Age=${30 * 24 * 3600}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}` });
}
