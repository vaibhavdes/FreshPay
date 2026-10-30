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
  // Billing plan for the buyer's compliance workspace, created once with npm run paypal:plan.
  PAYPAL_WORKSPACE_PLAN_ID: z.string().optional(),
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
