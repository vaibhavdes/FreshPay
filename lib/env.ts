import { z } from 'zod';

const schema = z.object({
  PAYPAL_ENV: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_SECRET: z.string().min(1),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  DATABASE_URL: z.string().default('file:data/agritranche.db'),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  CHALLENGE_SECRET: z.string().min(32),
  AI_PROVIDER: z.enum(['google', 'vertex']).default('google'),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  GOOGLE_VERTEX_PROJECT: z.string().optional(),
  // Gemini 3.x models are served from the global endpoint on Vertex.
  GOOGLE_VERTEX_LOCATION: z.string().default('global'),
  GOOGLE_TOKEN_GRANT_FILE: z.string().optional(),
  AI_MODE: z.enum(['live', 'replay']).default('live'),
  AI_MODELS: z
    .string()
    .default('gemini-3.5-flash-lite,gemini-3.8-flash')
    .transform((list) => list.split(',').map((id) => id.trim()).filter(Boolean)),
  AI_DAILY_LIMIT: z.coerce.number().int().positive().default(400),
  // The review agent reasons over several tool results, so it gets the stronger model.
  AGENT_MODEL: z.string().default('gemini-3.8-flash'),
  // Lets judges far from the plots send evidence as if they were standing on them.
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Shared secret the Render cron job sends to /api/cron/*; the routes are closed without it.
  CRON_SECRET: z.string().min(16).optional(),
  // When set, buyer and cooperative actions need this passcode (entered once at /unlock); read by proxy.ts.
  DEMO_PASSCODE: z.string().min(8).optional(),
  // Global Forest Watch key for land checks on newly registered plots; without it they wait for a person.
  GFW_API_KEY: z.string().optional(),
  // Copernicus Data Space client for Sentinel-2 views of each farm; without it the satellite check is skipped.
  SENTINEL_CLIENT_ID: z.string().optional(),
  SENTINEL_CLIENT_SECRET: z.string().optional(),
  // Billing plan for the buyer's compliance workspace, created once with npm run paypal:plan.
  PAYPAL_WORKSPACE_PLAN_ID: z.string().optional(),
  AG_STUDIO: z.string().optional(),
  // Public address of the app, for PayPal's sign-in return URL; local runs use the request's own origin.
  APP_URL: z.url().optional(),
  // Ask Log in with PayPal for the PayPal account ID (tick it in the app first); payouts then go to it.
  PAYPAL_LOGIN_ACCOUNT_ID: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;

  // An optional key left blank (as in a fresh copy of .env.example) counts as not set.
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== '')));
  if (!parsed.success) throw new Error(`Invalid environment (see .env.local):\n${z.prettifyError(parsed.error)}`);
  if (parsed.data.PAYPAL_ENV === 'live') throw new Error('PAYPAL_ENV=live is refused: FarmProof only runs against the PayPal sandbox');

  cached = parsed.data;
  return cached;
}
