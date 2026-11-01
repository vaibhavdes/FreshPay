import { describe, expect, it } from 'vitest';
import { billDateFits, billFingerprint, hashDistance, isSamePhoto, issuerMatches } from '@/lib/engine/fraud';

const DAY = 24 * 60 * 60_000;

describe('photo hashes', () => {
  it('counts differing bits and treats near matches as the same photo', () => {
    expect(hashDistance('ffff0000ffff0000', 'ffff0000ffff0000')).toBe(0);
    expect(hashDistance('ffff0000ffff0000', 'fffe0000ffff0001')).toBe(2);
    expect(isSamePhoto('ffff0000ffff0000', 'fffe0000ffff0001')).toBe(true);
    expect(isSamePhoto('ffff0000ffff0000', '0000ffff0000ffff')).toBe(false);
  });
});

describe('issuerMatches', () => {
  it('matches on the distinctive words of the name, ignoring business words and case', () => {
    expect(issuerMatches('MALNAD AGRO INPUTS PVT LTD', 'Malnad Agro Inputs')).toBe(true);
    expect(issuerMatches('Sri Ganesh Traders', 'Malnad Agro Inputs')).toBe(false);
    expect(issuerMatches('Traders & Co', 'Malnad Agro Inputs')).toBeNull();
    expect(issuerMatches(null, 'Malnad Agro Inputs')).toBeNull();
  });
});

describe('billFingerprint', () => {
  const bill = { kind: 'INPUTS', cents: 3429, issuer: 'Malnad Agro Inputs', number: 'MAI/2291', date: '2026-10-28' };

  it('identifies one bill however its number is written', () => {
    expect(billFingerprint(bill)).toBe(billFingerprint({ ...bill, number: 'mai-2291', date: null }));
    expect(billFingerprint(bill)).not.toBe(billFingerprint({ ...bill, number: 'MAI/2292' }));
  });

  it('falls back to issuer and date, and gives up when too little was read', () => {
    expect(billFingerprint({ ...bill, number: null })).toBe('INPUTS|malnad agro inputs|2026-10-28|3429');
    expect(billFingerprint({ ...bill, number: null, date: null })).toBeNull();
    expect(billFingerprint({ kind: 'INPUTS', cents: 3429, date: '2026-10-28' })).toBeNull();
  });
});

describe('billDateFits', () => {
  const opensAt = Date.UTC(2026, 7, 1);
  const now = Date.UTC(2026, 10, 3);

  it('accepts bills from just before the stage opens up to today', () => {
    expect(billDateFits('2026-07-25', opensAt, now)).toBe(true);
    expect(billDateFits('2026-11-03', opensAt, now)).toBe(true);
    expect(billDateFits('2026-06-01', opensAt, now)).toBe(false);
    expect(billDateFits('2026-11-20', opensAt, now + DAY)).toBe(false);
    expect(billDateFits('28/10/2026', opensAt, now)).toBeNull();
    expect(billDateFits(null, opensAt, now)).toBeNull();
  });
});
