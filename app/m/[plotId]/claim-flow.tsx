'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BILL_LABEL, REASON_COPY } from '@/lib/claim-copy';
import type { GateDecision, SupplierKind } from '@/lib/engine/gate';
import type { LngLat } from '@/lib/engine/geo';
import type { PlotMilestone } from '@/lib/engine/stateMachine';
import { formatUsd } from '@/lib/format';
import { CheckingSteps, PaymentFlow } from '../../ui/payment-flow';

export type Supplier = { id: string; name: string; role: string };
// A kind of bill this stage pays, the suppliers who can issue it, and the one paid by default.
export type BillChoice = { kind: SupplierKind; defaultId: string; suppliers: Supplier[] };
type Props = {
  plotId: string;
  milestoneId: string;
  milestone: PlotMilestone;
  prompt: string;
  // The farm's centre, offered when sandbox testers are far from the farm.
  farmCentre: LngLat | null;
  // The bills this stage pays; empty for stages without bills.
  bills: BillChoice[];
  // Display names for everyone a payout can go to, by id.
  names: Record<string, { name: string; role: string }>;
};
type Challenge = { id: string; code: string; expiresAt: number };
type ClaimResponse = {
  decision?: GateDecision;
  payoutBatchId?: string;
  error?: string | { route: string; issue: string };
  oracle?: { reading: { challengeCodeRead: string | null; cropStage: string; notes: string }; source: { kind: string; model: string } } | null;
};

const button = 'w-full rounded-md px-5 py-4 text-lg font-semibold disabled:opacity-50';

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <li className="border-l-2 pl-5 pb-8 last:pb-0" style={{ borderColor: done ? 'var(--at-leaf)' : 'var(--at-contour)' }}>
      <h3 className="-ml-[2.15rem] flex items-center gap-3 text-lg font-bold">
        <span className={`grid size-7 place-items-center rounded-full text-sm ${done ? 'bg-leaf text-sheet' : 'bg-survey ring-2 ring-contour'}`}>{n}</span>
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </li>
  );
}

function currentPosition(): Promise<LngLat> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.longitude, p.coords.latitude]),
      () => reject(new Error('Location is off. Allow location for this site, then send again.')),
      { enableHighAccuracy: true, timeout: 15_000 },
    ),
  );
}

