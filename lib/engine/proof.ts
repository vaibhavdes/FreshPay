import { distanceToRingMeters, pointInRing, type LngLat } from './geo';
import type { PlotMilestone } from './stateMachine';

// Independent signals that back up (or question) a claim beyond the code, GPS and AI reading.
// PASS supports the claim, WARN contradicts it and holds the payment for a person, and UNKNOWN
// means there was nothing to check: it neither helps nor holds.
export type SignalStatus = 'PASS' | 'WARN' | 'UNKNOWN';
export type SignalId = 'PHOTO_LOCATION' | 'PHOTO_TIME' | 'GPS_ACCURACY' | 'WEATHER' | 'SATELLITE' | 'PHOTO_ORIGIN';
export type ProofSignal = { id: SignalId; status: SignalStatus; detail: string };

const DAY = 24 * 60 * 60_000;

export const SIGNAL_LABELS: Record<SignalId, string> = {
  PHOTO_LOCATION: 'Where the camera says',
  PHOTO_TIME: 'When the camera says',
  GPS_ACCURACY: 'Phone location accuracy',
  WEATHER: 'Weather that day',
  SATELLITE: 'Satellite view of the farm',
  PHOTO_ORIGIN: 'What the file says made it',
};

export function photoLocationSignal(location: LngLat | null, ring: readonly LngLat[]): ProofSignal {
  if (!location) return { id: 'PHOTO_LOCATION', status: 'UNKNOWN', detail: 'The photo carries no location.' };
  const metres = pointInRing(location, ring) ? 0 : Math.round(distanceToRingMeters(location, ring));
  if (metres <= 500) return { id: 'PHOTO_LOCATION', status: 'PASS', detail: metres ? `Taken ${metres} m from the farm edge.` : 'Taken on the farm.' };
  if (metres > 2000) return { id: 'PHOTO_LOCATION', status: 'WARN', detail: `Taken ${(metres / 1000).toFixed(1)} km from the farm.` };
  return { id: 'PHOTO_LOCATION', status: 'UNKNOWN', detail: `Taken ${metres} m from the farm edge, too close to call.` };
}

// Camera clocks carry no time zone, so only whole days are compared.
export function photoTimeSignal(takenAt: string | null, now: number): ProofSignal {
  const at = takenAt ? Date.parse(`${takenAt}Z`) : NaN;
  if (Number.isNaN(at)) return { id: 'PHOTO_TIME', status: 'UNKNOWN', detail: 'The photo carries no date.' };
  const days = Math.round(Math.abs(now - at) / DAY);
  if (days <= 2) return { id: 'PHOTO_TIME', status: 'PASS', detail: 'Taken in the last two days.' };
  if (days > 7) return { id: 'PHOTO_TIME', status: 'WARN', detail: `Taken ${days} days ago, before today's code was issued.` };
  return { id: 'PHOTO_TIME', status: 'UNKNOWN', detail: `Taken ${days} days ago.` };
}

export function gpsAccuracySignal(accuracyM: number | null): ProofSignal {
  if (accuracyM === null) return { id: 'GPS_ACCURACY', status: 'UNKNOWN', detail: 'The phone gave no accuracy.' };
  const metres = Math.round(accuracyM);
  if (metres <= 100) return { id: 'GPS_ACCURACY', status: 'PASS', detail: `Located to within ${metres} m.` };
  if (metres > 500) return { id: 'GPS_ACCURACY', status: 'WARN', detail: `Located only to within ${metres} m, too rough to place on the farm.` };
  return { id: 'GPS_ACCURACY', status: 'UNKNOWN', detail: `Located to within ${metres} m.` };
}

// Fertiliser and sprays aren't put on in a downpour: heavy rain on the claim day questions them.
const RAIN_SENSITIVE: readonly PlotMilestone[] = ['INPUTS', 'CROP_CARE'];
const HEAVY_RAIN_MM = 50;

export function weatherSignal(milestone: PlotMilestone, rainTodayMm: number | null): ProofSignal {
  if (rainTodayMm === null) return { id: 'WEATHER', status: 'UNKNOWN', detail: 'No weather reading for the farm.' };
  const rain = Math.round(rainTodayMm);
  if (RAIN_SENSITIVE.includes(milestone) && rain >= HEAVY_RAIN_MM) {
    return { id: 'WEATHER', status: 'WARN', detail: `${rain} mm of rain at the farm today, when this work is rarely done.` };
  }
  return { id: 'WEATHER', status: 'PASS', detail: rain ? `${rain} mm of rain at the farm today.` : 'Dry at the farm today.' };
}

export const signalWarnings = (signals: readonly ProofSignal[]) => signals.filter((s) => s.status === 'WARN');

// AI image tools (OpenAI, Adobe Firefly, Google and others) label their output with the IPTC digital
// source type "trainedAlgorithmicMedia", in C2PA Content Credentials or XMP. The match is case
// sensitive on purpose, so "compositeWithTrainedAlgorithmicMedia" (an edit) does not count. Absence
// proves nothing, so only a positive finding becomes a signal.
const AI_SOURCE_TYPE = 'trainedAlgorithmicMedia';

export function photoOriginSignal(bytes: Uint8Array): ProofSignal | null {
  if (!Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(AI_SOURCE_TYPE)) return null;
  return { id: 'PHOTO_ORIGIN', status: 'WARN', detail: "The file's own credentials say an AI image generator made it." };
}
