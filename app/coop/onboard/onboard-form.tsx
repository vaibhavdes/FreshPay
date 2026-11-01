'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ringAreaHectares, type LngLat } from '@/lib/engine/geo';
import { SatelliteMap } from '../../ui/satellite-map';

const MAX_ACCURACY_M = 30;
const MIN_STEP_M = 3;

const metersBetween = ([lng1, lat1]: LngLat, [lng2, lat2]: LngLat) => {
  const x = (lng2 - lng1) * 111_320 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  const y = (lat2 - lat1) * 110_574;
  return Math.hypot(x, y);
};

// "13.2752, 75.6401" per line, latitude first as phones and maps show it.
function parseCoordinates(text: string): LngLat[] {
  return text
    .split('\n')
    .map((line) => line.split(/[,\s]+/).filter(Boolean).map(Number))
    .filter((parts) => parts.length === 2 && parts.every(Number.isFinite))
    .map(([lat, lng]) => [lng, lat] as const);
}

type Result = { plotId: string; areaHa: number; valueCents: number; landCheck: 'PASS' | 'REVIEW' | 'FAIL' };

const LAND_COPY = {
  PASS: 'Land check passed: no forest cleared since 2020.',
  REVIEW: 'The land check will be done by a person before any payment.',
  FAIL: 'Satellite data shows forest cleared on this plot after 2020. Its payments will be refused.',
} as const;

type SignedIn = { name: string; email: string; verified: boolean };

