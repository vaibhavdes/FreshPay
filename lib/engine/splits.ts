export type Share = { id: string; weight: number };
export type Allocation = { id: string; cents: number };

// Largest-remainder split in integer cents: the parts always sum to the total exactly,
// and ties go to the earlier share so the result is deterministic.
export function allocate(totalCents: number, shares: readonly Share[]): Allocation[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new RangeError(`Invalid amount: ${totalCents}`);
  if (shares.length === 0) throw new RangeError('No shares to allocate');
  if (new Set(shares.map((s) => s.id)).size !== shares.length) throw new RangeError('Duplicate share ids');

  const totalWeight = shares.reduce((sum, s) => {
    if (!Number.isSafeInteger(s.weight) || s.weight < 0) throw new RangeError(`Invalid weight for ${s.id}: ${s.weight}`);
    return sum + s.weight;
  }, 0);
  if (totalWeight === 0) throw new RangeError('Shares have zero total weight');

  const parts = shares.map((s, index) => {
    const scaled = totalCents * s.weight;
    if (!Number.isSafeInteger(scaled)) throw new RangeError(`Amount too large to split: ${totalCents}`);
    return { id: s.id, index, cents: Math.floor(scaled / totalWeight), remainder: scaled % totalWeight };
  });

  let left = totalCents - parts.reduce((sum, p) => sum + p.cents, 0);
  for (const part of [...parts].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (left === 0) break;
    part.cents += 1;
    left -= 1;
  }

  return parts.map(({ id, cents }) => ({ id, cents }));
}
