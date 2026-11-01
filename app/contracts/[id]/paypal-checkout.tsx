'use client';

import { useRef, useState } from 'react';
import Script from 'next/script';
import { useRouter } from 'next/navigation';

type PaymentSession = { start(options: { presentationMode: 'auto' }, order: Promise<{ orderId: string }>): Promise<void> };
type SdkInstance = {
  findEligibleMethods(options: { currencyCode: string }): Promise<{ isEligible(method: 'paypal'): boolean }>;
  createPayPalOneTimePaymentSession(options: {
    onApprove(data: { orderId: string }): Promise<void>;
    onCancel(): void;
    onError(error: Error): void;
  }): PaymentSession;
};

declare global {
  interface Window {
    paypal?: { createInstance(options: { clientToken: string; components: string[]; pageType: string }): Promise<SdkInstance> };
  }
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmenting JSX for PayPal's web component
  namespace JSX {
    interface IntrinsicElements {
      'paypal-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { type?: string };
    }
  }
}

type Status = { kind: 'loading' | 'ready' | 'paying' | 'confirming' | 'funded' } | { kind: 'error' | 'cancelled'; message: string };

const PROGRESS = {
  loading: 'Loading PayPal…',
  paying: 'Waiting for you to approve in the PayPal window…',
  confirming: 'Payment approved. Confirming it with PayPal…',
} as const;

type Props = { createPath: string; approvePath: string; approvedStates: string[]; approvedText: string };

// One PayPal JS SDK v6 button: our server creates the order, PayPal approval, then our server
// captures or authorizes it. Used for the season advance and for the balance on delivery.
export function PayPalCheckout({ createPath, approvePath, approvedStates, approvedText }: Props) {
  const router = useRouter();
  const session = useRef<PaymentSession | null>(null);
  const started = useRef(false);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  async function createOrder() {
    const res = await fetch(createPath, { method: 'POST' });
    const body = (await res.json()) as { orderId?: string; error?: string };
    if (!body.orderId) throw new Error(body.error ?? 'PayPal could not create the order');
    return { orderId: body.orderId };
  }

  // Runs on every mount once the SDK is on the page, including after client-side navigation,
  // when the script is already loaded and onLoad would not fire again.
  async function setUp() {
    if (started.current) return;
    started.current = true;
    try {
      const { clientToken } = (await (await fetch('/api/paypal/client-token')).json()) as { clientToken: string };
      const sdk = await window.paypal!.createInstance({ clientToken, components: ['paypal-payments'], pageType: 'checkout' });
      const methods = await sdk.findEligibleMethods({ currencyCode: 'USD' });
      if (!methods.isEligible('paypal')) {
        setStatus({ kind: 'error', message: 'PayPal is not available for this browser.' });
        return;
      }
      session.current = sdk.createPayPalOneTimePaymentSession({
        async onApprove({ orderId }) {
          setStatus({ kind: 'confirming' });
          const res = await fetch(approvePath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId }),
          });
          const body = (await res.json()) as { state?: string; error?: string; issue?: string };
          if (body.state && approvedStates.includes(body.state)) {
            setStatus({ kind: 'funded' });
            router.refresh();
          } else {
            setStatus({ kind: 'error', message: body.issue === 'INSTRUMENT_DECLINED' ? 'The payment method was declined. Choose another one in PayPal.' : (body.error ?? 'PayPal did not complete the payment.') });
          }
        },
        onCancel: () => setStatus({ kind: 'cancelled', message: 'Payment cancelled. Nothing was charged.' }),
        onError: (error) => setStatus({ kind: 'error', message: error.message || 'PayPal reported an error. Try again.' }),
      });
      setStatus({ kind: 'ready' });
    } catch {
      started.current = false;
      setStatus({ kind: 'error', message: 'PayPal could not load. Check your connection and reload the page.' });
    }
  }

  async function pay() {
    if (!session.current) return;
    setStatus({ kind: 'paying' });
    try {
      await session.current.start({ presentationMode: 'auto' }, createOrder());
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'The payment did not start.' });
    }
  }

  return (
    <div>
      <Script src="https://www.sandbox.paypal.com/web-sdk/v6/core" strategy="afterInteractive" onReady={() => void setUp()} />
      {status.kind === 'funded' ? (
        <p role="status" className="rounded-md bg-leaf-wash px-4 py-3 text-lg font-semibold">
          {approvedText}
        </p>
      ) : (
        <>
          {status.kind === 'loading' && <div aria-hidden className="h-12 w-full max-w-xs animate-pulse rounded-full bg-[#ffc439]/50" />}
          <paypal-button type="pay" onClick={pay} hidden={status.kind === 'loading' || status.kind === 'confirming'} aria-disabled={status.kind === 'paying'} />
          {(status.kind === 'loading' || status.kind === 'paying' || status.kind === 'confirming') && (
            <p role="status" className="mt-3 flex items-center gap-2 text-canopy-soft">
              <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-contour border-t-leaf" />
              {PROGRESS[status.kind]}
            </p>
          )}
          {(status.kind === 'error' || status.kind === 'cancelled') && (
            <p role="alert" className={`mt-3 rounded-md px-4 py-3 ${status.kind === 'error' ? 'bg-cherry-wash text-cherry' : 'bg-monsoon-wash'}`}>
              {status.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
