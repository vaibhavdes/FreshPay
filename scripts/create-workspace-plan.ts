import { IntervalUnit, TenureType } from '@paypal/paypal-server-sdk';
import { env } from '@/lib/env';
import { paypalRequest } from '@/lib/paypal';
import { paypalSdk, usd } from '@/lib/paypal-sdk';
import { WORKSPACE_PRICE_CENTS } from '@/lib/services/subscription';

// Creates the catalog product and monthly billing plan for the buyer's compliance workspace once.
async function main() {
  env();
  const product = await paypalRequest<{ id: string }>('/v1/catalogs/products', {
    method: 'POST',
    requestId: 'agritranche-workspace-product',
    body: { name: 'AgriTranche compliance workspace', description: 'EUDR evidence, payments and records for coffee buyers', type: 'SERVICE', category: 'SOFTWARE' },
  });

  const { result: plan } = await paypalSdk().subscriptions.createBillingPlan({
    paypalRequestId: 'agritranche-workspace-plan',
    body: {
      productId: product.id,
      name: 'Compliance workspace, monthly',
      description: 'One buyer workspace: contracts, evidence, EUDR records and agents',
      billingCycles: [{ frequency: { intervalUnit: IntervalUnit.Month, intervalCount: 1 }, tenureType: TenureType.Regular, sequence: 1, totalCycles: 0, pricingScheme: { fixedPrice: usd(WORKSPACE_PRICE_CENTS) } }],
      paymentPreferences: { autoBillOutstanding: true, paymentFailureThreshold: 2 },
    },
  });
  console.log(`Product ${product.id}\nAdd to .env.local:\nPAYPAL_WORKSPACE_PLAN_ID=${plan.id}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
