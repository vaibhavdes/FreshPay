import { describe, expect, it } from 'vitest';
import { gradeLot, isGradedCrop, type GradingReading } from '@/lib/engine/grading';

const reading = (over: Partial<GradingReading> = {}): GradingReading => ({ cropSeen: 'cocoa', isLotSample: true, defects: [], confidence: 0.9, ...over });

describe('lot grading', () => {
  it('grades cocoa by the ICCO limits and suggests quality from the weighted defects', () => {
    expect(gradeLot('cocoa', reading({ defects: [{ defect: 'MOULDY', percent: 2 }, { defect: 'SLATY', percent: 2 }] }))).toMatchObject({ grade: 'Grade I', qualityPercent: 97, needsPerson: [] });
    expect(gradeLot('cocoa', reading({ defects: [{ defect: 'SLATY', percent: 6 }] }))).toMatchObject({ grade: 'Grade II', qualityPercent: 97, needsPerson: [] });
    expect(gradeLot('cocoa', reading({ defects: [{ defect: 'MOULDY', percent: 6 }] }))).toMatchObject({ grade: 'Below grade', qualityPercent: 94, needsPerson: ['BELOW_CONTRACT'] });
  });

  it('ignores defects a crop is not graded on, and clamps silly estimates', () => {
    const g = gradeLot('coffee', reading({ cropSeen: 'coffee', defects: [{ defect: 'ROT', percent: 50 }, { defect: 'BROKEN', percent: 4 }] }));
    expect(g).toMatchObject({ grade: 'A', qualityPercent: 98 });
    expect(gradeLot('potato', reading({ cropSeen: 'potato', defects: [{ defect: 'ROT', percent: 400 }] })).qualityPercent).toBe(0);
    expect(gradeLot('cotton', reading({ cropSeen: 'cotton', defects: [{ defect: 'TRASH', percent: 5 }] }))).toMatchObject({ grade: 'B', qualityPercent: 95, needsPerson: [] });
  });

  it('knows which crops it can grade', () => {
    expect(isGradedCrop('cocoa')).toBe(true);
    expect(isGradedCrop('wheat')).toBe(false);
  });

  it('sends a person to check when the photo is unclear, the wrong crop or the AI is unsure', () => {
    expect(gradeLot('cocoa', reading({ cropSeen: 'coffee' }))).toMatchObject({ grade: null, qualityPercent: null, needsPerson: ['WRONG_CROP'] });
    expect(gradeLot('cocoa', reading({ isLotSample: false })).needsPerson).toEqual(['NOT_A_SAMPLE']);
    expect(gradeLot('cocoa', reading({ confidence: 0.6 }))).toMatchObject({ grade: 'Grade I', qualityPercent: 100, needsPerson: ['LOW_CONFIDENCE'] });
  });
});
