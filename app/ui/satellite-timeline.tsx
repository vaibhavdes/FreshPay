import type { LngLat } from '@/lib/engine/geo';
import { isTreeCrop } from '@/lib/engine/satellite';
import { viewBox } from '@/lib/oracles/satellite';

type View = { month: string; ndvi: number | null; clearShare: number; hasPicture: boolean; fetchedAt: number };

const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });

// The farm outline drawn over a picture of the farm's view box.
function Outline({ ring }: { ring: readonly LngLat[] }) {
  const [west, south, east, north] = viewBox(ring);
  const points = ring.map(([lng, lat]) => `${((lng - west) / (east - west)) * 100},${((north - lat) / (north - south)) * 100}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden className="absolute inset-0 size-full">
      <polygon points={points} fill="none" stroke="#fde047" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// A year of the farm from space: the clearest pictures, and how green it was month by month.
export function SatelliteTimeline({ plotId, ring, commodity, views }: { plotId: string; ring: readonly LngLat[]; commodity: string; views: readonly View[] }) {
  if (!views.length) return null;
  const pictures = views.filter((v) => v.hasPicture);
  const width = 300;
  const height = 60;
  const step = width / Math.max(views.length - 1, 1);

  return (
    <section className="mt-10 rounded-xl border border-contour bg-sheet p-5">
      <h2 className="text-xl font-bold">The farm from space</h2>
      <p className="mt-1 text-canopy-soft">
        Sentinel-2, one view a month. {isTreeCrop(commodity) ? 'For a tree crop this shows canopy and clearing, not each farm task.' : 'For a field crop this shows the crop growing and being harvested.'}
      </p>

      {pictures.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {pictures.map((v) => (
            <li key={v.month}>
              <div className="relative aspect-square overflow-hidden rounded-lg border border-contour bg-survey">
                {/* eslint-disable-next-line @next/next/no-img-element -- stored satellite picture served by our own route */}
                <img src={`/api/plots/${plotId}/satellite/${v.month}?v=${v.fetchedAt}`} alt={`Satellite picture of the farm, ${monthName(v.month)}`} className="size-full object-cover" />
                <Outline ring={ring} />
              </div>
              <p className="mt-1 text-sm">
                {monthName(v.month)} · greenness {v.ndvi?.toFixed(2) ?? '–'}
              </p>
            </li>
          ))}
        </ul>
      )}

      <svg viewBox={`-16 -6 ${width + 32} ${height + 24}`} className="mt-5 w-full max-w-xl" role="img" aria-label="Monthly vegetation index of the farm">
        <line x1={0} x2={width} y1={height} y2={height} stroke="var(--at-contour)" />
        {views.map((v, i) =>
          v.ndvi === null ? (
            <text key={v.month} x={i * step} y={height - 4} fontSize={9} textAnchor="middle" fill="var(--at-canopy-soft)">
              ☁
            </text>
          ) : (
            <circle key={v.month} cx={i * step} cy={height - Math.max(0, Math.min(1, v.ndvi)) * height} r={3} fill={v.clearShare >= 0.3 ? 'var(--at-leaf)' : 'var(--at-contour)'}>
              <title>{`${monthName(v.month)}: greenness ${v.ndvi.toFixed(2)}, ${Math.round(v.clearShare * 100)}% of the farm in view`}</title>
            </circle>
          ),
        )}
        {views.map((v, i) =>
          i % 3 === 0 || (i === views.length - 1 && i % 3 === 2) ? (
            <text key={`${v.month}-label`} x={i * step} y={height + 14} fontSize={9} textAnchor="middle" fill="var(--at-canopy-soft)">
              {monthName(v.month)}
            </text>
          ) : null,
        )}
      </svg>
      <p className="mt-2 text-xs text-canopy-soft">☁ the farm was under cloud that month. Contains modified Copernicus Sentinel data {views[0].month.slice(0, 4)}–{views.at(-1)!.month.slice(0, 4)}.</p>
    </section>
  );
}
