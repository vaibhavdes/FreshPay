import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { buyers, ledgerReceipts } from '@/lib/db/schema';
import { freshDb, NOW, seed } from '../helpers';

const sdk = vi.hoisted(() => ({ createSubscription: vi.fn(), getSubscription: vi.fn() }));

vi.mock('@/lib/paypal-sdk', async (original) => ({
  ...(await original<typeof import('@/lib/paypal-sdk')>()),
  paypalSdk: () => ({ orders: {}, payments: {}, subscriptions: sdk }),
}));

const { startSubscription, syncSubscription } = await import('@/lib/services/subscription');

let db: Db;

beforeEach(async () => {
  vi.clearAllMocks();
  db = await freshDb();
  await seed(db);
  sdk.createSubscription.mockResolvedValue({ result: { id: 'I-SUB-1', status: 'APPROVAL_PENDING', links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-1' }] } });
});

describe('workspace subscription', () => {
  it('starts a subscription on the workspace plan and records it as pending', async () => {
    const { approveUrl } = await startSubscription(db, 'buyer-1', 'https://app/return', 'https://app/cancel');
    expect(approveUrl).toContain('ba_token=BA-1');
    expect(sdk.createSubscription.mock.calls[0][0].body).toMatchObject({ planId: 'P-TEST-PLAN', customId: 'buyer-1', applicationContext: { userAction: 'SUBSCRIBE_NOW', returnUrl: 'https://app/return' } });
    expect((await db.select().from(buyers))[0]).toMatchObject({ subscriptionId: 'I-SUB-1', subscriptionStatus: 'APPROVAL_PENDING' });
  });

  it('marks the plan active once PayPal reports it, and records it once', async () => {
    await startSubscription(db, 'buyer-1', 'https://app/return', 'https://app/cancel');
    sdk.getSubscription.mockResolvedValue({ result: { id: 'I-SUB-1', status: 'ACTIVE' } });

    expect(await syncSubscription(db, 'I-SUB-1', NOW)).toMatchObject({ subscriptionStatus: 'ACTIVE' });
    await syncSubscription(db, 'I-SUB-1', NOW);
    expect((await db.select().from(ledgerReceipts)).map((r) => r.payload.kind)).toEqual(['WORKSPACE_SUBSCRIBED']);
  });

  it('ignores a subscription that is not ours', async () => {
    sdk.getSubscription.mockResolvedValue({ result: { id: 'I-OTHER', status: 'ACTIVE' } });
    expect(await syncSubscription(db, 'I-OTHER', NOW)).toBeNull();
  });
});
