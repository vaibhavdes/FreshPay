import { randomUUID } from 'node:crypto';
import { generateText, isStepCount, Output, ToolLoopAgent, tool, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Db } from '../db/client';
import { agentReviews, type AgentCheck } from '../db/schema';
import { env } from '../env';
import { publish } from '../events';
import { evidenceFile } from '../services/evidence-files';
import { geminiModels } from '../oracles/models';
import { findReusedPhoto, getEvidence, plotHistory, satelliteCheck } from './review-tools';

export const ReviewRecommendation = z.object({
  recommendation: z.enum(['APPROVE', 'REFUSE', 'UNSURE']),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  summary: z.string().describe('One or two sentences for the cooperative officer'),
  reasons: z.array(z.string()).max(4).describe('The facts that decided it, in plain English'),
});
export type ReviewRecommendation = z.infer<typeof ReviewRecommendation>;

const SecondOpinion = z.object({
  agrees: z.boolean().describe('True only if the facts support paying this claim'),
  concern: z.string().describe('The strongest reason not to pay, in one plain sentence; empty if there is none'),
});

const SKEPTIC = `You double-check a recommendation to approve a held crop payment claim before a person sees it.
Look only for reasons it should not be paid: a photo used on another claim, a code that does not match the one issued,
the wrong crop stage, a phone outside the farm, or outside checks (camera, weather, satellite) that contradict the claim.
Agree only if the facts support paying. You never decide: a person does.`;

const MAX_STEPS = 6;
const TIMEOUT_MS = 60_000;
const INSTRUCTIONS = `You review crop payment claims that automatic checks held for a person at a farmers' cooperative.
A held claim has already passed these checks: the photo code was issued to this plot, the phone was inside the plot boundary,
the payment window is open and the season advance covers the amount. It was held because the photo reading was not confident,
no model could read the photo, or the satellite forest check needs a person.

Investigate with the tools, then recommend one of:
- APPROVE when the evidence plausibly shows a genuine, current photo of this plot at this stage, with the issued code.
- REFUSE when the photo looks synthetic or staged, was used on another claim, shows the wrong crop stage, or the code does not match.
- UNSURE when the evidence is too thin to decide, or when the open question is whether forest was cleared; that is for a person.

Always check whether the photo was used on another claim. Use secondLook only when the photo reading is missing or unclear.
You only recommend: a person decides and code enforces the payment rules. Write for a cooperative officer in plain English.`;

function summarise(toolName: string, output: unknown): string {
  const o = output as Record<string, unknown>;
  switch (toolName) {
    case 'getEvidence': {
      const reading = o.aiReading as { codeRead: string | null; confidence: number; cropStage: string } | null;
      return reading
        ? `AI read ${reading.codeRead ?? 'no code'} (issued ${o.issuedCode ?? 'none'}), ${reading.cropStage.toLowerCase()}, ${Math.round(reading.confidence * 100)}% confident`
        : `No AI reading; issued code ${o.issuedCode ?? 'none'}`;
    }
    case 'plotHistory':
      return `${(o.milestones as unknown[]).length} other milestones, ${(o.farmerPayouts as unknown[]).length} earlier payouts`;
    case 'findReusedPhoto':
      return (o.usedElsewhere as unknown[]).length ? `Photo also used on ${(o.usedElsewhere as unknown[]).length} other claim(s)` : 'Photo not used on any other claim';
    case 'satelliteCheck':
      return `Forest check ${o.eudrStatus}, ${o.treeCoverLostSince2021Ha ?? 'unknown'} ha lost since 2021`;
    case 'secondLook':
      return o.available === false ? 'Photo file not available for a second look' : String(o.answer);
    default:
      return JSON.stringify(output).slice(0, 160);
  }
}

