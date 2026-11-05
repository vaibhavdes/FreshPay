'use client';

import { useState } from 'react';
import { PERSON_COPY, type LotGrade } from '@/lib/engine/grading';

export type Graded = { grading: LotGrade; model: string; inputHash: string; notes: string };

export function LotGrader({ contractId, sampleSrc, sampleAlt, onUse }: { contractId: string; sampleSrc: string; sampleAlt: string; onUse?: (g: Graded) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Graded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = file ? URL.createObjectURL(file) : sampleSrc;

  async function grade() {
    setBusy(true);
    setError(null);
    setResult(null);
    const body = new FormData();
    if (file) body.set('photo', file);
    const res = await fetch(`/api/contracts/${contractId}/grade`, { method: 'POST', body });
    const json = (await res.json()) as { grading?: LotGrade; model?: string; inputHash?: string; reading?: { notes: string }; error?: string };
    if (!res.ok || !json.grading) setError(json.error ?? "The sample couldn't be graded.");
    else setResult({ grading: json.grading, model: json.model!, inputHash: json.inputHash!, notes: json.reading?.notes ?? '' });
    setBusy(false);
  }

  const g = result?.grading;
  return (
    <div className="rounded-xl border border-contour bg-survey p-4">
      <h3 className="font-bold">Grade a sample of the lot with AI</h3>
      <p className="mt-1 text-sm text-canopy-soft">
        Photograph a handful or heap of the delivered crop. Gemini estimates each defect; fixed grading rules turn that into a grade and quality %. It only suggests:
        you confirm the figure before anything is captured.
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-[12rem_1fr]">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen photo */}
        <img src={preview} alt={file ? 'The photo you chose' : sampleAlt} className="aspect-[3/2] w-full rounded-lg border border-contour object-cover" />
        <div className="flex flex-col gap-2">
          <label className="text-sm">
            <span className="text-canopy-soft">Your own photo (optional)</span>
            <input type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" />
          </label>
          <button type="button" onClick={grade} disabled={busy} className="self-start rounded-md bg-leaf px-4 py-2 font-semibold text-sheet hover:bg-canopy disabled:opacity-60">
            {busy ? 'Grading…' : file ? 'Grade this photo' : 'Grade the ready sample'}
          </button>
          {error && <p className="rounded-md bg-cherry-wash px-3 py-2 text-sm text-cherry">{error}</p>}
        </div>
      </div>

      {g && result && (
        <div className="mt-4 rounded-lg border border-contour bg-sheet p-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <p>
              <span className="text-canopy-soft">Grade </span>
              <span className="text-xl font-bold">{g.grade ?? 'none'}</span>
            </p>
            <p>
              <span className="text-canopy-soft">Suggested quality </span>
              <span className="text-xl font-bold tabular-nums">{g.qualityPercent === null ? '–' : `${g.qualityPercent}%`}</span>
            </p>
            <p className="text-sm text-canopy-soft">Read by {result.model}</p>
          </div>
          {g.defects.length > 0 && (
            <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {g.defects.map((d) => (
                <li key={d.defect} className="flex justify-between gap-3 border-b border-contour/60 py-1">
                  <span>{d.label}</span>
                  <span className="tabular-nums">{d.percent}%</span>
                </li>
              ))}
            </ul>
          )}
          {result.notes && <p className="mt-2 text-sm text-canopy-soft">AI notes: {result.notes}</p>}
          {g.needsPerson.length > 0 ? (
            <ul className="mt-3 space-y-1 rounded-md bg-monsoon-wash px-3 py-2 text-sm">
              <li className="font-semibold">A person checks this lot before paying:</li>
              {g.needsPerson.map((r) => (
                <li key={r}>{PERSON_COPY[r]}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-leaf">Within contract grade. {g.source}.</p>
          )}
          {onUse && g.qualityPercent !== null && (
            <button type="button" onClick={() => onUse(result)} className="mt-3 rounded-md border border-canopy/25 px-4 py-2 font-semibold hover:border-canopy">
              Use {g.qualityPercent}% in the delivery record
            </button>
          )}
        </div>
      )}
    </div>
  );
}
