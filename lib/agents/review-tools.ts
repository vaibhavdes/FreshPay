import { and, desc, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { challenges, evidence, farmers, milestones, payoutItems, plots } from '../db/schema';
import { distanceToRingMeters, pointInRing } from '../engine/geo';
import { notFound } from '../services/errors';

// Read-only facts the review agent can ask for. Each returns plain JSON the model reasons over;
// none of them can change data or move money.

type OracleRecord = {
  reading?: { challengeCodeRead: string | null; cropStage: string; confidence: number; notes: string; transcript: string; claimedMilestone: string | null };
  source?: { kind: string; model: string };
  verdict?: { codeMatch: boolean; stageFits: boolean; confidence: number };
};

export async function heldClaim(db: Db, milestoneId: string) {
  const [row] = await db
    .select({ milestone: milestones, plot: plots, farmer: farmers.name })
    .from(milestones)
    .innerJoin(plots, eq(milestones.plotId, plots.id))
    .innerJoin(farmers, eq(plots.farmerId, farmers.id))
    .where(eq(milestones.id, milestoneId));
  if (!row) throw notFound(`Milestone ${milestoneId}`);
  return row;
}

export async function getEvidence(db: Db, milestoneId: string) {
  const { milestone, plot, farmer } = await heldClaim(db, milestoneId);
  const items = await db.select().from(evidence).where(eq(evidence.milestoneId, milestoneId)).orderBy(desc(evidence.createdAt));
  const photo = items.find((e) => e.kind === 'PHOTO');
  const [challenge] = photo?.challengeId ? await db.select().from(challenges).where(eq(challenges.id, photo.challengeId)) : [];
  const oracle = (photo?.oracle ?? null) as OracleRecord | null;
  const gps = photo?.gps ?? null;

  return {
    farmer,
    plot: plot.name,
    milestone: milestone.type,
    amountCents: milestone.trancheCents,
    heldBecause: (milestone.decision as { reasons?: string[] } | null)?.reasons ?? [],
    photoSha256: photo?.sha256 ?? null,
    hasVoiceNote: items.some((e) => e.kind === 'VOICE'),
    issuedCode: challenge?.code ?? null,
    minutesFromCodeToPhoto: challenge && photo ? Math.round((photo.createdAt - challenge.issuedAt) / 60_000) : null,
    location: gps
      ? { insidePlot: pointInRing(gps, plot.ring), metresFromBoundary: Math.round(distanceToRingMeters(gps, plot.ring)) }
      : null,
    aiReading: oracle?.reading
      ? {
          codeRead: oracle.reading.challengeCodeRead,
          codeMatches: oracle.verdict?.codeMatch ?? null,
          cropStage: oracle.reading.cropStage,
          stageFitsMilestone: oracle.verdict?.stageFits ?? null,
          confidence: oracle.reading.confidence,
          notes: oracle.reading.notes,
          transcript: oracle.reading.transcript,
          model: oracle.source?.model ?? null,
        }
      : null,
  };
}

export async function plotHistory(db: Db, milestoneId: string) {
  const { milestone, plot } = await heldClaim(db, milestoneId);
  const plotMilestones = await db.select().from(milestones).where(eq(milestones.plotId, plot.id));
  const paid = await db.select({ cents: payoutItems.cents, status: payoutItems.status }).from(payoutItems).where(eq(payoutItems.payeeId, plot.farmerId));
  return {
    plot: plot.name,
    areaHa: plot.areaHa,
    milestones: plotMilestones
      .filter((m) => m.id !== milestone.id)
      .map((m) => ({ milestone: m.type, state: m.state, lastDecision: (m.decision as { reasons?: string[] } | null)?.reasons ?? [] })),
    farmerPayouts: paid,
  };
}

export async function findReusedPhoto(db: Db, milestoneId: string) {
  const [photo] = await db
    .select()
    .from(evidence)
    .where(and(eq(evidence.milestoneId, milestoneId), eq(evidence.kind, 'PHOTO')))
    .orderBy(desc(evidence.createdAt))
    .limit(1);
  if (!photo) return { photoSha256: null, usedElsewhere: [] };

  const elsewhere = await db
    .select({ milestoneId: evidence.milestoneId, plot: plots.name, submittedAt: evidence.createdAt })
    .from(evidence)
    .innerJoin(milestones, eq(evidence.milestoneId, milestones.id))
    .innerJoin(plots, eq(milestones.plotId, plots.id))
    .where(and(eq(evidence.sha256, photo.sha256), ne(evidence.milestoneId, milestoneId)));
  return {
    photoSha256: photo.sha256,
    usedElsewhere: elsewhere.map((e) => ({ plot: e.plot, milestoneId: e.milestoneId, submittedAt: new Date(e.submittedAt).toISOString() })),
  };
}

export async function satelliteCheck(db: Db, milestoneId: string) {
  const { plot } = await heldClaim(db, milestoneId);
  const check = plot.eudrCheck as { lossSince2021Ha?: number; source?: string; fetchedAt?: string } | null;
  return {
    plot: plot.name,
    eudrStatus: plot.eudrStatus,
    treeCoverLostSince2021Ha: check?.lossSince2021Ha ?? null,
    cutoff: '2020-12-31',
    source: check?.source ?? null,
    checkedAt: check?.fetchedAt ?? null,
  };
}