// crop: set when a farmer joins an opportunity, whose terms fix the crop; otherwise the coffee
// season asks for the variety. signInHref offers Log in with PayPal; signedIn is the account
// the farmer signed in with, which then receives the payments.
export function OnboardForm({ contractId, crop, signInHref, signedIn }: { contractId: string; crop?: string; signInHref?: string; signedIn?: SignedIn | null }) {
  const [farmerName, setFarmerName] = useState(signedIn?.name ?? '');
  const [paypalEmail, setPaypalEmail] = useState(signedIn?.email ?? '');
  const [plotName, setPlotName] = useState('');
  const [variety, setVariety] = useState<'arabica' | 'robusta'>('arabica');
  const [ring, setRing] = useState<LngLat[]>([]);
  const [pasted, setPasted] = useState('');
  const [walking, setWalking] = useState(false);
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const watchId = useRef<number | null>(null);

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
  }, []);

  function startWalk() {
    if (!('geolocation' in navigator)) return setGpsNote('This phone has no location. Paste the corner coordinates instead.');
    setRing([]);
    setWalking(true);
    setGpsNote('Walk slowly along the edge of the plot and come back to where you started.');
    watchId.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (coords.accuracy > MAX_ACCURACY_M) return setGpsNote(`Waiting for a better signal (within ${Math.round(coords.accuracy)} m).`);
        const point: LngLat = [coords.longitude, coords.latitude];
        setRing((points) => (points.length && metersBetween(points.at(-1)!, point) < MIN_STEP_M ? points : [...points, point]));
      },
      () => setGpsNote('Location is off. Allow it for this site, or paste the corner coordinates.'),
      { enableHighAccuracy: true, maximumAge: 0 },
    );
  }

  function stopWalk() {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setWalking(false);
    setGpsNote(null);
  }

  function applyCoordinates(text: string) {
    setPasted(text);
    setRing(parseCoordinates(text));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/plots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractId, farmerName, paypalEmail, plotName, ring, ...(!crop && { variety }) }),
    });
    const body = (await res.json().catch(() => ({}))) as Result & { error?: string };
    setBusy(false);
    if (res.ok) setResult(body);
    else setError(body.error ?? 'The plot could not be registered. Check the details and try again.');
  }

  const area = ring.length >= 3 ? ringAreaHectares(ring) : 0;
  const input = 'mt-1 w-full rounded-md border border-contour bg-sheet px-3 py-2';

  if (result) {
    return (
      <div role="status" className="rounded-lg border border-contour bg-sheet p-6">
        <h2 className="text-2xl font-bold">{plotName} is registered</h2>
        <p className="mt-2">
          {result.areaHa} ha, worth ${(result.valueCents / 100).toLocaleString('en-US')} this season. {LAND_COPY[result.landCheck]}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/m/${result.plotId}`} className="rounded-md bg-canopy px-4 py-2 font-semibold text-sheet hover:bg-canopy/90">
            Open the farmer&apos;s phone screen
          </Link>
          <Link href={`/farms/${result.plotId}`} className="rounded-md border border-canopy/25 px-4 py-2 font-semibold hover:border-canopy">
            Open the plot record
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-8 lg:grid-cols-2">
      <fieldset className="grid content-start gap-4">
        <legend className="text-xl font-bold">The farmer</legend>
        <label className="font-semibold">
          Name
          <input required value={farmerName} onChange={(e) => setFarmerName(e.target.value)} className={input} />
        </label>
        {signedIn ? (
          <p className="rounded-md bg-leaf-wash px-4 py-3">
            <span className="font-semibold">Signed in with PayPal as {signedIn.email}</span>
            <span className="block text-canopy-soft">{signedIn.verified ? 'Verified account. ' : ''}Payments for this plot go straight to this account.</span>
          </p>
        ) : (
          <>
            {signInHref && (
              <a href={signInHref} className="inline-flex items-center justify-center rounded-md bg-[#ffc439] px-4 py-2.5 font-semibold text-[#111]">
                Continue with PayPal
              </a>
            )}
            <label className="font-semibold">
              {signInHref ? 'Or type your PayPal email' : 'PayPal email'}
              <input required type="email" value={paypalEmail} onChange={(e) => setPaypalEmail(e.target.value)} className={input} />
              <span className="mt-1 block font-normal text-canopy-soft">Payments for this plot go to this PayPal account.</span>
            </label>
          </>
        )}
        <label className="font-semibold">
          Plot name
          <input required value={plotName} onChange={(e) => setPlotName(e.target.value)} placeholder="Hosakere, upper block" className={input} />
        </label>
        {crop ? (
          <p className="font-semibold">
            Crop grown <span className="mt-1 block font-normal">{crop}</span>
          </p>
        ) : (
          <label className="font-semibold">
            Coffee grown
            <select value={variety} onChange={(e) => setVariety(e.target.value as 'arabica' | 'robusta')} className={input}>
              <option value="arabica">Arabica</option>
              <option value="robusta">Robusta</option>
            </select>
          </label>
        )}
      </fieldset>

      <fieldset className="grid content-start gap-4">
        <legend className="text-xl font-bold">The plot outline</legend>
        <div className="flex flex-wrap gap-3">
          {walking ? (
            <button type="button" onClick={stopWalk} className="rounded-md bg-cherry px-4 py-2 font-semibold text-sheet">
              Finish walking ({ring.length} points)
            </button>
          ) : (
            <button type="button" onClick={startWalk} className="rounded-md bg-leaf px-4 py-2 font-semibold text-sheet hover:bg-canopy">
              Walk the boundary
            </button>
          )}
        </div>
        {gpsNote && <p className="text-canopy-soft">{gpsNote}</p>}
        <label className="font-semibold">
          Or paste the corners, one &ldquo;latitude, longitude&rdquo; per line
          <textarea value={pasted} onChange={(e) => applyCoordinates(e.target.value)} rows={5} className={`${input} font-mono`} />
        </label>
        {ring.length >= 3 && (
          <figure className="flex items-center gap-5 rounded-lg border border-contour bg-sheet p-4">
            <SatelliteMap plots={[{ id: 'new', name: plotName || 'New farm', ring, status: 'REVIEW' }]} width={300} title="The outline on satellite imagery" className="w-48 shrink-0" linked={false} />
            <figcaption>
              <p className="text-lg font-semibold tabular-nums">{area.toFixed(2)} ha</p>
              <p className="text-canopy-soft">{ring.length} corners. The satellite land check runs when you register.</p>
            </figcaption>
          </figure>
        )}
      </fieldset>

      <div className="lg:col-span-2">
        {error && <p role="status" className="mb-4 rounded-md bg-cherry-wash px-4 py-3 text-cherry">{error}</p>}
        <button type="submit" disabled={busy || walking || ring.length < 3} className="rounded-md bg-canopy px-5 py-3 font-semibold text-sheet hover:bg-canopy/90 disabled:opacity-50">
          {busy ? 'Registering' : crop ? 'Join with this farm' : 'Register farmer and plot'}
        </button>
      </div>
    </form>
  );
}