export function ClaimFlow({ plotId, milestoneId, milestone, prompt, farmCentre, bills, names }: Props) {
  const router = useRouter();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [voice, setVoice] = useState<{ blob: Blob; url: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [useFarmCentre, setUseFarmCentre] = useState(farmCentre !== null);
  const [picked, setPicked] = useState<Partial<Record<SupplierKind, string>>>(() => Object.fromEntries(bills.map((b) => [b.kind, b.defaultId])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaimResponse | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  async function getCode() {
    setError(null);
    setResult(null);
    setBusy(true);
    const res = await fetch(`/api/plots/${plotId}/challenges`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ milestone }) });
    setBusy(false);
    if (!res.ok) return setError("Couldn't get a code. Check your connection and try again.");
    setChallenge(await res.json());
    setPhoto(null);
  }

  async function toggleRecording() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream);
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: r.mimeType });
        setVoice({ blob, url: URL.createObjectURL(blob) });
        setRecording(false);
      };
      recorder.current = r;
      r.start();
      setRecording(true);
    } catch {
      setError('The microphone is off. Allow it for this site, or send without a voice note.');
    }
  }

  async function send() {
    if (!challenge || !photo) return;
    setError(null);
    setBusy(true);
    try {
      const [lng, lat] = useFarmCentre && farmCentre ? farmCentre : await currentPosition();
      const form = new FormData();
      form.set('photo', photo.file);
      if (voice) form.set('audio', voice.blob, 'voice-note');
      form.set('challengeId', challenge.id);
      form.set('challengeCode', challenge.code);
      form.set('lng', String(lng));
      form.set('lat', String(lat));
      form.set('milestone', milestone);
      for (const [kind, id] of Object.entries(picked)) form.set(`supplier_${kind}`, id);

      const res = await fetch(`/api/milestones/${milestoneId}/claim`, { method: 'POST', body: form });
      const body = (await res.json()) as ClaimResponse;
      if (!body.decision) throw new Error(typeof body.error === 'string' ? body.error : "The evidence couldn't be sent. Try again.");
      setResult(body);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The evidence couldn't be sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <ol>
        <Step n={1} title="Get today's code" done={challenge !== null}>
          {challenge ? (
            <div className="rounded-md border border-contour bg-sheet px-4 py-4">
              <p className="font-mono text-5xl font-bold tracking-[0.15em]">{challenge.code}</p>
              <p className="mt-2 text-canopy-soft">
                Write it on paper. It works until {new Date(challenge.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
              </p>
            </div>
          ) : (
            <button type="button" onClick={getCode} disabled={busy} className={`${button} bg-leaf text-sheet`}>
              Get code
            </button>
          )}
        </Step>

        <Step n={2} title="Take the photo" done={photo !== null}>
          {bills.map((bill) => (
            <fieldset key={bill.kind} className="mb-4">
              <legend className="mb-2 font-semibold">Who is the {BILL_LABEL[bill.kind]} from?</legend>
              <div className="flex flex-wrap gap-2">
                {bill.suppliers.map((s) => (
                  <label key={s.id} className={`cursor-pointer rounded-full border px-3 py-1.5 ${picked[bill.kind] === s.id ? 'border-leaf bg-leaf-wash font-semibold' : 'border-contour'}`}>
                    <input
                      type="radio"
                      name={`supplier-${bill.kind}`}
                      value={s.id}
                      checked={picked[bill.kind] === s.id}
                      onChange={() => setPicked({ ...picked, [bill.kind]: s.id })}
                      className="sr-only"
                    />
                    {s.name} <span className="text-sm text-canopy-soft">· {s.role}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          {bills.length > 0 && <p className="mb-4 text-sm text-canopy-soft">Each is paid their bill total straight from the season fund.</p>}
          <p className="mb-3 text-canopy-soft">{prompt}</p>
          <label className={`${button} block cursor-pointer border border-canopy/25 text-center ${challenge ? '' : 'pointer-events-none opacity-50'}`}>
            {photo ? 'Take it again' : 'Open camera'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={!challenge}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setPhoto({ file, url: URL.createObjectURL(file) });
              }}
            />
          </label>
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img src={photo.url} alt="Your evidence photo" className="mt-3 aspect-[4/3] w-full rounded-md object-cover" />
          )}
        </Step>

        <Step n={3} title="Say what you did" done={voice !== null}>
          <p className="mb-3 text-canopy-soft">Optional, in your own language: say what you bought or did, and who did the work.</p>
          <button type="button" onClick={toggleRecording} disabled={!photo} className={`${button} border ${recording ? 'border-cherry text-cherry' : 'border-canopy/25'}`}>
            {recording ? 'Stop recording' : voice ? 'Record again' : 'Record voice note'}
          </button>
          {voice && <audio src={voice.url} controls className="mt-3 w-full" />}
        </Step>

        <Step n={4} title="Send" done={result !== null}>
          {farmCentre && (
            <label className="mb-3 flex items-start gap-3 text-canopy-soft">
              <input type="checkbox" checked={useFarmCentre} onChange={(e) => setUseFarmCentre(e.target.checked)} className="mt-1 size-5 accent-[var(--at-leaf)]" />
              I&apos;m testing in the sandbox away from the farm: send from the farm&apos;s centre
            </label>
          )}
          <button type="button" onClick={send} disabled={!photo || busy} className={`${button} bg-leaf text-sheet`}>
            {busy && photo ? 'Checking your proof' : 'Send proof'}
          </button>
          {busy && photo && (
            <div className="mt-4 rounded-xl border border-contour bg-survey p-4">
              <CheckingSteps bill={bills.length > 0} />
            </div>
          )}
        </Step>
      </ol>

      {error && (
        <p role="alert" className="mt-6 rounded-md bg-cherry-wash px-4 py-3 text-cherry">
          {error}
        </p>
      )}
      {result?.decision && <Outcome result={result} names={names} />}
    </div>
  );
}

function Outcome({ result, names }: { result: ClaimResponse; names: Props['names'] }) {
  const decision = result.decision!;
  const reading = result.oracle?.reading;

  const tone =
    decision.kind === 'RELEASE' || decision.kind === 'DEDUPED' ? 'bg-leaf-wash' : decision.kind === 'REVIEW' ? 'bg-monsoon-wash' : 'bg-cherry-wash';

  return (
    <section role="status" className={`mt-6 rounded-md px-4 py-4 leading-relaxed ${tone}`}>
      {decision.kind === 'RELEASE' && !result.error && (
        <>
          <p className="mb-3 text-xl font-bold">Paid {formatUsd(decision.payouts.reduce((sum, p) => sum + p.cents, 0))}</p>
          <PaymentFlow
            payees={decision.payouts.filter((p) => p.cents > 0).map((p) => ({ name: names[p.id]?.name ?? p.id, role: names[p.id]?.role ?? '', cents: p.cents, status: 'PENDING' }))}
            batchId={result.payoutBatchId}
          />
        </>
      )}
      {decision.kind === 'RELEASE' && result.error && (
        <p>Your evidence passed, but PayPal didn&apos;t accept the payment yet. Your cooperative can send it again.</p>
      )}
      {decision.kind === 'DEDUPED' && <p className="text-xl font-bold">This payment was already sent.</p>}
      {(decision.kind === 'REVIEW' || decision.kind === 'REJECT') && (
        <>
          <p className="text-xl font-bold">{decision.kind === 'REVIEW' ? 'Sent for a check' : 'Not paid yet'}</p>
          <ul className="mt-2 space-y-2">
            {decision.reasons.map((r) => (
              <li key={r}>{REASON_COPY[r]}</li>
            ))}
          </ul>
        </>
      )}
      {reading && (
        <p className="mt-3 border-t border-canopy/15 pt-3 text-sm text-canopy-soft">
          Code read from photo: <span className="font-mono">{reading.challengeCodeRead ?? 'none'}</span>. {reading.notes}
        </p>
      )}
    </section>
  );
}
