import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/client';
import { IDLE_MS, noteWrite, restoreIfIdle } from '@/lib/services/demo-reset';

const settings = vi.hoisted(() => ({ SANDBOX_TOOLS: true }));
vi.mock('@/lib/env', () => ({ env: () => settings }));

const db = {} as Db;

describe('restoring the recorded seasons', () => {
  it('waits until nobody has changed anything for a while, then restores once', async () => {
    settings.SANDBOX_TOOLS = true;
    const restore = vi.fn(async () => undefined);
    noteWrite(1_000);
    expect(await restoreIfIdle(db, 1_000 + IDLE_MS - 1, restore)).toBe(false);
    expect(await restoreIfIdle(db, 1_000 + IDLE_MS, restore)).toBe(true);
    expect(await restoreIfIdle(db, 1_000 + 2 * IDLE_MS, restore)).toBe(false);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('never restores outside the hosted demo', async () => {
    settings.SANDBOX_TOOLS = false;
    const restore = vi.fn(async () => undefined);
    noteWrite(0);
    expect(await restoreIfIdle(db, IDLE_MS * 2, restore)).toBe(false);
    expect(restore).not.toHaveBeenCalled();
  });
});
