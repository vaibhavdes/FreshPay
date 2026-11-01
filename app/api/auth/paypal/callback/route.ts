import { identityCookie, identityFromCode, readState } from '@/lib/paypal-identity';

// PayPal sends the farmer back here with a one-time code; we keep who they are in a signed
// cookie for an hour, long enough to join an opportunity.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = readState(url.searchParams.get('state'));
  const code = url.searchParams.get('code');
  if (!state) return new Response('This sign-in link is not valid. Start again.', { status: 400 });
  const back = new URL(state.next, url.origin);
  if (!code) {
    back.searchParams.set('paypal', 'cancelled');
    return Response.redirect(back, 302);
  }

  try {
    const identity = await identityFromCode(code, url.origin);
    const headers = new Headers({ Location: back.toString(), 'Set-Cookie': identityCookie(identity, url.protocol === 'https:') });
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error('Log in with PayPal failed', error instanceof Error ? error.message : error);
    back.searchParams.set('paypal', 'failed');
    return Response.redirect(back, 302);
  }
}
