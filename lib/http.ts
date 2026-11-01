import { z } from 'zod';
import { HttpError } from './services/errors';
import { PayPalOpFailed } from './services/ops';

export type IdContext = { params: Promise<{ id: string }> };

// Maps domain errors to responses; PayPal failures keep their route and debug_id for the UI.
export function handle<C>(handler: (request: Request, context: C) => Promise<Response>) {
  return async (request: Request, context: C): Promise<Response> => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof z.ZodError) return Response.json({ error: 'Invalid request', issues: z.treeifyError(error) }, { status: 400 });
      if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
      if (error instanceof PayPalOpFailed) {
        const status = error.routed.route === 'SHOW_THE_CUSTOMER' ? 402 : error.routed.route === 'RETRY_WITH_BACKOFF' ? 503 : 502;
        return Response.json({ error: error.message, ...error.routed }, { status });
      }
      throw error;
    }
  };
}

export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  return schema.parse(await request.json().catch(() => ({})));
}

// The address the browser used. Behind Render's proxy the request URL carries the internal
// host (localhost:10000), so PayPal return URLs use APP_URL or the forwarded host instead.
export function publicOrigin(request: Request): string {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

// A redirect within the app, with a relative Location so it never points at the internal host.
export function redirectTo(path: string, status: 302 | 303 | 307, headers?: HeadersInit): Response {
  const all = new Headers(headers);
  all.set('Location', path.startsWith('/') && !path.startsWith('//') ? path : '/');
  return new Response(null, { status, headers: all });
}
