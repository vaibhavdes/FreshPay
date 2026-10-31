// Checks that catch evidence reused to be paid twice: the same photo, or the same bill.

const DAY = 24 * 60 * 60_000;

// Two 64-bit difference hashes this close are the same picture, re-saved, resized or recompressed.
export const SAME_PHOTO_MAX_DISTANCE = 6;

// Bits that differ between two hex hashes of the same length.
export function hashDistance(a: string, b: string): number {
  let bits = 0;
  for (let i = 0; i < a.length; i++) {
    for (let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); x; x >>= 1) bits += x & 1;
  }
  return bits;
}

export const isSamePhoto = (a: string, b: string) => hashDistance(a, b) <= SAME_PHOTO_MAX_DISTANCE;

// Words that say what kind of business it is rather than which one.
const GENERIC = new Set(['and', 'the', 'pvt', 'ltd', 'llp', 'limited', 'private', 'company', 'co', 'group', 'shop', 'store', 'stores', 'traders', 'enterprises', 'agency', 'agencies', 'services']);

const words = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !GENERIC.has(w));

// The name printed on a bill against the supplier the farmer picked. Null when the bill names
// nobody: that is not evidence either way.
export function issuerMatches(issuer: string | null | undefined, supplierName: string): boolean | null {
  if (!issuer?.trim()) return null;
  const printed = words(issuer);
  const registered = new Set(words(supplierName));
  if (!printed.length) return null;
  return printed.some((w) => registered.has(w));
}

export type BillFacts = { kind: string; cents: number; issuer?: string | null; number?: string | null; date?: string | null };

// One key per real-world bill. Without a bill number the issuer, date and amount must all be
// read, or two different bills for the same amount would look alike.
export function billFingerprint(bill: BillFacts): string | null {
  const issuer = words(bill.issuer ?? '').join(' ');
  const number = (bill.number ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (number) return [bill.kind, issuer, number, bill.cents].join('|');
  if (issuer && bill.date) return [bill.kind, issuer, bill.date, bill.cents].join('|');
  return null;
}

// A bill for this stage is dated from shortly before its window opens up to today.
export function billDateFits(date: string | null | undefined, opensAt: number, now: number): boolean | null {
  if (!date) return null;
  const at = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(at)) return null;
  return at >= opensAt - 14 * DAY && at <= now + DAY;
}
