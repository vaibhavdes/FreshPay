import type { LngLat } from './geo';

// Writes the location and time a phone camera records into a JPEG's Exif segment, so a ready
// photo for testing reads like one taken on the farm. Little-endian TIFF with an Exif IFD
// (DateTimeOriginal) and a GPS IFD (latitude and longitude in degrees, minutes, seconds).
export function withCameraData(jpeg: Uint8Array, location: LngLat, takenAt: Date): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Not a JPEG');
  const [lng, lat] = location;
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${takenAt.getUTCFullYear()}:${pad(takenAt.getUTCMonth() + 1)}:${pad(takenAt.getUTCDate())} ${pad(takenAt.getUTCHours())}:${pad(takenAt.getUTCMinutes())}:${pad(takenAt.getUTCSeconds())}\0`;
  const dms = (deg: number) => {
    const a = Math.abs(deg);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const s = Math.round(((a - d) * 60 - m) * 60 * 1000);
    return [d, 1, m, 1, s, 1000];
  };

  const IFD0 = 8;
  const EXIF = IFD0 + 2 + 2 * 12 + 4;
  const DATE = EXIF + 2 + 12 + 4;
  const GPS = DATE + 20;
  const LAT = GPS + 2 + 4 * 12 + 4;
  const LNG = LAT + 24;
  const size = LNG + 24;

  const tiff = new DataView(new ArrayBuffer(size));
  const u16 = (at: number, v: number) => tiff.setUint16(at, v, true);
  const u32 = (at: number, v: number) => tiff.setUint32(at, v, true);
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    u16(at, tag);
    u16(at + 2, type);
    u32(at + 4, count);
    u32(at + 8, value);
  };
  const inlineAscii = (at: number, tag: number, text: string) => {
    u16(at, tag);
    u16(at + 2, 2);
    u32(at + 4, 2);
    tiff.setUint8(at + 8, text.charCodeAt(0));
  };

  u16(0, 0x4949);
  u16(2, 42);
  u32(4, IFD0);
  u16(IFD0, 2);
  entry(IFD0 + 2, 0x8769, 4, 1, EXIF);
  entry(IFD0 + 14, 0x8825, 4, 1, GPS);
  u16(EXIF, 1);
  entry(EXIF + 2, 0x9003, 2, 20, DATE);
  [...stamp].forEach((c, i) => tiff.setUint8(DATE + i, c.charCodeAt(0)));
  u16(GPS, 4);
  inlineAscii(GPS + 2, 1, lat < 0 ? 'S' : 'N');
  entry(GPS + 14, 2, 5, 3, LAT);
  inlineAscii(GPS + 26, 3, lng < 0 ? 'W' : 'E');
  entry(GPS + 38, 4, 5, 3, LNG);
  dms(lat).forEach((v, i) => u32(LAT + i * 4, v));
  dms(lng).forEach((v, i) => u32(LNG + i * 4, v));

  const header = new TextEncoder().encode('Exif\0\0');
  const length = 2 + header.length + size;
  const out = new Uint8Array(jpeg.length + 2 + length);
  out.set([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff]);
  out.set(header, 6);
  out.set(new Uint8Array(tiff.buffer), 6 + header.length);
  out.set(jpeg.subarray(2), 6 + header.length + size);
  return out;
}
