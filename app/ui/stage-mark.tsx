import type { BillRule } from '@/lib/engine/gate';
import { allocate, type Share } from '@/lib/engine/splits';

export type StageStatus = 'paid' | 'held' | 'refused' | 'open' | 'later';

type StageLike = { state: string; reasons: readonly string[]; opensAt: number; closesAt: number };

export function stageStatus(stage: StageLike, isNext: boolean, now = Date.now()): StageStatus {
  if (stage.state === 'RELEASED') return 'paid';
  if (stage.state === 'REVIEW') return 'held';
  if (stage.reasons.length) return 'refused';
  return isNext && now >= stage.opensAt && now <= stage.closesAt ? 'open' : 'later';
}

export const STATUS_TEXT: Record<StageStatus, string> = {
  paid: 'Paid',
  held: 'Held for a person',
  refused: 'Refused',
  open: 'Open now',
  later: 'Not open yet',
};

const MARK: Record<StageStatus, { ring: string; glyph: string }> = {
  paid: { ring: 'bg-leaf text-sheet', glyph: '✓' },
  held: { ring: 'bg-monsoon text-sheet', glyph: '…' },
  refused: { ring: 'bg-cherry text-sheet', glyph: '✕' },
  open: { ring: 'border-2 border-leaf bg-sheet text-leaf', glyph: '●' },
  later: { ring: 'border border-contour bg-sheet text-canopy-soft', glyph: '' },
};

export function StageMark({ status, size = 'md' }: { status: StageStatus; size?: 'md' | 'lg' }) {
  const { ring, glyph } = MARK[status];
  return (
    <span aria-label={STATUS_TEXT[status]} className={`grid shrink-0 place-items-center rounded-full font-bold ${ring} ${size === 'lg' ? 'size-9 text-base' : 'size-7 text-sm'}`}>
      {glyph}
    </span>
  );
}

// What the farmer takes home from a stage: the labour allowance on a bill stage, their share otherwise.
export function farmerCents(stage: { trancheCents: number; shares: readonly Share[]; rule: BillRule | null }, farmerId: string): number {
  if (stage.rule) return stage.rule.labourCents;
  return allocate(stage.trancheCents, stage.shares).find((s) => s.id === farmerId)?.cents ?? 0;
}
