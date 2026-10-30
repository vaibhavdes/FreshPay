import { db } from '@/lib/db/client';
import { handleWebhookEvent } from '@/lib/services/webhooks';
import { verifyWebhook, type PayPalWebhookEvent } from '@/lib/webhooks';

export async function POST(request: Request) {
  const rawBody = await request.text();

  let verified: boolean;
  try {
    verified = await verifyWebhook(request.headers, rawBody);
  } catch (error) {
    // Not a verdict on the event: answer 503 so PayPal redelivers it later.
    console.error('Webhook verification unavailable', error);
    return Response.json({ error: 'Verification unavailable' }, { status: 503 });
  }
  if (!verified) return Response.json({ error: 'Invalid signature' }, { status: 400 });

  const event = JSON.parse(rawBody) as PayPalWebhookEvent;
  const { duplicate } = await handleWebhookEvent(await db(), event);
  return Response.json({ received: event.id, duplicate });
}
