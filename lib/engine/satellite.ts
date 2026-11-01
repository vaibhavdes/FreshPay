import type { ProofSignal } from './proof';
import type { PlotMilestone } from './stateMachine';

// One month of Sentinel-2 over a farm: the mean vegetation index (NDVI) of its cloud-free
// pixels, and the share of the farm the satellite could see. NDVI is null when clouds hid it all.
export type MonthlyView = { month: string; ndvi: number | null; clearShare: number };

// Tree crops keep a canopy all year, so a sharp fall means clearing or heavy pruning. Field crops
// go from bare soil to full cover and back within a season.
const TREE_CROPS = new Set(['coffee', 'cocoa', 'tea', 'rubber', 'oil palm']);
export const isTreeCrop = (commodity: string) => TREE_CROPS.has(commodity.toLowerCase());

// At 10 m a smallholding is a few hundred pixels; less than a third of it in view says little.
const MIN_CLEAR_SHARE = 0.3;
const RECENT_MONTHS = 3;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const ndviText = (n: number) => `greenness ${n.toFixed(2)}`;

// What the satellite says about a claim. It can show cover, growth and clearing, never a
// fertiliser round or a spray, so it only ever supports or questions the farmer's photo.
export function satelliteSignal(commodity: string, milestone: PlotMilestone, views: readonly MonthlyView[]): ProofSignal {
  const ordered = [...views].sort((a, b) => a.month.localeCompare(b.month));
  const clear = (v: MonthlyView): v is MonthlyView & { ndvi: number } => v.ndvi !== null && v.clearShare >= MIN_CLEAR_SHARE;
  const seen = ordered.filter(clear);
  const recent = ordered.slice(-RECENT_MONTHS).filter(clear);
  if (!recent.length) return { id: 'SATELLITE', status: 'UNKNOWN', detail: seen.length ? 'Clouds hid the farm in recent months.' : 'No clear satellite view of the farm yet.' };
  const latest = recent.at(-1)!;

  if (isTreeCrop(commodity)) {
    const usual = median(seen.map((v) => v.ndvi));
    if (latest.ndvi < 0.3) return { id: 'SATELLITE', status: 'WARN', detail: `Little green cover on the farm in ${latest.month} (${ndviText(latest.ndvi)}).` };
    if (latest.ndvi < usual - 0.2) return { id: 'SATELLITE', status: 'WARN', detail: `Canopy fell sharply in ${latest.month} (${ndviText(latest.ndvi)}, usually ${usual.toFixed(2)}): possible clearing.` };
    return { id: 'SATELLITE', status: 'PASS', detail: `Green canopy as in the rest of the year (${ndviText(latest.ndvi)} in ${latest.month}).` };
  }

  if (milestone === 'CROP_CARE' || milestone === 'HARVEST') {
    const peak = Math.max(...seen.map((v) => v.ndvi));
    if (peak < 0.4) return { id: 'SATELLITE', status: 'WARN', detail: `No crop growth seen this season (highest ${ndviText(peak)}).` };
    return { id: 'SATELLITE', status: 'PASS', detail: `Crop growth seen this season (up to ${ndviText(peak)}).` };
  }
  return { id: 'SATELLITE', status: 'PASS', detail: `Field in view (${ndviText(latest.ndvi)} in ${latest.month}).` };
}
