export type DailyWeather = { date: string; precipitationMm: number; weatherCode: number };

export type WeatherEvent = 'HAIL' | 'FLOOD' | 'DROUGHT' | 'NONE';

export type WeatherFinding = { event: WeatherEvent; dates: string[]; totalPrecipitationMm: number };

// WMO weather codes 96 and 99: thunderstorm with hail.
const HAIL_CODES = new Set([96, 99]);
const FLOOD_DAY_MM = 100;
const FLOOD_THREE_DAY_MM = 200;
const DROUGHT_MIN_DAYS = 28;
const DROUGHT_MAX_MM = 10;

export function classifyWeather(days: readonly DailyWeather[]): WeatherFinding {
  const totalPrecipitationMm = Math.round(days.reduce((sum, d) => sum + d.precipitationMm, 0) * 10) / 10;

  const hail = days.filter((d) => HAIL_CODES.has(d.weatherCode)).map((d) => d.date);
  if (hail.length) return { event: 'HAIL', dates: hail, totalPrecipitationMm };

  const flood = days
    .filter((d, i) => d.precipitationMm >= FLOOD_DAY_MM || days.slice(Math.max(0, i - 2), i + 1).reduce((s, x) => s + x.precipitationMm, 0) >= FLOOD_THREE_DAY_MM)
    .map((d) => d.date);
  if (flood.length) return { event: 'FLOOD', dates: flood, totalPrecipitationMm };

  if (days.length >= DROUGHT_MIN_DAYS && totalPrecipitationMm < DROUGHT_MAX_MM) {
    return { event: 'DROUGHT', dates: [days[0].date, days.at(-1)!.date], totalPrecipitationMm };
  }
  return { event: 'NONE', dates: [], totalPrecipitationMm };
}
