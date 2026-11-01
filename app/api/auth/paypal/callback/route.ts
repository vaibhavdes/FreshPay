import { publicOrigin, redirectTo } from '@/lib/http';
import { identityCookie, identityFromCode, readState } from '@/lib/paypal-identity';

// PayPal sends the farmer back here with a one-time code; we keep who they are in a signed
// cookie for an hour, long enough to join an opportunity.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = readState(url.searchParams.get('state'));
  const code = url.searchParams.get('code');
  if (!state) return new Response('This sign-in link is not valid. Start again.', { status: 400 });
  const back = (outcome?: string) => `${state.next}${outcome ? `${state.next.includes('?') ? '&' : '?'}paypal=${outcome}` : ''}`;
  if (!code) return redirectTo(back('cancelled'), 302);
  const origin = publicOrigin(request);

  try {
    const identity = await identityFromCode(code, origin);
    return redirectTo(back(), 302, { 'Set-Cookie': identityCookie(identity, origin.startsWith('https:')) });
  } catch (error) {
    console.error('Log in with PayPal failed', error instanceof Error ? error.message : error);
    return redirectTo(back('failed'), 302);
  }
}
