import { NextResponse, type NextRequest } from 'next/server';
import { needsPass, PASS_COOKIE, passToken } from './lib/demo-pass';

export async function proxy(request: NextRequest) {
  const passcode = process.env.DEMO_PASSCODE;
  if (!passcode || !needsPass(request.method, request.nextUrl.pathname)) return NextResponse.next();
  if (request.cookies.get(PASS_COOKIE)?.value === (await passToken(passcode))) return NextResponse.next();
  return NextResponse.json({ error: 'This action needs the demo passcode. Enter it at /unlock.' }, { status: 401 });
}

export const config = { matcher: '/api/:path*' };
