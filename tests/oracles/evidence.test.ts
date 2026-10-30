import { MockLanguageModelV4 } from 'ai/test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/client';
import { oracleReadings } from '@/lib/db/schema';
import { OracleUnavailable, readEvidence, type EvidenceReading } from '@/lib/oracles/evidence';
import { freshDb, NOW } from '../helpers';

const reading: EvidenceReading = {
  transcript: 'I bought two bags of fertiliser for my upper plot.',
  claimedMilestone: 'INPUTS',
  quantityKg: 100,
  inputsBought: 'fertiliser',
  challengeCodeRead: 'K7Q2AB',
  cropStage: 'FLOWERING',
  weightKgRead: null,
  damagePctEst: null,
  confidence: 0.91,
  notes: 'Code is clear; flowering coffee under shade trees.',
};

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

const answering = () =>
  new MockLanguageModelV4({
    doGenerate: async () => ({ content: [{ type: 'text', text: JSON.stringify(reading) }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }),
  });

const failing = () =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error('quota exhausted');
    },
  });

const input = { photo: new Uint8Array([1, 2, 3]), photoType: 'image/jpeg', audio: new Uint8Array([4, 5]), audioType: 'audio/webm', plotName: 'Aldur upper estate', commodity: 'coffee' };

let db: Db;

beforeEach(async () => {
  db = await freshDb();
});

describe('readEvidence', () => {
  it('falls back to the next model and caches the reading', async () => {
    const calls: string[] = [];
    const modelFor = (id: string) => {
      calls.push(id);
      return id === 'gemini-3.5-flash-lite' ? failing() : answering();
    };

    const first = await readEvidence(db, input, { modelFor, now: NOW });
    expect(first.source).toEqual({ kind: 'MODEL', model: 'gemini-3.8-flash' });
    expect(first.reading).toEqual(reading);

    const second = await readEvidence(db, input, { modelFor, now: NOW });
    expect(second.source).toEqual({ kind: 'CACHE', model: 'gemini-3.8-flash' });
    expect(calls).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
  });

  it('gives up honestly when every model fails and nothing was recorded', async () => {
    await expect(readEvidence(db, input, { modelFor: failing, now: NOW })).rejects.toBeInstanceOf(OracleUnavailable);
  });

  it('stops calling models once the daily limit is reached', async () => {
    await db.insert(oracleReadings).values(Array.from({ length: 400 }, (_, i) => ({ inputHash: `h${i}`, model: 'gemini-3.5-flash-lite', reading: {}, createdAt: NOW })));
    const error = await readEvidence(db, input, { modelFor: answering, now: NOW }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OracleUnavailable);
    expect(((error as OracleUnavailable).cause as Error).message).toContain('daily limit');
  });
});
