import { authorizeUrl } from '@/lib/paypal-identity';

// Starts Log in with PayPal and returns to `next` afterwards.
export function GET(request: Request) {
  const url = new URL(request.url);
  return Response.redirect(authorizeUrl(url.origin, url.searchParams.get('next') ?? '/opportunities'), 302);
}
