import { timingSafeEqual } from 'node:crypto';
import { PASS_COOKIE, passToken } from '@/lib/demo-pass';
import { allow } from '@/lib/rate-limit';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(request: Request) {
  const passcode = process.env.DEMO_PASSCODE;
  const form = await request.formData();
  const entered = String(form.get('passcode') ?? '');
  const back = String(form.get('next') ?? '/');
  const next = back.startsWith('/') && !back.startsWith('//') ? back : '/';

  if (!allow('unlock', 30, 60 * 60_000) || !passcode || !same(entered, passcode)) {
    return Response.redirect(new URL(`/unlock?wrong=1&next=${encodeURIComponent(next)}`, request.url), 303);
  }
  const headers = new Headers({ Location: next });
  headers.append('Set-Cookie', `${PASS_COOKIE}=${await passToken(passcode)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${60 * 60 * 24 * 14}`);
  return new Response(null, { status: 303, headers });
}
