import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateText, Output, type LanguageModel } from 'ai';
import { and, count, eq, gte, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { oracleReadings } from '../db/schema';
import { SUPPLIER_KINDS } from '../engine/gate';
import { PLOT_MILESTONES } from '../engine/stateMachine';
import { CROP_STAGES } from '../engine/vision';
import { env } from '../env';
import { geminiModels } from './models';

export const EvidenceReading = z.object({
  transcript: z.string().describe('What the farmer says in the voice note, in English (translated if they spoke another language); empty when there is no audio'),
  spokenLanguage: z.string().nullable().describe('Language of the voice note, e.g. Kannada, Marathi, Hindi, Tamil or English; null when there is no audio'),
  originalTranscript: z.string().nullable().describe('Verbatim transcript in the language and script the farmer spoke; null when there is no audio or it was English'),
  claimedMilestone: z
    .enum(PLOT_MILESTONES)
    .nullable()
    .describe(
      'Stage the farmer reports: PLOT_VERIFIED (registering the farm), INPUTS (fertiliser round), CROP_CARE (pest or disease control), HARVEST (picking), PROCESSING (pulping, drying or transport); null if unclear',
    ),
  quantityKg: z.number().nullable().describe('Quantity in kilograms the farmer mentions, if any'),
  inputsBought: z.string().nullable().describe('Inputs the farmer says they bought or applied, if any'),
  challengeCodeRead: z.string().nullable().describe('The 6-character code handwritten on paper in the photo, exactly as written; null if none is legible'),
  cropStage: z.enum(CROP_STAGES).describe('Stage of the coffee crop visible in the photo'),
  weightKgRead: z.number().nullable().describe('Weight printed on a weighing slip, if one is visible'),
  bills: z
    .array(
      z.object({
        amount: z.number().describe('Grand total exactly as printed'),
        currency: z.string().describe('ISO code, e.g. INR for rupees (₹, Rs)'),
        kind: z
          .enum(SUPPLIER_KINDS)
          .nullable()
          .describe('INPUTS for fertiliser, seed, pesticide or fungicide; LABOUR for wages of pickers, sprayers or field workers; MACHINERY for pulper, tractor or lorry hire; null if unclear'),
        issuer: z.string().nullable().describe('Shop, group or business named on the bill'),
      }),
    )
    .describe('Every bill, receipt or wage sheet in the photo whose total is legible; empty if none'),
  damagePctEst: z.number().min(0).max(100).nullable().describe('Estimated share of the visible crop that is damaged, if damage is visible'),
  confidence: z.number().min(0).max(1).describe('How sure you are that this is a genuine, current field photo of the crop described'),
  notes: z.string().describe('One or two sentences on anything suspicious or unclear'),
});
export type EvidenceReading = z.infer<typeof EvidenceReading>;

export type EvidenceInput = {
  photo: Uint8Array;
  photoType: string;
  audio?: Uint8Array;
  audioType?: string;
  plotName: string;
  commodity: string;
};

export type EvidenceSource = { kind: 'MODEL' | 'CACHE' | 'REPLAY'; model: string };

export class OracleUnavailable extends Error {
  constructor(cause: unknown) {
    super('No model could read the evidence and no recorded reading exists', { cause });
    this.name = 'OracleUnavailable';
  }
}

const PROMPT_VERSION = 'evidence-v4';
const TIMEOUT_MS = 15_000;
const FIXTURES_DIR = join(process.cwd(), 'lib/oracles/fixtures');

const SYSTEM = [
  'You check field evidence from smallholder farmers for a crop payment platform.',
  'You get a photo taken on the farm and usually a short voice note, in English or a regional language such as Kannada, Marathi, Hindi or Tamil.',
  'Transcribe the voice note in the language spoken and translate it to English; quantities and inputs come from what was said, whatever the language.',
  'The farmer holds or places a paper with a 6-character code written on it; read that code exactly as written, without guessing.',
  'Describe only what you can see and hear. Do not decide whether anyone gets paid.',
].join(' ');

export function evidenceHash(input: EvidenceInput): string {
  const hash = createHash('sha256').update(PROMPT_VERSION).update(input.plotName).update(input.commodity).update(input.photo);
  if (input.audio) hash.update(input.audio);
  return hash.digest('hex');
}

async function modelCallsToday(db: Db, now: number): Promise<number> {
  const startOfDay = new Date(now).setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ n: count() })
    .from(oracleReadings)
    .where(and(gte(oracleReadings.createdAt, startOfDay), ne(oracleReadings.model, 'replay')));
  return row.n;
}

async function askModel(model: LanguageModel, input: EvidenceInput): Promise<EvidenceReading> {
  const { output } = await generateText({
    model,
    output: Output.object({ schema: EvidenceReading }),
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: `Plot: ${input.plotName}. Crop: ${input.commodity}.` },
          { type: 'file', mediaType: input.photoType, data: input.photo },
          ...(input.audio ? [{ type: 'file' as const, mediaType: input.audioType ?? 'audio/webm', data: input.audio }] : []),
        ],
      },
    ],
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    maxRetries: 1,
  });
  return output;
}

export type ReadOptions = { modelFor?: (id: string) => LanguageModel; now?: number };

export async function readEvidence(db: Db, input: EvidenceInput, options: ReadOptions = {}) {
  const config = env();
  const { AI_MODE, AI_MODELS, AI_DAILY_LIMIT } = config;
  const now = options.now ?? Date.now();
  const inputHash = evidenceHash(input);

  const [cached] = await db.select().from(oracleReadings).where(eq(oracleReadings.inputHash, inputHash));
  if (cached) return { inputHash, reading: EvidenceReading.parse(cached.reading), source: { kind: 'CACHE', model: cached.model } as EvidenceSource };

  const modelFor = options.modelFor ?? geminiModels(config);
  let lastError: unknown = new Error(AI_MODE === 'replay' ? 'AI_MODE=replay' : 'no Gemini credentials configured');

  if (AI_MODE === 'live' && modelFor) {
    if ((await modelCallsToday(db, now)) >= AI_DAILY_LIMIT) lastError = new Error(`daily limit of ${AI_DAILY_LIMIT} model calls reached`);
    else {
      for (const id of AI_MODELS) {
        try {
          const reading = await askModel(modelFor(id), input);
          await db.insert(oracleReadings).values({ inputHash, model: id, reading, createdAt: now }).onConflictDoNothing();
          return { inputHash, reading, source: { kind: 'MODEL', model: id } as EvidenceSource };
        } catch (error) {
          lastError = error;
        }
      }
    }
  }

  const fixture = join(FIXTURES_DIR, `${inputHash}.json`);
  if (existsSync(fixture)) {
    return { inputHash, reading: EvidenceReading.parse(JSON.parse(readFileSync(fixture, 'utf8'))), source: { kind: 'REPLAY', model: 'replay' } as EvidenceSource };
  }
  throw new OracleUnavailable(lastError);
}
