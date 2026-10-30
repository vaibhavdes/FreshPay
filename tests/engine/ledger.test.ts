import { describe, expect, it } from 'vitest';
import { appendReceipt, canonicalJson, GENESIS_HASH, verifyChain, type Receipt } from '@/lib/engine/ledger';

function chain(): Receipt[] {
  const intent = appendReceipt(null, { kind: 'INTENT', key: 'c1/p1/INPUTS/release/v1', cents: 4500 });
  const result = appendReceipt(intent, { kind: 'RESULT', key: 'c1/p1/INPUTS/release/v1', payoutBatchId: 'B1' });
  const next = appendReceipt(result, { kind: 'INTENT', key: 'c1/p1/HARVEST/release/v1', cents: 9000 });
  return [intent, result, next];
}

describe('canonicalJson', () => {
  it('is independent of key order and drops undefined fields', () => {
    expect(canonicalJson({ b: 1, a: [true, null, { d: 'x', c: undefined }] })).toBe(canonicalJson({ a: [true, null, { d: 'x' }], b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('refuses values JSON cannot represent', () => {
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
  });
});

describe('hash-chained ledger', () => {
  it('links each receipt to the previous hash', () => {
    const [first, second] = chain();
    expect(first.seq).toBe(0);
    expect(first.prevHash).toBe(GENESIS_HASH);
    expect(second.prevHash).toBe(first.hash);
    expect(verifyChain(chain())).toEqual({ ok: true });
  });

  it('detects an edited payload', () => {
    const receipts = chain();
    receipts[1] = { ...receipts[1], payload: { kind: 'RESULT', key: 'c1/p1/INPUTS/release/v1', payoutBatchId: 'FORGED' } };
    expect(verifyChain(receipts)).toEqual({ ok: false, brokenAt: 1 });
  });

  it('detects a removed receipt', () => {
    const [first, , third] = chain();
    expect(verifyChain([first, third])).toEqual({ ok: false, brokenAt: 1 });
  });

  it('detects a receipt re-linked to the wrong parent', () => {
    const [first, second] = chain();
    const relinked = { ...second, seq: 1, prevHash: GENESIS_HASH };
    expect(verifyChain([first, relinked])).toEqual({ ok: false, brokenAt: 1 });
  });
});
