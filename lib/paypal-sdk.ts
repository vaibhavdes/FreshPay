import { Client, Environment, OrdersController, PaymentsController, SubscriptionsController } from '@paypal/paypal-server-sdk';
import { env } from './env';

let controllers: { orders: OrdersController; payments: PaymentsController; subscriptions: SubscriptionsController } | undefined;

export function paypalSdk() {
  if (!controllers) {
    const { PAYPAL_CLIENT_ID, PAYPAL_SECRET } = env();
    const client = new Client({
      clientCredentialsAuthCredentials: { oAuthClientId: PAYPAL_CLIENT_ID, oAuthClientSecret: PAYPAL_SECRET },
      environment: Environment.Sandbox,
      timeout: 15_000,
    });
    controllers = { orders: new OrdersController(client), payments: new PaymentsController(client), subscriptions: new SubscriptionsController(client) };
  }
  return controllers;
}

// The SDK keeps its OAuth token between calls, including a failed token request, which would fail
// every later call at once. After a network failure the next call starts with a fresh client.
export function resetPayPalSdk() {
  controllers = undefined;
}

export const centsToValue = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

export const usd = (cents: number) => ({ currencyCode: 'USD', value: centsToValue(cents) });

// PayPal amounts are decimal strings; parse them as text so no float ever touches money.
export function valueToCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new RangeError(`Not a PayPal amount: ${value}`);
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}
