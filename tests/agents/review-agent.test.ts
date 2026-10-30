import { MockLanguageModelV4 } from 'ai/test';
import { beforeEach, describe, expect, it } from 'vitest';
import { runReviewAgent, type ReviewRecommendation } from '@/lib/agents/review-agent';
import { findReusedPhoto, getEvidence, satelliteCheck } from '@/lib/agents/review-tools';
import { SCENARIOS, seedScenario } from '@/lib/agents/eval-scenarios';
import type { Db } from '@/lib/db/client';
import { freshDb, NOW } from '../helpers';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

const scenario = (name: string) => SCENARIOS.find((s) => s.name === name)!;

let db: Db;

beforeEach(async () => {
  db = await freshDb();
});

describe('review agent tools', () => {
  it('summarises the held evidence, including where the phone was', async () => {
    const id = await seedScenario(db, scenario('Dim but genuine photo'), NOW);
    expect(await getEvidence(db, id)).toMatchObject({
      issuedCode: 'K7Q2AB',
      minutesFromCodeToPhoto: 6,
      heldBecause: ['LOW_CONFIDENCE'],
      location: { insidePlot: true },
      aiReading: { codeRead: 'K7Q2AB', codeMatches: true, stageFitsMilestone: true, confidence: 0.72 },
    });
  });

  it('finds a photo submitted on another claim', async () => {
    const reused = await seedScenario(db, scenario('Photo reused from another plot'), NOW);
    const clean = await seedScenario(db, scenario('Dim but genuine photo'), NOW);
    expect((await findReusedPhoto(db, reused)).usedElsewhere).toHaveLength(1);
    expect((await findReusedPhoto(db, clean)).usedElsewhere).toHaveLength(0);
  });

  it('reports a borderline satellite result', async () => {
    const id = await seedScenario(db, scenario('Good evidence, borderline forest check'), NOW);
    expect(await satelliteCheck(db, id)).toMatchObject({ eudrStatus: 'REVIEW', treeCoverLostSince2021Ha: 0.08 });
  });
});

describe('runReviewAgent', () => {
  it('stores the recommendation together with the checks it ran', async () => {
    const id = await seedScenario(db, scenario('Photo reused from another plot'), NOW);
    const answer: ReviewRecommendation = {
      recommendation: 'REFUSE',
      confidence: 'HIGH',
      summary: 'The same photo was already submitted for another plot.',
      reasons: ['Photo reused on another claim'],
    };
    let call = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () =>
        call++ === 0
          ? { content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'findReusedPhoto', input: '{}' }], finishReason: { unified: 'tool-calls', raw: undefined }, usage, warnings: [] }
          : { content: [{ type: 'text', text: JSON.stringify(answer) }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] },
    });

    const review = await runReviewAgent(db, id, { model, modelId: 'mock', now: NOW });
    expect(review).toMatchObject({ recommendation: 'REFUSE', confidence: 'HIGH', model: 'mock' });
    expect(review?.checks).toEqual([{ tool: 'findReusedPhoto', input: {}, finding: 'Photo also used on 1 other claim(s)' }]);
  });

  it('leaves the claim to a person when no model is configured', async () => {
    const id = await seedScenario(db, scenario('No AI reading at all'), NOW);
    expect(await runReviewAgent(db, id)).toBeNull();
  });
});
