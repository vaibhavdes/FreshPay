import type { LngLat } from './geo';

// The two facts a camera may write into a JPEG that help check a farm photo: where and when it
// was taken. Phones often strip them from uploads, so both are optional.
export type PhotoMetadata = { location: LngLat | null; takenAt: string | null };

const NONE: PhotoMetadata = { location: null, takenAt: null };

const EXIF_IFD = 0x8769;
const GPS_IFD = 0x8825;
const DATE_TIME_ORIGINAL = 0x9003;
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

type Entry = { type: number; count: number; valueAt: number };

export function readPhotoMetadata(bytes: Uint8Array): PhotoMetadata {
  try {
    const tiff = findExif(bytes);
    if (tiff === null) return NONE;
    const view = new DataView(bytes.buffer, bytes.byteOffset + tiff, bytes.byteLength - tiff);
    const little = view.getUint16(0) === 0x4949;
    const u16 = (at: number) => view.getUint16(at, little);
    const u32 = (at: number) => view.getUint32(at, little);

    const entries = (ifd: number) => {
      const map = new Map<number, Entry>();
      for (let i = 0, n = u16(ifd); i < n; i++) {
        const at = ifd + 2 + i * 12;
        const type = u16(at + 2);
        const count = u32(at + 4);
        const inline = (TYPE_SIZE[type] ?? 1) * count <= 4;
        map.set(u16(at), { type, count, valueAt: inline ? at + 8 : u32(at + 8) });
      }
      return map;
    };
    const ascii = (e: Entry | undefined) => (e ? String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + e.valueAt, e.count)).replace(/\0+$/, '') : null);
    const degrees = (e: Entry | undefined) => {
      if (!e || e.type !== 5 || e.count < 3) return null;
      const [d, m, s] = [0, 1, 2].map((i) => u32(e.valueAt + i * 8) / u32(e.valueAt + i * 8 + 4));
      return d + m / 60 + s / 3600;
    };

    const ifd0 = entries(u32(4));
    const linked = (tag: number) => {
      const pointer = ifd0.get(tag);
      return pointer ? entries(u32(pointer.valueAt)) : null;
    };
    const exif = linked(EXIF_IFD);
    const gps = linked(GPS_IFD);

    const stamp = ascii(exif?.get(DATE_TIME_ORIGINAL));
    const match = stamp?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    const takenAt = match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}` : null;

    const lat = degrees(gps?.get(2));
    const lng = degrees(gps?.get(4));
    const location: LngLat | null =
      lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)
        ? [ascii(gps?.get(3)) === 'W' ? -lng : lng, ascii(gps?.get(1)) === 'S' ? -lat : lat]
        : null;
    return { location, takenAt };
  } catch {
    return NONE;
  }
}

// Offset of the TIFF header inside the JPEG's Exif segment, or null when there is none.
function findExif(bytes: Uint8Array): number | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 4 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === 'Exif') return at + 10;
    if (marker === 0xda) return null;
    at += 2 + length;
  }
  return null;
}
