# FarmProof

**Pay farmers the moment field work is proven.** A buyer anywhere funds a crop season with PayPal. Each time a farmer proves a stage of work (fertiliser bought, crop sprayed, harvest picked), the payment for that stage goes out with PayPal Payouts, split straight to the input seller, the labour group and the farmer. AI reads the evidence; satellites, GPS and fraud checks back it up; and plain code, not the model, decides every payment.

[![CI](https://github.com/vaibhavdes/FreshPay/actions/workflows/ci.yml/badge.svg)](https://github.com/vaibhavdes/FreshPay/actions/workflows/ci.yml) · MIT licence · PayPal sandbox only

- **Live demo:** https://farmproof-2y11.onrender.com (no sign-up)
- **Built for:** the PayPal AI Hackathon 2026

## The problem

A smallholder pays for seed, fertiliser, sprays and pickers months before harvest, but a buyer pays for the crop only after it is delivered. So the farmer borrows, often at high interest, to grow a crop that is already sold. Buyers would pay earlier if they could see the money turn into farm work. Today they can't, so they don't.

FarmProof closes that gap. The buyer's money is held as a season fund and released stage by stage, each time the work is proven. The farmer gets cash when the costs fall due, and the suppliers are paid directly, so the money visibly reaches the crop.

## Try it in three minutes

1. Open the **[guided tour](https://farmproof-2y11.onrender.com/tour)** and press **Start my own season**. You get a private copy of the example season, so nothing another judge did shows up.
2. **Fund it:** open the contract and pay the season fund with the PayPal button (sandbox buyer login in the Devpost testing instructions).
3. **Prove a stage as the farmer:** [`/tour/paid`](https://farmproof-2y11.onrender.com/tour/paid) opens Lakshmi's phone. Get today's code, write it on paper, photograph it on the farm and send. Tick "testing in the sandbox" to send from the farm's centre.
4. **See a held claim:** [`/tour/held`](https://farmproof-2y11.onrender.com/tour/held). The review agent investigates, a second AI pass looks for reasons not to pay, and the field officer approves.
5. **See a refusal:** [`/tour/refused`](https://farmproof-2y11.onrender.com/tour/refused). Savitha's farm sits on forest cleared in 2023–24, so every payment is refused, whatever the photo shows.
6. **Post your own season:** the [opportunity board](https://farmproof-2y11.onrender.com/opportunities) lets any company post a crop (coffee, potato, cocoa, organic cotton) and lets farmers join with **Log in with PayPal**.

Each farm record shows the satellite timeline, every check behind each payment, how fast the money moved, and a link to **verify the payment record** on a public page.

## How a payment is decided

| Step | What happens | Who decides |
|---|---|---|
| 1. Code | The server issues a 6-character code, valid 15 minutes, signed with HMAC | Code |
| 2. Evidence | Photo with the code, phone GPS, optional voice note in any language | Farmer |
| 3. Reading | Gemini reads the code, crop stage, every bill (amount, kind, issuer, number, date) and translates the voice note | AI (reads only) |
| 4. Hard checks | Code matches; phone inside the farm; stage window open; stages in order; land check passed; fund covers it; photo and bills not used before; bill issuer matches the supplier paid | Code: refuse or hold |
| 5. Signals | Camera location and date (EXIF), phone accuracy, the day's weather, Sentinel-2 greenness | Code: any warning holds for a person |
| 6. Pay | Each bill paid up to its cap, farmer's share added, integer cents, one PayPal Payouts batch | Code |
| 7. Record | Hash-chained payment record, PayPal batch ID, webhook confirmation | Code |

A held claim goes to the field officer with the review agent's recommendation. When the officer approves, the money checks run again before anything is paid.

## PayPal

| PayPal capability | What it does here | Code |
|---|---|---|
| Orders v2 `CAPTURE` + JS SDK v6 | The buyer funds the season | `app/api/contracts/[id]/advance`, `paypal-checkout.tsx` |
| Payouts (batch) | Each stage paid to farmer, input seller, labour group and machinery hire in one batch | `lib/services/payouts.ts` |
| Log in with PayPal | Farmers join with their own PayPal account; payouts go to it | `lib/paypal-identity.ts` |
| Orders `AUTHORIZE` → partial capture → void, reauthorize | Delivery balance paid only for the weight and grade accepted | `lib/services/delivery.ts`, `lib/services/authorizations.ts` |
| Orders `/track` | Shipment tracking on the captured order | `lib/services/delivery.ts` |
| Refunds | Unearned season fund returned after a weather-verified disaster | `lib/services/force-majeure.ts` |
| Webhooks + `verify-webhook-signature` | Confirms every payout; records whether the API or the webhook arrived first | `lib/services/webhooks.ts` |
| Disputes | Syncs disputes and sends an AI-drafted evidence pack after a person approves | `lib/services/disputes.ts` |
| Transaction Search | Daily reconciliation of the books against PayPal | `lib/services/reconciliation.ts` |
| Subscriptions | The buyer's workspace plan, the business model | `lib/services/subscription.ts` |
| Vault v3 | Good-practice bonus under a saved-PayPal mandate (see limitations) | `lib/services/premium.ts` |
| `PayPal-Request-Id`, error routing, negative testing | Every mutation is idempotent; failures show PayPal's issue code and `debug_id`; a fault panel triggers PayPal's own test failures | `lib/services/ops.ts`, `lib/paypal-errors.ts`, `/tour` |

The PayPal Server SDK (APIMatic) handles Orders, Payments, Vault, Transaction Search and Subscriptions; a small typed REST client handles the rest. The code was written with the APIMatic PayPal context plugin. A live-environment kill switch refuses to run against `PAYPAL_ENV=live`.

Real sandbox evidence: payout batch `4SS2QVNZHNUMG` (season funded, proof approved, $25 paid, confirmed "Received" by signed webhook, Nov 1, 2026).

## AI

| Component | Model | Job | Decides money? |
|---|---|---|---|
| Evidence reader | Gemini 3.5 Flash-Lite, then 3.8 Flash (Vertex AI) | Reads the photo and voice note into a strict schema: code, crop stage, bills, weight slip, transcript and translation | No |
| Review agent | Gemini 3.8 Flash with read-only tools | Investigates held claims: evidence, plot history, reused photos, land check, a second look at the photo; recommends with reasons | No: a person approves and the rules run again |
| Second opinion | Gemini 3.8 Flash | Challenges every "approve" recommendation; any doubt turns it into "not sure" | No |
| Dispute agent | Gemini | Drafts the evidence narrative for a buyer dispute | No: a person sends it |
| Season Agent | AG Studio Agent Framework + Gemini + read-only PayPal tools | Answers the buyer's questions with filters and charts, and proposes actions | No: actions go through the rules |

Safeguards: a daily call cap, a cache by evidence hash, a 15-second timeout, a fallback model, and replays of recorded readings when no model is reachable. Live AI on the hosted demo reaches Vertex through a short-lived token bridge; `/api/health/ai` shows whether it is up.

## Real data

| Data | Source | Licence |
|---|---|---|
| Farm outlines (two of three) | OpenStreetMap coffee plantations in Kodagu, Karnataka | © OpenStreetMap contributors, ODbL |
| Tree cover loss (land check) | Global Forest Watch, UMD tree cover loss | CC BY 4.0 |
| Monthly satellite views and NDVI | Copernicus Sentinel-2 via the Copernicus Data Space Ecosystem | Contains modified Copernicus Sentinel data 2025–2026 |
| Weather | Open-Meteo | CC BY 4.0 |
| Base map imagery | Esri World Imagery | Esri terms, attribution shown |
| Yields, prices, crop calendar | Coffee Board of India; Karnataka coffee prices, Oct 2026; FBIL reference rate (₹95.37/USD) | Cited in `lib/season-terms.ts` |

People and companies are fictional. Farm outlines are demonstration outlines, not ownership records. Savitha's outline is drawn over forest that Global Forest Watch records as cleared in 2023–24.

## Built with

Next.js 16 · TypeScript · Tailwind CSS · libSQL + Drizzle · PayPal Server SDK · PayPal JS SDK v6 · Vercel AI SDK · Gemini on Vertex AI · AG Studio + AG Grid Enterprise · MapLibre · sharp · Vitest · GitHub Actions · Render

## Run it locally

Needs Node 22+ and a PayPal sandbox REST app on a US business account (Payouts, Transaction Search and Log in with PayPal turned on).

```bash
npm install
cp .env.example .env.local   # add PAYPAL_CLIENT_ID, PAYPAL_SECRET and a 32+ character CHALLENGE_SECRET
npm run seed
npm run dev
```

Without AI credentials the app still runs end to end: claims that a model would read are held for the field officer. Optional keys in `.env.example` add Gemini (Vertex or the Gemini API), Global Forest Watch, Copernicus and AG Studio.

Useful scripts: `npm run doctor` (checks the setup), `npm run evidence` (prints real sandbox IDs for each PayPal API), `npm run satellite:prefetch`, `npm run prefetch:geo`, `npm run eval:agent`, `npm run replays:export`.

## Tests

```bash
npm test
npm run test:coverage   # the payment rules in lib/engine must stay at 100% coverage
```

222 tests across the payment rules, the PayPal services (with PayPal stubbed), the AI agents (with mock models), the fraud and proof checks, and month-by-month replays of a real year of Sentinel-2 data over the demo farms. CI runs typecheck, lint, tests and a production build on every push; Render deploys only when CI passes.

## Sandbox limitations, honestly

- **India payouts:** PayPal stopped domestic payments in India in 2021, and Indian accounts receive cross-border payments only. The demo pays US sandbox accounts standing in for farmers and suppliers. The payment rules don't depend on the rail: in production in India, payouts would go through a licensed partner or local rails such as UPI, with PayPal serving the buyer side and payout-eligible origins. The opportunity board only offers countries where PayPal Payouts reach farmers.
- **Vault:** saving the buyer's PayPal for merchant-initiated charges is refused for this sandbox app (`NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE`). The good-practice bonus falls back to a buyer-approved order per batch, still capped by the rules.
- **Satellites:** at 10 m, Sentinel-2 shows canopy, crop growth and clearing on a smallholding, not each farm task. It backs up the photo; it never pays on its own.
- **AG Grid Enterprise** shows a trial watermark until a licence key is set.

## Licence

MIT. See [LICENSE](LICENSE).
