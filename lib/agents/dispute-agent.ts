import { generateText, type LanguageModel } from 'ai';
import { desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { contracts, evidence, farmers, ledgerReceipts, milestones, payoutItems, paypalOps, plots } from '../db/schema';
import { pointInRing } from '../engine/geo';
import { env } from '../env';
import { formatUsd } from '../format';
import { geminiModels } from '../oracles/models';
import { verifyLedger } from '../services/ledger';

// Everything the merchant can prove about a contract, read straight from our own records.
export async function evidencePack(db: Db, contractId: string) {
  const [contract] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  const contractMilestones = await db.select().from(milestones).where(eq(milestones.contractId, contractId));
  const plotIds = [...new Set(contractMilestones.map((m) => m.plotId))];
  const plotRows = plotIds.length ? await db.select({ plot: plots, farmer: farmers.name }).from(plots).innerJoin(farmers, eq(plots.farmerId, farmers.id)).where(inArray(plots.id, plotIds)) : [];
  const released = contractMilestones.filter((m) => m.state === 'RELEASED');
  const items = released.length ? await db.select().from(evidence).where(inArray(evidence.milestoneId, released.map((m) => m.id))) : [];
  const ops = await db.select().from(paypalOps).where(eq(paypalOps.status, 'COMPLETED'));
  const contractOps = ops.filter((o) => o.key.startsWith(`${contractId}/`));
  const paid = contractOps.length ? await db.select().from(payoutItems).where(inArray(payoutItems.opId, contractOps.map((o) => o.id))) : [];
  const ledger = await verifyLedger(db);
  const [head] = await db.select().from(ledgerReceipts).orderBy(desc(ledgerReceipts.seq)).limit(1);

  return {
    contract: {
      id: contract.id,
      season: contract.season,
      state: contract.state,
      advance: formatUsd(contract.advanceCents),
      advanceCaptureId: contract.advanceCaptureId,
      delivery: contract.deliveredKg
        ? { deliveredKg: contract.deliveredKg, acceptedKg: contract.acceptedKg, qualityPercent: contract.qualityPercent, captured: formatUsd(contract.balanceCapturedCents ?? 0), carrier: contract.carrier, trackingNumber: contract.trackingNumber }
        : null,
    },
    plots: plotRows.map(({ plot, farmer }) => ({
      plot: plot.name,
      farmer,
      areaHa: plot.areaHa,
      eudrStatus: plot.eudrStatus,
      treeCoverLostSince2021Ha: (plot.eudrCheck as { lossSince2021Ha?: number } | null)?.lossSince2021Ha ?? null,
    })),
    releasedMilestones: released.map((m) => {
      const photo = items.find((e) => e.milestoneId === m.id && e.kind === 'PHOTO');
      const plot = plotRows.find((p) => p.plot.id === m.plotId)?.plot;
      const reading = (photo?.oracle as { reading?: { challengeCodeRead: string | null; cropStage: string; confidence: number } } | null)?.reading;
      return {
        plot: plot?.name,
        milestone: m.type,
        amount: formatUsd(m.reservedCents || m.trancheCents),
        releasedAt: m.decidedAt ? new Date(m.decidedAt).toISOString() : null,
        photoSha256: photo?.sha256 ?? null,
        phoneInsidePlot: photo?.gps && plot ? pointInRing(photo.gps, plot.ring) : null,
        aiReading: reading ? { codeRead: reading.challengeCodeRead, cropStage: reading.cropStage, confidence: reading.confidence } : null,
      };
    }),
    payouts: paid.map((p) => ({ amount: formatUsd(p.cents), status: p.status })),
    ledger: { intact: ledger.ok, receipts: head ? head.seq + 1 : 0, headHash: head?.hash ?? null },
    photos: items.filter((e) => e.kind === 'PHOTO').map((e) => e.sha256),
  };
}

export type EvidencePack = Awaited<ReturnType<typeof evidencePack>>;

const INSTRUCTIONS = `You write a merchant's response to a PayPal dispute for an agricultural payments platform.
Use only the facts in the evidence pack. Be factual, specific and under 1,800 characters. Refer to amounts,
dates, plots, PayPal capture and tracking ids, and explain that every payment was released only after
verified field evidence and a satellite deforestation check, recorded in a tamper-evident ledger.
Do not invent facts, promises or legal claims.`;

export function templateNarrative(reason: string, pack: EvidencePack): string {
  const released = pack.releasedMilestones.map((m) => `${m.milestone.toLowerCase().replace('_', ' ')} for ${m.plot} (${m.amount})`).join('; ');
  const delivery = pack.contract.delivery
    ? ` The lot was delivered: ${pack.contract.delivery.acceptedKg} of ${pack.contract.delivery.deliveredKg} kg accepted at ${pack.contract.delivery.qualityPercent}% quality, ${pack.contract.delivery.captured} captured, shipped with ${pack.contract.delivery.carrier} under tracking ${pack.contract.delivery.trackingNumber}.`
    : '';
  return [
    `Response to dispute reason ${reason} for contract ${pack.contract.id}, season ${pack.contract.season}.`,
    `The season advance of ${pack.contract.advance} (PayPal capture ${pack.contract.advanceCaptureId}) funded payments that were each released only after verified evidence: ${released || 'none yet'}.`,
    `Every plot was checked against the EU deforestation cut-off of 31 December 2020 using Global Forest Watch data.${delivery}`,
    `All ${pack.ledger.receipts} payment records are hash-chained${pack.ledger.intact ? ' and verified intact' : ''}; the photo evidence is attached.`,
  ].join(' ');
}

export async function writeNarrative(reason: string, pack: EvidencePack, model: LanguageModel | null = geminiModels(env())?.(env().AGENT_MODEL) ?? null) {
  if (!model) return { narrative: templateNarrative(reason, pack), model: 'template' };
  try {
    const { text } = await generateText({
      model,
      system: INSTRUCTIONS,
      prompt: `Dispute reason: ${reason}\n\nEvidence pack:\n${JSON.stringify({ ...pack, photos: `${pack.photos.length} photos attached` }, null, 2)}`,
      abortSignal: AbortSignal.timeout(30_000),
    });
    return { narrative: text.trim().slice(0, 2000), model: env().AGENT_MODEL };
  } catch {
    return { narrative: templateNarrative(reason, pack), model: 'template' };
  }
}
