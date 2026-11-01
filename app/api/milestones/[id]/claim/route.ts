import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { challenges, milestones, plots } from '@/lib/db/schema';
import { readPhotoMetadata } from '@/lib/engine/exif';
import type { Bill, BillRule, SupplierKind } from '@/lib/engine/gate';
import { centroid } from '@/lib/engine/geo';
import { gpsAccuracySignal, photoLocationSignal, photoTimeSignal, weatherSignal } from '@/lib/engine/proof';
import { satelliteSignal } from '@/lib/engine/satellite';
import { PLOT_MILESTONES } from '@/lib/engine/stateMachine';
import { visionVerdict } from '@/lib/engine/vision';
import { runReviewAgent } from '@/lib/agents/review-agent';
import { chargePremiumsWithVault } from '@/lib/services/premium';
import { handle, type IdContext } from '@/lib/http';
import { OracleUnavailable, readEvidence, type EvidenceReading } from '@/lib/oracles/evidence';
import { rainToday } from '@/lib/oracles/weather';
import { isAuthentic } from '@/lib/services/challenges';
import { HttpError, notFound } from '@/lib/services/errors';
import { saveEvidenceFile } from '@/lib/services/evidence-files';
import { photoHash } from '@/lib/services/photo-hash';
import { refreshInBackground, viewsOf } from '@/lib/services/satellite';
import { submitClaim } from '@/lib/services/milestones';
import { billToUsdCents } from '@/lib/season-terms';
import { withinAiBudget } from '@/lib/rate-limit';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

const Fields = z.object({
  challengeId: z.string().min(1),
  challengeCode: z.string().min(1),
  lng: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  // Absent when a sandbox tester sends from the farm's centre instead of their own position.
  accuracy: z.coerce.number().min(0).optional(),
  milestone: z.enum(PLOT_MILESTONES).optional(),
  // The supplier the farmer picked for each kind of bill on this stage.
  supplier_INPUTS: z.string().min(1).optional(),
  supplier_LABOUR: z.string().min(1).optional(),
  supplier_MACHINERY: z.string().min(1).optional(),
});

async function fileBytes(form: FormData, name: string, kind: 'image' | 'audio', maxBytes: number) {
  const file = form.get(name);
  if (!(file instanceof File) || file.size === 0) return null;
  if (!file.type.startsWith(`${kind}/`)) throw new HttpError(415, `${name} must be an ${kind} file`);
  if (file.size > maxBytes) throw new HttpError(413, `${name} is larger than ${maxBytes / 1024 / 1024} MB`);
  return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type };
}

// Turns what the model read off the bills into amounts code can pay: rupees converted at the
// contract rate, each bill matched to the supplier the farmer picked for its kind. A bill the
// model couldn't classify counts as the stage's only kind when there is just one.
function readBills(read: EvidenceReading['bills'], rule: BillRule | null, fields: Partial<Record<`supplier_${SupplierKind}`, string>>): Bill[] {
  const only = rule?.lines.length === 1 ? rule.lines[0].kind : null;
  return read.flatMap((b) => {
    const kind = b.kind ?? only;
    const cents = billToUsdCents(b);
    return kind && cents ? [{ kind, cents, payeeId: fields[`supplier_${kind}`] ?? null, issuer: b.issuer, number: b.number, date: b.date }] : [];
  });
}

export const POST = handle<IdContext>(async (request, { params }) => {
  const { id } = await params;
  const form = await request.formData();
  const fields = Fields.parse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')));
  const photo = await fileBytes(form, 'photo', 'image', MAX_PHOTO_BYTES);
  const audio = await fileBytes(form, 'audio', 'audio', MAX_AUDIO_BYTES);
  if (!photo) throw new HttpError(400, 'A photo of the challenge code is required');

  const database = await db();
  const [milestone] = await database.select().from(milestones).where(eq(milestones.id, id));
  if (!milestone) throw notFound(`Milestone ${id}`);
  const [plot] = await database.select().from(plots).where(eq(plots.id, milestone.plotId));
  const [challenge] = await database
    .select()
    .from(challenges)
    .where(and(eq(challenges.id, fields.challengeId), eq(challenges.plotId, plot.id)));

  const photoSha = await saveEvidenceFile(database, photo.bytes, photo.type);
  const audioSha = audio ? await saveEvidenceFile(database, audio.bytes, audio.type) : null;

  // Without a reading every other check still runs; a claim that passes them waits for a person.
  const oracle = await readEvidence(database, {
    photo: photo.bytes,
    photoType: photo.type,
    audio: audio?.bytes,
    audioType: audio?.type,
    plotName: plot.name,
    commodity: plot.commodity,
  }).catch((error: unknown) => {
    if (!(error instanceof OracleUnavailable)) throw error;
    console.error(`${error.message}: ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`);
    return null;
  });

  const camera = readPhotoMetadata(photo.bytes);
  const signals = [
    photoLocationSignal(camera.location, plot.ring),
    photoTimeSignal(camera.takenAt, Date.now()),
    gpsAccuracySignal(fields.accuracy ?? null),
    weatherSignal(milestone.type, await rainToday(centroid(plot.ring))),
    satelliteSignal(plot.commodity, milestone.type, await viewsOf(database, plot.ring)),
  ];
  refreshInBackground(database, plot.ring);

  const issuedCode = challenge && isAuthentic(challenge) ? challenge.code : '';
  const verdict = oracle ? visionVerdict(oracle.reading, issuedCode, milestone.type) : null;
  const result = await submitClaim(database, {
    milestoneId: milestone.id,
    // The stage the farmer picked, unless their voice note names another; a photo alone says nothing
    // about which stage the farmer is claiming, so the model's guess from it is not used.
    claimedMilestone: (audio && oracle?.reading.claimedMilestone) || fields.milestone || milestone.type,
    challengeId: fields.challengeId,
    challengeCode: fields.challengeCode,
    gps: [fields.lng, fields.lat],
    vision: verdict && { codeMatch: verdict.codeMatch, confidence: verdict.confidence },
    bills: readBills(oracle?.reading.bills ?? [], milestone.rule, fields),
    signals,
    evidence: [
      { kind: 'PHOTO', sha256: photoSha, photoHash: await photoHash(photo.bytes), oracle: { ...oracle, verdict, signals } },
      ...(audioSha ? [{ kind: 'VOICE' as const, sha256: audioSha }] : []),
    ],
  });

  // A held claim gets the review agent's recommendation once the farmer already has an answer.
  if (result.decision.kind === 'RELEASE' && milestone.type === 'PLOT_VERIFIED') {
    after(() => chargePremiumsWithVault(database, milestone.contractId).catch((error: unknown) => console.error('Premium charge failed', error instanceof Error ? error.message : error)));
  }
  if (result.decision.kind === 'REVIEW' && withinAiBudget('review')) {
    after(() => runReviewAgent(database, milestone.id).catch((error: unknown) => console.error('Review agent failed', error instanceof Error ? error.message : error)));
  }

  return Response.json({ ...result, signals, oracle: oracle && { reading: oracle.reading, source: oracle.source, verdict } });
});
