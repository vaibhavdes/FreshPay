import { createHash } from 'node:crypto';

export type Receipt<T = unknown> = { seq: number; prevHash: string; hash: string; payload: T };

export const GENESIS_HASH = '0'.repeat(64);

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError(`Cannot hash a ${typeof value}`);
    return json;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
}

function digest(seq: number, prevHash: string, payload: unknown): string {
  return createHash('sha256').update(`${seq}\n${prevHash}\n${canonicalJson(payload)}`).digest('hex');
}

export function appendReceipt<T>(prev: Receipt | null, payload: T): Receipt<T> {
  const seq = prev ? prev.seq + 1 : 0;
  const prevHash = prev ? prev.hash : GENESIS_HASH;
  return { seq, prevHash, hash: digest(seq, prevHash, payload), payload };
}

// Whether a single receipt still hashes to what it says, whatever happened to the rest.
export const isIntact = (r: Receipt) => r.hash === digest(r.seq, r.prevHash, r.payload);

export type ChainCheck = { ok: true } | { ok: false; brokenAt: number };

export function verifyChain(receipts: readonly Receipt[]): ChainCheck {
  let prevHash = GENESIS_HASH;
  for (const [i, r] of receipts.entries()) {
    if (r.seq !== i || r.prevHash !== prevHash || r.hash !== digest(r.seq, r.prevHash, r.payload)) return { ok: false, brokenAt: i };
    prevHash = r.hash;
  }
  return { ok: true };
}
