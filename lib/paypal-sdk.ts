import { Client, Environment, OrdersController, PaymentsController } from '@paypal/paypal-server-sdk';
import { env } from './env';

let controllers: { orders: OrdersController; payments: PaymentsController } | undefined;

export function paypalSdk() {
  if (!controllers) {
    const { PAYPAL_CLIENT_ID, PAYPAL_SECRET } = env();
    const client = new Client({
      clientCredentialsAuthCredentials: { oAuthClientId: PAYPAL_CLIENT_ID, oAuthClientSecret: PAYPAL_SECRET },
      environment: Environment.Sandbox,
      timeout: 15_000,
    });
    controllers = { orders: new OrdersController(client), payments: new PaymentsController(client) };
  }
  return controllers;
}

export const centsToValue = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

export const usd = (cents: number) => ({ currencyCode: 'USD', value: centsToValue(cents) });

// PayPal amounts are decimal strings; parse them as text so no float ever touches money.
export function valueToCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new RangeError(`Not a PayPal amount: ${value}`);
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}
