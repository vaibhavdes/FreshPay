import { describe, expect, it } from 'vitest';
import { readPhotoMetadata } from '@/lib/engine/exif';
import { withCameraData } from '@/lib/engine/exif-write';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

describe('withCameraData', () => {
  it('writes a location and time the reader gets back', () => {
    const out = withCameraData(JPEG, [75.7712, 12.4213], new Date('2026-11-01T09:05:07Z'));
    const { location, takenAt } = readPhotoMetadata(out);
    expect(takenAt).toBe('2026-11-01T09:05:07');
    expect(location![0]).toBeCloseTo(75.7712, 4);
    expect(location![1]).toBeCloseTo(12.4213, 4);
  });

  it('keeps the hemisphere south and west of the equator and Greenwich', () => {
    const { location } = readPhotoMetadata(withCameraData(JPEG, [-76.7712, -7.3021], new Date()));
    expect(location![0]).toBeCloseTo(-76.7712, 4);
    expect(location![1]).toBeCloseTo(-7.3021, 4);
  });

  it('refuses anything that is not a JPEG', () => {
    expect(() => withCameraData(new Uint8Array([1, 2, 3]), [0, 0], new Date())).toThrow('Not a JPEG');
  });
});
