import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { isSamePhoto } from '@/lib/engine/fraud';
import { photoHash } from '@/lib/services/photo-hash';

const photo = readFileSync('tests/fixtures/field-photo.jpg');

describe('photoHash', () => {
  it('recognises the same photo after it is resized and recompressed', async () => {
    const copy = await sharp(photo).resize(640).jpeg({ quality: 55 }).toBuffer();
    const [a, b] = await Promise.all([photoHash(photo), photoHash(copy)]);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(isSamePhoto(a!, b!)).toBe(true);
  });

  it('tells a different photo apart, and returns null for a file that is not an image', async () => {
    const flipped = await sharp(photo).flop().toBuffer();
    expect(isSamePhoto((await photoHash(photo))!, (await photoHash(flipped))!)).toBe(false);
    expect(await photoHash(new TextEncoder().encode('not an image'))).toBeNull();
  });
});
