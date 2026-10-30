import { z } from 'zod';

const schema = z.object({
  PAYPAL_ENV: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_SECRET: z.string().min(1),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  DATABASE_URL: z.string().default('file:data/agritranche.db'),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  CHALLENGE_SECRET: z.string().min(32),
  AG_STUDIO: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) throw new Error(`Invalid environment (see .env.local):\n${z.prettifyError(parsed.error)}`);
  if (parsed.data.PAYPAL_ENV === 'live') throw new Error('PAYPAL_ENV=live is refused: AgriTranche only runs against the PayPal sandbox');

  cached = parsed.data;
  return cached;
}
