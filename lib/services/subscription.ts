import { ApplicationContextUserAction, ExperienceContextShippingPreference } from '@paypal/paypal-server-sdk';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { buyers } from '../db/schema';
import { env } from '../env';
import { publish } from '../events';
import { paypalSdk } from '../paypal-sdk';
import { conflict, notFound } from './errors';
import { appendLedger } from './ledger';

// Our own pricing for one buyer's compliance workspace; premiums still go straight to farmers.
export const WORKSPACE_PRICE_CENTS = 14_900;

// The buyer subscribes on PayPal and comes back to returnUrl; webhooks keep the status current.
export async function startSubscription(db: Db, buyerId: string, returnUrl: string, cancelUrl: string) {
  const planId = env().PAYPAL_WORKSPACE_PLAN_ID;
  if (!planId) throw conflict('No workspace plan is configured; run npm run paypal:plan first');
  const [buyer] = await db.select().from(buyers).where(eq(buyers.id, buyerId));
  if (!buyer) throw notFound(`Buyer ${buyerId}`);

  const { result } = await paypalSdk().subscriptions.createSubscription({
    paypalRequestId: `agritranche-subscription-${buyerId}-${Date.now()}`,
    body: {
      planId,
      customId: buyerId,
      applicationContext: {
        brandName: 'AgriTranche',
        userAction: ApplicationContextUserAction.SubscribeNow,
        shippingPreference: ExperienceContextShippingPreference.NoShipping,
        returnUrl,
        cancelUrl,
      },
    },
  });
  const approve = result.links?.find((l) => l.rel === 'approve')?.href;
  if (!result.id || !approve) throw new Error('PayPal returned no approval link for the subscription');
  await db.update(buyers).set({ subscriptionId: result.id, subscriptionStatus: result.status ?? 'APPROVAL_PENDING' }).where(eq(buyers.id, buyerId));
  return { approveUrl: approve };
}

export async function syncSubscription(db: Db, subscriptionId: string, now = Date.now()) {
  const { result } = await paypalSdk().subscriptions.getSubscription({ id: subscriptionId });
  const [buyer] = await db.select().from(buyers).where(eq(buyers.subscriptionId, subscriptionId));
  if (!buyer || !result.status) return null;

  const [updated] = await db.update(buyers).set({ subscriptionStatus: result.status }).where(eq(buyers.id, buyer.id)).returning();
  if (result.status === 'ACTIVE' && buyer.subscriptionStatus !== 'ACTIVE') {
    await appendLedger(db, { kind: 'WORKSPACE_SUBSCRIBED', buyerId: buyer.id, subscriptionId }, now);
  }
  publish({ type: 'subscription', buyerId: buyer.id, status: result.status });
  return updated;
}
