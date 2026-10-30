import { env } from './env';
import { paypalRequest } from './paypal';

export type PayPalWebhookEvent = {
  id: string;
  event_type: string;
  resource_type?: string;
  resource: Record<string, unknown>;
};

const HEADERS = {
  auth_algo: 'paypal-auth-algo',
  cert_url: 'paypal-cert-url',
  transmission_id: 'paypal-transmission-id',
  transmission_sig: 'paypal-transmission-sig',
  transmission_time: 'paypal-transmission-time',
} as const;

// Cheap pre-check before asking PayPal: the signing certificate must come from a PayPal host.
export function certUrlAllowed(certUrl: string): boolean {
  try {
    const url = new URL(certUrl);
    return url.protocol === 'https:' && (url.hostname === 'paypal.com' || url.hostname.endsWith('.paypal.com'));
  } catch {
    return false;
  }
}

export async function verifyWebhook(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = env().PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error('PAYPAL_WEBHOOK_ID is not set');

  const fields = Object.fromEntries(Object.entries(HEADERS).map(([field, header]) => [field, headers.get(header)]));
  if (Object.values(fields).some((value) => !value) || !certUrlAllowed(fields.cert_url!)) return false;

  // The event goes back exactly as received; re-serialising it can change the signed bytes.
  const body = `{${Object.entries({ ...fields, webhook_id: webhookId })
    .map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
    .join(',')},"webhook_event":${rawBody}}`;

  const { verification_status } = await paypalRequest<{ verification_status: string }>('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body,
  });
  return verification_status === 'SUCCESS';
}
