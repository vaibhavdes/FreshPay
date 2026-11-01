import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { readPhotoMetadata } from '@/lib/engine/exif';

const photo = readFileSync('tests/fixtures/field-photo.jpg');

describe('readPhotoMetadata', () => {
  it('reads where and when a camera says the photo was taken', async () => {
    const tagged = await sharp(photo)
      .withExif({
        IFD2: { DateTimeOriginal: '2026:11:03 09:15:00' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '13/1 16/1 3072/100', GPSLongitudeRef: 'E', GPSLongitude: '75/1 38/1 2436/100' },
      })
      .jpeg()
      .toBuffer();
    const { location, takenAt } = readPhotoMetadata(tagged);
    expect(takenAt).toBe('2026-11-03T09:15:00');
    expect(location![0]).toBeCloseTo(75.64010, 4);
    expect(location![1]).toBeCloseTo(13.27520, 4);
  });

  it('turns south and west references into negative coordinates', async () => {
    const tagged = await sharp(photo)
      .withExif({ IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '6/1 30/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '76/1 22/1 0/1' } })
      .jpeg()
      .toBuffer();
    expect(readPhotoMetadata(tagged).location).toEqual([-76 - 22 / 60, -6.5]);
  });

  it('ignores a zero position, a missing longitude and a cut-off file', async () => {
    const zero = await sharp(photo).withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '0/1 0/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '0/1 0/1 0/1' } }).jpeg().toBuffer();
    expect(readPhotoMetadata(zero).location).toBeNull();
    const latitudeOnly = await sharp(photo).withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '13/1 16/1 0/1' } }).jpeg().toBuffer();
    expect(readPhotoMetadata(latitudeOnly).location).toBeNull();
    const tagged = await sharp(photo).withExif({ IFD2: { DateTimeOriginal: '2026:11:03 09:15:00' } }).jpeg().toBuffer();
    const exifAt = tagged.indexOf('Exif');
    expect(readPhotoMetadata(tagged.subarray(0, exifAt + 20))).toEqual({ location: null, takenAt: null });
    expect(readPhotoMetadata(new Uint8Array([0xff, 0xd8]))).toEqual({ location: null, takenAt: null });
    const cameraOnly = await sharp(photo).withExif({ IFD0: { Make: 'Field phone' } }).jpeg().toBuffer();
    expect(readPhotoMetadata(cameraOnly)).toEqual({ location: null, takenAt: null });
  });

  it('returns nothing for photos without metadata and for files that are not JPEGs', () => {
    expect(readPhotoMetadata(photo)).toEqual({ location: null, takenAt: null });
    expect(readPhotoMetadata(new TextEncoder().encode('plain text'))).toEqual({ location: null, takenAt: null });
  });
});
