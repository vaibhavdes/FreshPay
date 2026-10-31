import { describe, expect, it } from 'vitest';
import type { LngLat } from '@/lib/engine/geo';
import { gpsAccuracySignal, photoLocationSignal, photoTimeSignal, signalWarnings, weatherSignal } from '@/lib/engine/proof';

const RING: LngLat[] = [
  [75.77, 13.32],
  [75.772, 13.32],
  [75.772, 13.322],
  [75.77, 13.322],
];
const NOW = Date.UTC(2026, 10, 3, 6, 0);

describe('proof signals', () => {
  it('places the camera on the farm, near it, or far away', () => {
    expect(photoLocationSignal([75.771, 13.321], RING).status).toBe('PASS');
    expect(photoLocationSignal([75.775, 13.321], RING)).toMatchObject({ status: 'PASS', detail: expect.stringContaining('m from the farm edge') });
    expect(photoLocationSignal([75.785, 13.321], RING).status).toBe('UNKNOWN');
    expect(photoLocationSignal([75.9, 13.321], RING).status).toBe('WARN');
    expect(photoLocationSignal(null, RING).status).toBe('UNKNOWN');
  });

  it('accepts a photo from the last two days and questions an old one', () => {
    expect(photoTimeSignal('2026-11-03T08:00:00', NOW).status).toBe('PASS');
    expect(photoTimeSignal('2026-10-29T08:00:00', NOW).status).toBe('UNKNOWN');
    expect(photoTimeSignal('2026-10-01T08:00:00', NOW).status).toBe('WARN');
    expect(photoTimeSignal(null, NOW).status).toBe('UNKNOWN');
  });

  it('rates how precisely the phone was located', () => {
    expect(gpsAccuracySignal(12).status).toBe('PASS');
    expect(gpsAccuracySignal(250).status).toBe('UNKNOWN');
    expect(gpsAccuracySignal(1200).status).toBe('WARN');
    expect(gpsAccuracySignal(null).status).toBe('UNKNOWN');
  });

  it('questions spraying or fertilising in a downpour, but not harvest', () => {
    expect(weatherSignal('CROP_CARE', 72).status).toBe('WARN');
    expect(weatherSignal('HARVEST', 72).status).toBe('PASS');
    expect(weatherSignal('INPUTS', 3).status).toBe('PASS');
    expect(weatherSignal('INPUTS', null).status).toBe('UNKNOWN');
  });

  it('lists only the warnings', () => {
    expect(signalWarnings([weatherSignal('CROP_CARE', 72), gpsAccuracySignal(5)]).map((s) => s.id)).toEqual(['WEATHER']);
  });
});
