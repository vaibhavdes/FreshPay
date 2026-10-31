import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { runOp } from '@/lib/services/ops';
import { freshDb } from '../helpers';

let db: Db;

beforeEach(async () => {
  db = await freshDb();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('runOp', () => {
  it('retries a failed call with the same PayPal-Request-Id and gives a new action a fresh one', async () => {
    const seen: string[] = [];
    const succeed = (paypalId: string) => async (requestId: string) => {
      seen.push(requestId);
      return { paypalId, completed: true };
    };

    await expect(
      runOp(db, { op: 'payouts.batch', key: 'contract-1/plot-1/INPUTS/release/v1' }, async (requestId) => {
        seen.push(requestId);
        throw new TypeError('fetch failed');
      }),
    ).rejects.toThrow();
    const { op } = await runOp(db, { op: 'payouts.batch', key: 'contract-1/plot-1/INPUTS/release/v1' }, succeed('BATCH-1'));
    await runOp(db, { op: 'payouts.batch', key: 'contract-1/plot-1/CROP_CARE/release/v1' }, succeed('BATCH-2'));

    expect(op.status).toBe('COMPLETED');
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).not.toBe(seen[0]);
  });
});
