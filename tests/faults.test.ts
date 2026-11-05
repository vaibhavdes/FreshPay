import { describe, expect, it } from 'vitest';
import { armedFault, armFault, takeFault } from '@/lib/faults';

describe('test faults', () => {
  it('only fail the season they were armed for, once', () => {
    armFault('season-a', 'PAYOUT_ITEM_FAILS');
    expect(takeFault('season-b', 'PAYOUT_ITEM_FAILS')).toBe(false);
    expect(armedFault('season-b')).toBeNull();
    expect(takeFault('season-a', 'PAYOUT_ITEM_FAILS')).toBe(true);
    expect(takeFault('season-a', 'PAYOUT_ITEM_FAILS')).toBe(false);
  });
});
