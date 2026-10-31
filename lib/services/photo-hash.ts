import sharp from 'sharp';

// A 64-bit difference hash: each bit says whether a pixel is brighter than its right-hand
// neighbour in a 9x8 greyscale thumbnail. Re-saving, resizing or recompressing a photo barely
// changes it, so a reused photo is still caught. Null when the file isn't a readable image.
export async function photoHash(bytes: Uint8Array): Promise<string | null> {
  try {
    const pixels = await sharp(bytes).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
    let hex = '';
    for (let y = 0; y < 8; y++) {
      for (let half = 0; half < 2; half++) {
        let nibble = 0;
        for (let x = half * 4; x < half * 4 + 4; x++) nibble = (nibble << 1) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1 : 0);
        hex += nibble.toString(16);
      }
    }
    return hex;
  } catch {
    return null;
  }
}
