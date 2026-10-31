import { eq, or } from 'drizzle-orm';
import { evidencePack, writeNarrative } from '../agents/dispute-agent';
import type { Db } from '../db/client';
import { contracts, disputes, paypalOps } from '../db/schema';
import { paypalRequest } from '../paypal';
import { valueToCents } from '../paypal-sdk';
import { conflict, notFound } from './errors';
import { evidenceFile } from './evidence-files';
import { appendLedger } from './ledger';

type PayPalDispute = {
  dispute_id: string;
  reason: string;
  status: string;
  dispute_amount: { value: string };
  seller_response_due_date?: string;
  disputed_transactions?: { seller_transaction_id?: string }[];
};

// PayPal accepts these image types as dispute evidence.
const DISPUTE_FILE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };
const MAX_ATTACHED_PHOTOS = 4;

// A disputed capture belongs to a contract: its advance, its balance, or one of its premium orders.
async function contractForTransaction(db: Db, transactionId: string | undefined): Promise<string | null> {
  if (!transactionId) return null;
  const [direct] = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(or(eq(contracts.advanceCaptureId, transactionId), eq(contracts.balanceCaptureId, transactionId)));
  if (direct) return direct.id;
  const [op] = await db.select({ key: paypalOps.key }).from(paypalOps).where(eq(paypalOps.paypalId, transactionId));
  return op ? op.key.split('/')[0] : null;
}

export async function syncDispute(db: Db, disputeId: string, now = Date.now()) {
  const d = await paypalRequest<PayPalDispute>(`/v1/customer/disputes/${encodeURIComponent(disputeId)}`);
  const transactionId = d.disputed_transactions?.[0]?.seller_transaction_id;
  const values = {
    contractId: await contractForTransaction(db, transactionId),
    transactionId: transactionId ?? null,
    reason: d.reason,
    status: d.status,
    amountCents: valueToCents(d.dispute_amount.value),
    responseDueAt: d.seller_response_due_date ?? null,
    updatedAt: now,
  };
  const [row] = await db
    .insert(disputes)
    .values({ id: d.dispute_id, ...values })
    .onConflictDoUpdate({ target: disputes.id, set: values })
    .returning();
  return row;
}

export async function syncDisputes(db: Db, now = Date.now()) {
  const { items = [] } = await paypalRequest<{ items?: { dispute_id: string }[] }>('/v1/customer/disputes?page_size=50');
  return Promise.all(items.map((item) => syncDispute(db, item.dispute_id, now)));
}

async function getDispute(db: Db, disputeId: string) {
  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, disputeId));
  if (!dispute) throw notFound(`Dispute ${disputeId}`);
  if (!dispute.contractId) throw conflict(`Dispute ${disputeId} is not about a FarmProof contract`);
  return { ...dispute, contractId: dispute.contractId };
}

// The dispute agent drafts the response from the evidence pack; a person reads it before sending.
export async function prepareResponse(db: Db, disputeId: string) {
  const dispute = await getDispute(db, disputeId);
  const pack = await evidencePack(db, dispute.contractId);
  const { narrative, model } = await writeNarrative(dispute.reason, pack);
  const [row] = await db.update(disputes).set({ narrative, narrativeModel: model }).where(eq(disputes.id, disputeId)).returning();
  return { dispute: row, pack };
}

async function photoFile(db: Db, sha256: string) {
  const file = await evidenceFile(db, sha256);
  const ext = file && DISPUTE_FILE_TYPES[file.type];
  return file && ext ? { name: `${sha256}.${ext}`, ...file } : null;
}

export async function sendEvidence(db: Db, disputeId: string, edited?: string, now = Date.now()) {
  if (edited) await db.update(disputes).set({ narrative: edited }).where(eq(disputes.id, disputeId));
  const dispute = await getDispute(db, disputeId);
  if (!dispute.narrative) throw conflict('Prepare the response before sending it');
  const pack = await evidencePack(db, dispute.contractId);
  const delivery = pack.contract.delivery;

  const input = {
    evidences: [
      delivery?.trackingNumber
        ? {
            evidence_type: 'PROOF_OF_FULFILLMENT',
            evidence_info: { tracking_info: [{ carrier_name: 'OTHER', carrier_name_other: delivery.carrier, tracking_number: delivery.trackingNumber }] },
            notes: dispute.narrative,
          }
        : { evidence_type: 'OTHER', notes: dispute.narrative },
    ],
  };
  const form = new FormData();
  form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
  for (const sha of pack.photos.slice(0, MAX_ATTACHED_PHOTOS)) {
    const file = await photoFile(db, sha);
    if (file) form.append('evidence-file', new Blob([file.bytes], { type: file.type }), file.name);
  }

  await paypalRequest(`/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`, { method: 'POST', body: form });
  const [row] = await db.update(disputes).set({ evidenceSentAt: now }).where(eq(disputes.id, disputeId)).returning();
  await appendLedger(db, { kind: 'DISPUTE_EVIDENCE_SENT', disputeId, contractId: dispute.contractId, photos: pack.photos.length }, now);
  return row;
}
