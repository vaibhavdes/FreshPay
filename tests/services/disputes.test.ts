import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { contracts, ledgerReceipts } from '@/lib/db/schema';
import { prepareResponse, sendEvidence, syncDispute } from '@/lib/services/disputes';
import { freshDb, NOW, seed, stubPayPal } from '../helpers';

const dispute = {
  dispute_id: 'PP-D-1',
  reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
  status: 'WAITING_FOR_SELLER_RESPONSE',
  dispute_amount: { currency_code: 'USD', value: '7647.00' },
  seller_response_due_date: '2026-11-20T00:00:00Z',
  disputed_transactions: [{ seller_transaction_id: 'CAPTURE-ADVANCE' }],
};

let db: Db;

beforeEach(async () => {
  db = await freshDb();
  await seed(db);
  await db.update(contracts).set({ state: 'ACTIVE', advanceCaptureId: 'CAPTURE-ADVANCE' }).where(eq(contracts.id, 'contract-1'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('disputes', () => {
  it('matches a dispute to its contract through the disputed capture', async () => {
    stubPayPal(() => Response.json(dispute));
    expect(await syncDispute(db, 'PP-D-1', NOW)).toMatchObject({ contractId: 'contract-1', amountCents: 764_700, status: 'WAITING_FOR_SELLER_RESPONSE' });
  });

  it('drafts a response from the ledger, and sends it as evidence after a person approves', async () => {
    const calls = stubPayPal((call) => (call.method === 'GET' ? Response.json(dispute) : Response.json({ links: [] })));
    await syncDispute(db, 'PP-D-1', NOW);

    const { dispute: drafted, pack } = await prepareResponse(db, 'PP-D-1');
    expect(drafted.narrativeModel).toBe('template');
    expect(drafted.narrative).toContain('CAPTURE-ADVANCE');
    expect(pack.ledger.intact).toBe(true);

    const sent = await sendEvidence(db, 'PP-D-1', undefined, NOW);
    expect(sent.evidenceSentAt).toBe(NOW);
    const evidenceCall = calls.find((c) => c.url.endsWith('/provide-evidence'))!;
    const input = JSON.parse(await ((evidenceCall.body as FormData).get('input') as Blob).text());
    expect(input.evidences[0]).toMatchObject({ evidence_type: 'OTHER', notes: drafted.narrative });
    expect((await db.select().from(ledgerReceipts)).map((r) => r.payload.kind)).toEqual(['DISPUTE_EVIDENCE_SENT']);
  });

  it('refuses to send before a response is drafted', async () => {
    stubPayPal(() => Response.json(dispute));
    await syncDispute(db, 'PP-D-1', NOW);
    await expect(sendEvidence(db, 'PP-D-1')).rejects.toThrow('Prepare the response');
  });
});
