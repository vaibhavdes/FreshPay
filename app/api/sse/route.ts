import { db } from '@/lib/db/client';
import { subscribe } from '@/lib/events';
import { recoverWhileActive } from '@/lib/services/recovery';

const HEARTBEAT_MS = 15_000;

const recover = () => db().then((database) => recoverWhileActive(database), () => undefined);

export function GET(request: Request) {
  const encoder = new TextEncoder();
  let stop = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      const unsubscribe = subscribe((event) => send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      const heartbeat = setInterval(() => {
        send(': keep-alive\n\n');
        recover();
      }, HEARTBEAT_MS);

      stop = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      request.signal.addEventListener('abort', () => {
        stop();
        controller.close();
      });
      send('retry: 3000\n\n');
      recover();
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
