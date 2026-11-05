import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { OracleUnavailable } from '@/lib/oracles/evidence';
import { readLotSample, type GradingModelReading } from '@/lib/oracles/grading';
import { freshDb, NOW } from '../helpers';

const reading: GradingModelReading = { cropSeen: 'cocoa', isLotSample: true, defects: [{ defect: 'SLATY', percent: 2 }], confidence: 0.88, notes: 'Well-fermented brown beans, a few slaty ones.' };
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 20, text: 20, reasoning: undefined } };
const answering = () =>
  new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: 'text', text: JSON.stringify(reading) }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }) });
const failing = () =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error('quota exhausted');
    },
  });
const photo = new Uint8Array([9, 8, 7]);

describe('readLotSample', () => {
  it('falls back to the next model and reuses the reading for the same photo', async () => {
    const db = await freshDb();
    const used: string[] = [];
    const modelFor = (id: string) => (used.push(id), used.length === 1 ? failing() : answering());
    const first = await readLotSample(db, 'cocoa', photo, 'image/jpeg', { modelFor, now: NOW });
    expect(first.reading).toEqual(reading);
    const again = await readLotSample(db, 'cocoa', photo, 'image/jpeg', { modelFor: () => failing(), now: NOW });
    expect(again).toEqual(first);
  });

  it('says so when no model can read the photo', async () => {
    await expect(readLotSample(await freshDb(), 'cocoa', photo, 'image/jpeg', { modelFor: () => failing() })).rejects.toBeInstanceOf(OracleUnavailable);
  });
});