export function createReviewAgent(db: Db, milestoneId: string, model: LanguageModel) {
  return new ToolLoopAgent({
    model,
    instructions: INSTRUCTIONS,
    stopWhen: isStepCount(MAX_STEPS),
    output: Output.object({ schema: ReviewRecommendation }),
    tools: {
      getEvidence: tool({
        description: 'The held claim: amount, why it was held, the issued code, the AI reading of the photo and where the phone was.',
        inputSchema: z.object({}),
        execute: () => getEvidence(db, milestoneId),
      }),
      plotHistory: tool({
        description: "The plot's other milestones, earlier decisions and the farmer's earlier payouts.",
        inputSchema: z.object({}),
        execute: () => plotHistory(db, milestoneId),
      }),
      findReusedPhoto: tool({
        description: 'Whether the exact same photo was submitted on any other claim.',
        inputSchema: z.object({}),
        execute: () => findReusedPhoto(db, milestoneId),
      }),
      satelliteCheck: tool({
        description: 'The EUDR satellite result for the plot: tree cover lost since the 2020 cut-off.',
        inputSchema: z.object({}),
        execute: () => satelliteCheck(db, milestoneId),
      }),
      secondLook: tool({
        description: 'Look at the evidence photo again with one focused question, such as whether the handwritten code is legible.',
        inputSchema: z.object({ question: z.string().max(200) }),
        execute: async ({ question }) => {
          const { photoSha256 } = await getEvidence(db, milestoneId);
          const photo = photoSha256 ? await evidenceFile(db, photoSha256) : null;
          if (!photo) return { available: false };
          const { output } = await generateText({
            model,
            output: Output.object({ schema: z.object({ answer: z.string(), confidence: z.number().min(0).max(1) }) }),
            messages: [{ role: 'user', content: [{ type: 'text', text: question }, { type: 'file', mediaType: photo.type, data: photo.bytes }] }],
            abortSignal: AbortSignal.timeout(20_000),
          });
          return { available: true, ...output };
        },
      }),
    },
  });
}

export type ReviewOptions = { model?: LanguageModel; modelId?: string; now?: number };

// An approval gets a second, adversarial read of the same facts. If it finds a reason not to pay,
// the recommendation becomes "not sure" and the reason is shown to the officer.
async function challengeApproval(db: Db, milestoneId: string, model: LanguageModel, review: ReviewRecommendation) {
  const facts = { evidence: await getEvidence(db, milestoneId), reusedPhoto: await findReusedPhoto(db, milestoneId), recommendation: review };
  const { output } = await generateText({
    model,
    output: Output.object({ schema: SecondOpinion }),
    system: SKEPTIC,
    prompt: JSON.stringify(facts),
    abortSignal: AbortSignal.timeout(20_000),
  });
  return output;
}

// Runs the agent on one held claim and stores its recommendation with the checks it made.
// Returns null when no model is configured or it can't be reached: the claim simply waits for a person.
export async function runReviewAgent(db: Db, milestoneId: string, options: ReviewOptions = {}) {
  const config = env();
  const modelId = options.modelId ?? config.REVIEW_MODEL;
  const model = options.model ?? geminiModels(config)?.(modelId);
  const now = options.now ?? Date.now();

  if (!model) return null;

  const result = await createReviewAgent(db, milestoneId, model)
    .generate({ prompt: `Review held claim ${milestoneId} and recommend what the cooperative should do.`, abortSignal: AbortSignal.timeout(TIMEOUT_MS) })
    .catch(async (error: unknown) => {
      if (options.model) throw error;
      console.error('Review agent model failed', error instanceof Error ? error.message : error);
      return null;
    });
  if (!result) return null;

  const checks: AgentCheck[] = result.steps.flatMap((step) =>
    step.toolResults.map((r) => ({ tool: r.toolName, input: (r.input ?? {}) as Record<string, unknown>, finding: summarise(r.toolName, r.output) })),
  );
  let output = result.output;
  if (output.recommendation === 'APPROVE') {
    const second = await challengeApproval(db, milestoneId, model, output);
    checks.push({ tool: 'secondOpinion', input: {}, finding: second.agrees ? 'A second check found no reason not to pay' : `A second check disagreed: ${second.concern}` });
    if (!second.agrees) output = { ...output, recommendation: 'UNSURE', confidence: 'LOW', reasons: [...output.reasons, `A second check disagreed: ${second.concern}`].slice(-4) };
  }
  const [review] = await db
    .insert(agentReviews)
    .values({ id: randomUUID(), milestoneId, model: modelId, ...output, checks, createdAt: now })
    .returning();
  publish({ type: 'milestone', milestoneId, state: 'REVIEW' });
  return review;
}
