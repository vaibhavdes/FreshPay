// The tour's test controls arm one PayPal failure for the next matching call. PayPal's own sandbox
// produces the failure (negative testing), so what the app shows is a real PayPal response.
export const FAULTS = {
  PAYOUT_ITEM_FAILS: { label: 'Next payout item fails at PayPal', how: "PayPal's sandbox rejects one person's payment; the rest still arrive" },
  CAPTURE_DECLINED: { label: 'Next season fund payment is declined', how: "PayPal's sandbox declines the buyer's payment method" },
  PAYPAL_SERVER_ERROR: { label: 'PayPal has a server error on the next capture or refund', how: "PayPal's sandbox fails the call; nothing is charged twice when it is tried again" },
} as const;

export type Fault = keyof typeof FAULTS;

const holder = globalThis as typeof globalThis & { agritrancheFault?: Fault | null };

export const armedFault = (): Fault | null => holder.agritrancheFault ?? null;

export function armFault(fault: Fault | null) {
  holder.agritrancheFault = fault;
}

// Returns true once if `fault` is armed, and disarms it.
export function takeFault(fault: Fault): boolean {
  if (holder.agritrancheFault !== fault) return false;
  holder.agritrancheFault = null;
  return true;
}

const SERVER_ERROR = JSON.stringify({ mock_application_codes: 'INTERNAL_SERVER_ERROR' });

// The mock header for an armed fault on the buyer's advance payment, if any.
export function captureMock(): string | undefined {
  if (takeFault('CAPTURE_DECLINED')) return JSON.stringify({ mock_application_codes: 'INSTRUMENT_DECLINED' });
  return serverErrorMock();
}

// The mock header for an armed server error on a delivery capture or refund, if any.
export const serverErrorMock = (): string | undefined => (takeFault('PAYPAL_SERVER_ERROR') ? SERVER_ERROR : undefined);
