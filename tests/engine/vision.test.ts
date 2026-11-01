import { describe, expect, it } from 'vitest';
import { normalizeCode, visionVerdict } from '@/lib/engine/vision';

describe('normalizeCode', () => {
  it('ignores case, spaces and dashes in handwriting', () => {
    expect(normalizeCode(' k7q-2 ab ')).toBe('K7Q2AB');
    expect(normalizeCode(null)).toBe('');
  });
});

describe('visionVerdict', () => {
  it('matches the handwritten code and keeps confidence when the stage fits', () => {
    expect(visionVerdict({ challengeCodeRead: 'k7q 2ab', cropStage: 'FRUITING', confidence: 0.92 }, 'K7Q2AB', 'INPUTS')).toEqual({
      codeMatch: true,
      stageFits: true,
      confidence: 0.92,
    });
  });

  it('caps confidence when the crop stage does not fit the claim', () => {
    expect(visionVerdict({ challengeCodeRead: 'K7Q2AB', cropStage: 'FLOWERING', confidence: 0.95 }, 'K7Q2AB', 'HARVEST')).toEqual({
      codeMatch: true,
      stageFits: false,
      confidence: 0.5,
    });
  });

  it('never matches when no code was legible', () => {
    expect(visionVerdict({ challengeCodeRead: null, cropStage: 'MATURE', confidence: 0.9 }, 'K7Q2AB', 'HARVEST').codeMatch).toBe(false);
    expect(visionVerdict({ challengeCodeRead: 'K7Q2AX', cropStage: 'MATURE', confidence: 0.9 }, 'K7Q2AB', 'HARVEST').codeMatch).toBe(false);
  });
});
