import type { LngLat } from '../engine/geo';
import { classifyWeather, type DailyWeather, type WeatherFinding } from '../engine/weather';

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// The archive lags by about five days, so recent windows come from the forecast API's past days.
const ARCHIVE_LAG_DAYS = 5;

export async function fetchDailyWeather([lng, lat]: LngLat, startDate: string, endDate: string, today = new Date()): Promise<DailyWeather[]> {
  const lagCutoff = new Date(today.getTime() - ARCHIVE_LAG_DAYS * 86_400_000).toISOString().slice(0, 10);
  const url = new URL(endDate <= lagCutoff ? ARCHIVE_URL : FORECAST_URL);
  url.search = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    start_date: startDate,
    end_date: endDate,
    daily: 'precipitation_sum,weather_code',
    timezone: 'UTC',
  }).toString();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const { daily } = (await res.json()) as { daily: { time: string[]; precipitation_sum: (number | null)[]; weather_code: (number | null)[] } };
  return daily.time.map((date, i) => ({ date, precipitationMm: daily.precipitation_sum[i] ?? 0, weatherCode: daily.weather_code[i] ?? 0 }));
}

export type WeatherCheck = WeatherFinding & { source: string; location: LngLat; startDate: string; endDate: string };

export async function checkWeather(location: LngLat, startDate: string, endDate: string): Promise<WeatherCheck> {
  const finding = classifyWeather(await fetchDailyWeather(location, startDate, endDate));
  return { ...finding, source: 'Open-Meteo', location, startDate, endDate };
}

// Rain at the farm on the day of a claim, or null when Open-Meteo can't be reached in time.
export async function rainToday(location: LngLat, now = new Date()): Promise<number | null> {
  const day = now.toISOString().slice(0, 10);
  try {
    const [today] = await Promise.race([
      fetchDailyWeather(location, day, day, now),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Open-Meteo timed out')), 4000)),
    ]);
    return today?.precipitationMm ?? null;
  } catch {
    return null;
  }
}
