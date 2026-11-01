'use client';

import { useState } from 'react';
import type { PlotMilestone } from '@/lib/engine/stateMachine';
import { formatBillAmount, SCENARIOS, scenariosFor, testBills, testFileName, type Currency, type PaidBill, type PrintedBill, type StageBill, type TestScenario } from '@/lib/test-photo';

export type TestKit = { photo: string; photoAlt: string; commodity: string; currency: Currency; stageTitle: string; opensAt: number; reused: PaidBill | null };

const W = 1400;
const H = 1050;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The stage photo didn't load."));
    img.src = src;
  });
}

function paper(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, angle: number, draw: () => void) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(angle);
  ctx.translate(-w / 2, -h / 2);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#fbf8f0';
  ctx.fillRect(0, 0, w, h);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#1d2a22';
  draw();
  ctx.restore();
}

// The stage photo, framed differently for every code so no two test photos are the same picture,
// with today's code on paper and the stage's bills laid over it.
async function compose(src: string, code: string, bills: PrintedBill[], withCode: boolean): Promise<Blob> {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const seed = [...code].reduce((sum, c, i) => sum + c.charCodeAt(0) * (i + 7), 0);
  const scale = Math.max(W / img.width, H / img.height) * (1.15 + (seed % 20) / 100);
  const sw = W / scale;
  const sh = H / scale;
  ctx.drawImage(img, ((seed % 97) / 97) * (img.width - sw), ((seed % 89) / 89) * (img.height - sh), sw, sh, 0, 0, W, H);

  if (withCode) {
    paper(ctx, 60, H - 330, 520, 250, -0.05 + (seed % 7) / 100, () => {
      ctx.font = '600 34px system-ui, sans-serif';
      ctx.fillText("Today's code", 36, 64);
      ctx.font = 'bold 118px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(code, 30, 190);
    });
  }

  bills.forEach((bill, i) => {
    paper(ctx, W - 560 + i * 30, 40 + i * 380, 500, 340, 0.03 - i * 0.06, () => {
      ctx.font = 'bold 38px system-ui, sans-serif';
      ctx.fillText(bill.issuer, 34, 60, 432);
      ctx.font = '28px system-ui, sans-serif';
      ctx.fillText(`Tax invoice No. ${bill.number}`, 34, 104, 432);
      ctx.fillText(`Date ${bill.date}`, 34, 144);
      ctx.fillText(bill.title, 34, 196, 432);
      ctx.fillRect(34, 226, 432, 3);
      ctx.font = 'bold 46px system-ui, sans-serif';
      ctx.fillText(`Total ${formatBillAmount(bill.amount, bill.currency)}`, 34, 290, 432);
    });
  });

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The test photo couldn't be made."))), 'image/jpeg', 0.88));
}

async function makeTestPhoto(kit: TestKit, milestone: PlotMilestone, stageBills: StageBill[], code: string, scenario: TestScenario): Promise<File> {
  const bills = testBills({ scenario, commodity: kit.commodity, currency: kit.currency, milestone, stageBills, reused: kit.reused, code, opensAt: kit.opensAt, now: Date.now() });
  const blob = await compose(kit.photo, code, bills, scenario !== 'no-code');
  return new File([blob], testFileName(kit.stageTitle, scenario), { type: 'image/jpeg' });
}

export function TestPhoto({ kit, milestone, code, stageBills, onPhoto }: { kit: TestKit; milestone: PlotMilestone; code: string | null; stageBills: StageBill[]; onPhoto: (file: File) => void }) {
  const [busy, setBusy] = useState<TestScenario | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function use(scenario: TestScenario) {
    if (!code) return;
    setBusy(scenario);
    setError(null);
    try {
      onPhoto(await makeTestPhoto(kit, milestone, stageBills, code, scenario));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The test photo couldn't be made.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-contour bg-survey p-4">
      <div className="flex gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- small preview of a local stage photo */}
        <img src={kit.photo} alt={kit.photoAlt} className="size-20 shrink-0 rounded-lg object-cover" />
        <div>
          <p className="font-semibold">No farm nearby? Use a ready photo</p>
          <p className="mt-1 text-sm text-canopy-soft">A real photo of this stage, with today&apos;s code and the bills added. Each one is set up for a different outcome.</p>
        </div>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {scenariosFor(stageBills, kit.reused).map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => use(s)}
              disabled={!code || busy !== null}
              className="w-full rounded-md border border-contour bg-sheet px-3 py-2 text-left transition hover:border-leaf disabled:opacity-50"
            >
              <span className="block font-semibold">{busy === s ? 'Making the photo' : SCENARIOS[s].label}</span>
              <span className="block text-sm text-canopy-soft">{SCENARIOS[s].outcome}</span>
            </button>
          </li>
        ))}
      </ul>
      {!code && <p className="mt-2 text-sm text-canopy-soft">Get today&apos;s code first.</p>}
      {error && <p className="mt-2 text-sm text-cherry">{error}</p>}
    </div>
  );
}
