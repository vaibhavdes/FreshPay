'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BILL_LABEL } from '@/lib/claim-copy';
import type { PayoutCountry } from '@/lib/countries';
import type { SupplierKind } from '@/lib/engine/gate';
import { formatUsd } from '@/lib/format';
import { stagesPercent, type CropTemplate } from '@/lib/programmes';

const input = 'mt-1 w-full rounded-md border border-contour bg-sheet px-3 py-2';

const inThreeWeeks = () => new Date(Date.now() + 21 * 24 * 60 * 60_000).toISOString().slice(0, 10);

export function PostForm({ templates, countries }: { templates: CropTemplate[]; countries: PayoutCountry[] }) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates[0].id);
  const template = templates.find((t) => t.id === templateId)!;
  const [company, setCompany] = useState('');
  const [companyCountry, setCompanyCountry] = useState('');
  const [country, setCountry] = useState(template.country);
  const [region, setRegion] = useState(template.region);
  const [hectares, setHectares] = useState(50);
  const [yieldKg, setYieldKg] = useState(template.terms.yieldKgPerHa);
  const [price, setPrice] = useState(template.terms.priceCentsPerKg / 100);
  const [advance, setAdvance] = useState(template.terms.advancePercent);
  const [applyBy, setApplyBy] = useState(inThreeWeeks);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(id: string) {
    const next = templates.find((t) => t.id === id)!;
    setTemplateId(id);
    setCountry(next.country);
    setRegion(next.region);
    setYieldKg(next.terms.yieldKgPerHa);
    setPrice(next.terms.priceCentsPerKg / 100);
    setAdvance(next.terms.advancePercent);
  }

  const valuePerHa = Math.round(yieldKg * price) * 100;
  const staged = stagesPercent(template.terms);
  const selectedCountry = useMemo(() => countries.find((c) => c.code === country), [countries, country]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, companyCountry, country, region, templateId, hectaresWanted: hectares, yieldKgPerHa: yieldKg, priceCentsPerKg: Math.round(price * 100), advancePercent: advance, applyBy }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    setBusy(false);
    if (res.ok && body.id) router.push(`/opportunities/${body.id}`);
    else setError(body.error ?? 'The opportunity could not be posted. Check the details and try again.');
  }

  return (
    <form onSubmit={submit} className="mt-8 grid gap-10">
      <fieldset>
        <legend className="text-xl font-bold">Crop</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {templates.map((t) => (
            <label key={t.id} className={`cursor-pointer rounded-full border px-4 py-2 ${t.id === templateId ? 'border-leaf bg-leaf-wash font-semibold' : 'border-contour'}`}>
              <input type="radio" name="template" value={t.id} checked={t.id === templateId} onChange={() => pick(t.id)} className="sr-only" />
              {t.crop}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-8 md:grid-cols-2">
        <fieldset className="grid content-start gap-4">
          <legend className="text-xl font-bold">Your company</legend>
          <label className="font-semibold">
            Name
            <input required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Fictional names only in the sandbox" className={input} />
          </label>
          <label className="font-semibold">
            Based in
            <input required value={companyCountry} onChange={(e) => setCompanyCountry(e.target.value)} placeholder="Belgium" className={input} />
          </label>
          <label className="font-semibold">
            Farmers in
            <select value={country} onChange={(e) => setCountry(e.target.value)} className={input}>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block font-normal text-canopy-soft">Only countries where PayPal Payouts reach farmers.{selectedCountry?.note ? ` ${selectedCountry.note}.` : ''}</span>
          </label>
          <label className="font-semibold">
            Region
            <input required value={region} onChange={(e) => setRegion(e.target.value)} className={input} />
          </label>
        </fieldset>

        <fieldset className="grid content-start gap-4">
          <legend className="text-xl font-bold">Terms</legend>
          <div className="grid grid-cols-2 gap-4">
            <label className="font-semibold">
              Hectares wanted
              <input type="number" min={0.5} step={0.5} required value={hectares} onChange={(e) => setHectares(Number(e.target.value))} className={input} />
            </label>
            <label className="font-semibold">
              Apply by
              <input type="date" required value={applyBy} onChange={(e) => setApplyBy(e.target.value)} className={input} />
            </label>
            <label className="font-semibold">
              Expected yield, kg/ha
              <input type="number" min={1} required value={yieldKg} onChange={(e) => setYieldKg(Number(e.target.value))} className={input} />
            </label>
            <label className="font-semibold">
              Price, US$ per kg
              <input type="number" min={0.01} step={0.01} required value={price} onChange={(e) => setPrice(Number(e.target.value))} className={input} />
            </label>
            <label className="col-span-2 font-semibold">
              Paid ahead: {advance}% of the crop value
              <input type="range" min={staged} max={80} value={advance} onChange={(e) => setAdvance(Number(e.target.value))} className="mt-2 w-full accent-[var(--at-leaf)]" />
            </label>
          </div>
          <p className="text-sm text-canopy-soft">Starting figures: {template.basis}.</p>
          <p className="rounded-md bg-leaf-wash px-4 py-3">
            A hectare is worth about <strong>{formatUsd(valuePerHa)}</strong>; <strong>{formatUsd(Math.round((valuePerHa * advance) / 100))}</strong> of it is paid through the season.
          </p>
        </fieldset>
      </div>

      <section>
        <h2 className="text-xl font-bold">Stages</h2>
        <p className="mt-1 text-canopy-soft">Each bill is paid what it says, up to its cap, straight to whoever issued it. The farmer gets a fixed share on top.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left">
            <thead className="text-sm text-canopy-soft">
              <tr>
                <th className="py-2 pr-4 font-semibold">Stage</th>
                <th className="py-2 pr-4 font-semibold">Window</th>
                <th className="py-2 pr-4 font-semibold">Bills paid, up to</th>
                <th className="py-2 font-semibold">Farmer</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(template.terms.stages).map(([type, s]) => (
                <tr key={type} className="border-t border-contour">
                  <td className="py-2 pr-4 font-semibold">{s.label}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {s.opensAt} to {s.closesAt}
                  </td>
                  <td className="py-2 pr-4">
                    {type === 'PLOT_VERIFIED'
                      ? '–'
                      : (Object.entries(s.caps) as [SupplierKind, number][]).map(([kind, cap]) => `${BILL_LABEL[kind]} ${cap}%`).join(', ')}
                  </td>
                  <td className="py-2">{type === 'PLOT_VERIFIED' ? '$25' : `${s.farmerPercent}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div>
        {error && <p role="status" className="mb-4 rounded-md bg-cherry-wash px-4 py-3 text-cherry">{error}</p>}
        <button type="submit" disabled={busy} className="rounded-md bg-canopy px-5 py-3 font-semibold text-sheet hover:bg-canopy/90 disabled:opacity-50">
          {busy ? 'Posting' : 'Post the opportunity'}
        </button>
      </div>
    </form>
  );
}
