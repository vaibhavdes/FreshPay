// The tour's test controls arm one PayPal failure for the next matching call. PayPal's own sandbox
// produces the failure (negative testing), so what the app shows is a real PayPal response.
export const FAULTS = {
  PAYOUT_ITEM_FAILS: { label: 'Next payout item fails at PayPal', how: "PayPal's sandbox rejects one person's payment; the rest still arrive" },
  CAPTURE_DECLINED: { label: 'Next season fund payment is declined', how: "PayPal's sandbox declines the buyer's payment method" },
  PAYPAL_SERVER_ERROR: { label: 'PayPal has a server error on the next capture or refund', how: "PayPal's sandbox fails the call; nothing is charged twice when it is tried again" },
} as const;

export type Fault = keyof typeof FAULTS;

// Armed per season, so one visitor's test never fails another visitor's payment.
const holder = globalThis as typeof globalThis & { agritrancheFaults?: Map<string, Fault> };
const armed = () => (holder.agritrancheFaults ??= new Map());

export const armedFault = (contractId: string): Fault | null => armed().get(contractId) ?? null;

export function armFault(contractId: string, fault: Fault | null) {
  if (fault) armed().set(contractId, fault);
  else armed().delete(contractId);
}

// Returns true once if `fault` is armed for this season, and disarms it.
export function takeFault(contractId: string, fault: Fault): boolean {
  if (armed().get(contractId) !== fault) return false;
  armed().delete(contractId);
  return true;
}

const SERVER_ERROR = JSON.stringify({ mock_application_codes: 'INTERNAL_SERVER_ERROR' });

// The mock header for an armed fault on the buyer's advance payment, if any.
export function captureMock(contractId: string): string | undefined {
  if (takeFault(contractId, 'CAPTURE_DECLINED')) return JSON.stringify({ mock_application_codes: 'INSTRUMENT_DECLINED' });
  return serverErrorMock(contractId);
}

// The mock header for an armed server error on a delivery capture or refund, if any.
export const serverErrorMock = (contractId: string): string | undefined => (takeFault(contractId, 'PAYPAL_SERVER_ERROR') ? SERVER_ERROR : undefined);
