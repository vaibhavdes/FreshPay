import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { challenges, milestones, plots } from '@/lib/db/schema';
import { PLOT_MILESTONES } from '@/lib/engine/stateMachine';
import { visionVerdict } from '@/lib/engine/vision';
import { runReviewAgent } from '@/lib/agents/review-agent';
import { chargePremiumsWithVault } from '@/lib/services/premium';
import { handle, type IdContext } from '@/lib/http';
import { OracleUnavailable, readEvidence } from '@/lib/oracles/evidence';
import { isAuthentic } from '@/lib/services/challenges';
import { HttpError, notFound } from '@/lib/services/errors';
import { submitClaim } from '@/lib/services/milestones';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const EVIDENCE_DIR = join(process.cwd(), 'data/evidence');

const Fields = z.object({
  challengeId: z.string().min(1),
  challengeCode: z.string().min(1),
  lng: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  milestone: z.enum(PLOT_MILESTONES).optional(),
});

async function fileBytes(form: FormData, name: string, kind: 'image' | 'audio', maxBytes: number) {
  const file = form.get(name);
  if (!(file instanceof File) || file.size === 0) return null;
  if (!file.type.startsWith(`${kind}/`)) throw new HttpError(415, `${name} must be an ${kind} file`);
  if (file.size > maxBytes) throw new HttpError(413, `${name} is larger than ${maxBytes / 1024 / 1024} MB`);
  return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type };
}

// Evidence files are kept by content hash for the audit trail and dispute packs.
async function store(bytes: Uint8Array, type: string) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(join(EVIDENCE_DIR, `${sha256}.${type.split('/')[1]?.split(';')[0] ?? 'bin'}`), bytes);
  return sha256;
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

  const photoSha = await store(photo.bytes, photo.type);
  const audioSha = audio ? await store(audio.bytes, audio.type) : null;

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

  const issuedCode = challenge && isAuthentic(challenge) ? challenge.code : '';
  const verdict = oracle ? visionVerdict(oracle.reading, issuedCode, milestone.type) : null;
  const result = await submitClaim(database, {
    milestoneId: milestone.id,
    claimedMilestone: oracle?.reading.claimedMilestone ?? fields.milestone ?? milestone.type,
    challengeId: fields.challengeId,
    challengeCode: fields.challengeCode,
    gps: [fields.lng, fields.lat],
    vision: verdict && { codeMatch: verdict.codeMatch, confidence: verdict.confidence },
    evidence: [
      { kind: 'PHOTO', sha256: photoSha, oracle: oracle ? { ...oracle, verdict } : undefined },
      ...(audioSha ? [{ kind: 'VOICE' as const, sha256: audioSha }] : []),
    ],
  });

  // A held claim gets the review agent's recommendation once the farmer already has an answer.
  if (result.decision.kind === 'RELEASE' && milestone.type === 'PLOT_VERIFIED') {
    after(() => chargePremiumsWithVault(database, milestone.contractId).catch((error: unknown) => console.error('Premium charge failed', error instanceof Error ? error.message : error)));
  }
  if (result.decision.kind === 'REVIEW') {
    after(() => runReviewAgent(database, milestone.id).catch((error: unknown) => console.error('Review agent failed', error instanceof Error ? error.message : error)));
  }

  return Response.json({ ...result, oracle: oracle && { reading: oracle.reading, source: oracle.source, verdict } });
});
