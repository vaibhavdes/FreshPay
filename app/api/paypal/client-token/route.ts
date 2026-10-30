import { handle } from '@/lib/http';
import { browserSafeClientToken } from '@/lib/paypal';

export const GET = handle(async (request) => {
  const clientToken = await browserSafeClientToken(new URL(request.url).hostname);
  return Response.json({ clientToken }, { headers: { 'Cache-Control': 'no-store' } });
});
