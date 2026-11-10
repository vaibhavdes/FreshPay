import { describe, expect, it } from 'vitest';
import { nextItemStatus } from '@/lib/engine/payout-status';
import { photoOriginSignal } from '@/lib/engine/proof';

describe('payout item status', () => {
  it('moves forward and never back', () => {
    expect(nextItemStatus('PENDING', 'SUCCESS')).toBe('SUCCESS');
    expect(nextItemStatus('UNCLAIMED', 'SUCCESS')).toBe('SUCCESS');
    expect(nextItemStatus('SUCCESS', 'PENDING')).toBe('SUCCESS');
    expect(nextItemStatus('SUCCESS', 'UNCLAIMED')).toBe('SUCCESS');
    expect(nextItemStatus('SUCCESS', 'RETURNED')).toBe('RETURNED');
    expect(nextItemStatus('FAILED', 'SUCCESS')).toBe('FAILED');
  });
});

describe('photo origin', () => {
  it('holds a file whose credentials say an AI generator made it, and says nothing otherwise', () => {
    const tagged = new TextEncoder().encode('jumb...c2pa...http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia');
    expect(photoOriginSignal(tagged)).toMatchObject({ id: 'PHOTO_ORIGIN', status: 'WARN' });
    expect(photoOriginSignal(new TextEncoder().encode('digitalsourcetype/compositeWithTrainedAlgorithmicMedia'))).toBeNull();
    expect(photoOriginSignal(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});
