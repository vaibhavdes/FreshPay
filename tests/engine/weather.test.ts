import { describe, expect, it } from 'vitest';
import { classifyWeather, type DailyWeather } from '@/lib/engine/weather';

const days = (values: [number, number][]): DailyWeather[] =>
  values.map(([precipitationMm, weatherCode], i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, precipitationMm, weatherCode }));

describe('classifyWeather', () => {
  it('finds a hailstorm from the WMO weather code', () => {
    expect(classifyWeather(days([[3, 61], [22, 96], [0, 0]]))).toEqual({ event: 'HAIL', dates: ['2026-11-02'], totalPrecipitationMm: 25 });
  });

  it('finds a flood from one extreme day', () => {
    expect(classifyWeather(days([[5, 61], [130, 65]]))).toMatchObject({ event: 'FLOOD', dates: ['2026-11-02'] });
  });

  it('finds a flood from three heavy days in a row', () => {
    expect(classifyWeather(days([[70, 65], [70, 65], [70, 65]]))).toMatchObject({ event: 'FLOOD', dates: ['2026-11-03'] });
  });

  it('finds a drought over four dry weeks', () => {
    const dry = days(Array.from({ length: 30 }, () => [0.2, 0] as [number, number]));
    expect(classifyWeather(dry)).toEqual({ event: 'DROUGHT', dates: ['2026-11-01', '2026-11-30'], totalPrecipitationMm: 6 });
  });

  it('reports normal weather as no event', () => {
    expect(classifyWeather(days([[4, 61], [0, 1], [12, 63]]))).toEqual({ event: 'NONE', dates: [], totalPrecipitationMm: 16 });
  });
});
