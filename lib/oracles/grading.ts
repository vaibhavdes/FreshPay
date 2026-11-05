import { createHash } from 'node:crypto';
import { generateText, Output, type LanguageModel } from 'ai';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { oracleReadings } from '../db/schema';
import { DEFECTS, RUBRICS, type GradedCrop } from '../engine/grading';
import { env } from '../env';
import { geminiModels } from './models';
import { OracleUnavailable } from './evidence';

const GradingReading = z.object({
  cropSeen: z.enum(['coffee', 'cocoa', 'potato', 'cotton', 'other']).describe('The produce the photo shows'),
  isLotSample: z.boolean().describe('True if the photo shows a sample or heap of harvested produce close enough to judge quality'),
  defects: z
    .array(z.object({ defect: z.enum(DEFECTS), percent: z.number().min(0).max(100).describe('Estimated share of the visible sample, by count or area') }))
    .describe('Each defect you can see, with its estimated share; leave out defects you do not see'),
  confidence: z.number().min(0).max(1).describe('How sure you are of these estimates from this one photo'),
  notes: z.string().describe('One or two plain sentences on what you saw'),
});
export type GradingModelReading = z.infer<typeof GradingReading>;

const PROMPT_VERSION = 'grading-v1';
const TIMEOUT_MS = 20_000;

const system = (crop: GradedCrop) =>
  [
    `You inspect a photo of ${RUBRICS[crop].sample} delivered by smallholder farmers to a collection centre.`,
    `Estimate the share of each of these defects you can see: ${RUBRICS[crop].rules.map((r) => `${r.defect} (${r.label.toLowerCase()})`).join(', ')}.`,
    'Estimate only from what is visible, and lower your confidence when the photo is far away, blurred or shows only part of the lot.',
    'Describe what you see. Do not decide a price or whether anyone is paid.',
  ].join(' ');

export const gradingHash = (crop: GradedCrop, photo: Uint8Array) => createHash('sha256').update(PROMPT_VERSION).update(crop).update(photo).digest('hex');

async function ask(model: LanguageModel, crop: GradedCrop, photo: Uint8Array, photoType: string) {
  const { output } = await generateText({
    model,
    output: Output.object({ schema: GradingReading }),
    system: system(crop),
    messages: [{ role: 'user', content: [{ type: 'text', text: `Contract crop: ${crop}.` }, { type: 'file', mediaType: photoType, data: photo }] }],
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    maxRetries: 1,
  });
  return output;
}

export async function readLotSample(db: Db, crop: GradedCrop, photo: Uint8Array, photoType: string, options: { modelFor?: (id: string) => LanguageModel; now?: number } = {}) {
  const config = env();
  const inputHash = gradingHash(crop, photo);
  const [cached] = await db.select().from(oracleReadings).where(eq(oracleReadings.inputHash, inputHash));
  if (cached) return { inputHash, reading: GradingReading.parse(cached.reading), model: cached.model };

  const modelFor = options.modelFor ?? geminiModels(config);
  let lastError: unknown = new Error('no Gemini credentials configured');
  if (modelFor) {
    for (const id of config.AI_MODELS) {
      try {
        const reading = await ask(modelFor(id), crop, photo, photoType);
        await db.insert(oracleReadings).values({ inputHash, model: id, reading, createdAt: options.now ?? Date.now() }).onConflictDoNothing();
        return { inputHash, reading, model: id };
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw new OracleUnavailable(lastError);
}
