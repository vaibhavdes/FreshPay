import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { EudrStatus } from '../engine/gate';
import type { LngLat } from '../engine/geo';
import type { Share } from '../engine/splits';
import type { ContractState, PlotMilestone } from '../engine/stateMachine';

const id = () => text('id').primaryKey();
const createdAt = () => integer('created_at').notNull();

export const buyers = sqliteTable('buyers', {
  id: id(),
  name: text('name').notNull(),
  country: text('country').notNull(),
  paypalEmail: text('paypal_email').notNull(),
  createdAt: createdAt(),
});

export const cooperatives = sqliteTable('cooperatives', {
  id: id(),
  name: text('name').notNull(),
  region: text('region').notNull(),
  country: text('country').notNull(),
  createdAt: createdAt(),
});

export const farmers = sqliteTable('farmers', {
  id: id(),
  cooperativeId: text('cooperative_id')
    .notNull()
    .references(() => cooperatives.id),
  name: text('name').notNull(),
  paypalEmail: text('paypal_email').notNull(),
  createdAt: createdAt(),
});

export const inputDealers = sqliteTable('input_dealers', {
  id: id(),
  name: text('name').notNull(),
  paypalEmail: text('paypal_email').notNull(),
  createdAt: createdAt(),
});

export const plots = sqliteTable('plots', {
  id: id(),
  farmerId: text('farmer_id')
    .notNull()
    .references(() => farmers.id),
  dealerId: text('dealer_id').references(() => inputDealers.id),
  name: text('name').notNull(),
  country: text('country').notNull(),
  commodity: text('commodity').notNull(),
  variety: text('variety'),
  ring: text('ring', { mode: 'json' }).$type<LngLat[]>().notNull(),
  areaHa: real('area_ha').notNull(),
  valueCents: integer('value_cents').notNull().default(0),
  eudrStatus: text('eudr_status').$type<EudrStatus>().notNull(),
  eudrCheck: text('eudr_check', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

export const contracts = sqliteTable('contracts', {
  id: id(),
  buyerId: text('buyer_id')
    .notNull()
    .references(() => buyers.id),
  cooperativeId: text('cooperative_id')
    .notNull()
    .references(() => cooperatives.id),
  commodity: text('commodity').notNull(),
  season: text('season').notNull(),
  currency: text('currency').notNull(),
  totalCents: integer('total_cents').notNull(),
  advanceCents: integer('advance_cents').notNull(),
  escrowRemainingCents: integer('escrow_remaining_cents').notNull().default(0),
  state: text('state').$type<ContractState>().notNull(),
  advanceOrderId: text('advance_order_id'),
  advanceCaptureId: text('advance_capture_id'),
  balanceOrderId: text('balance_order_id'),
  balanceAuthorizationId: text('balance_authorization_id'),
  balanceAuthorizedCents: integer('balance_authorized_cents'),
  balanceCaptureId: text('balance_capture_id'),
  balanceCapturedCents: integer('balance_captured_cents'),
  deliveredKg: integer('delivered_kg'),
  acceptedKg: integer('accepted_kg'),
  qualityPercent: integer('quality_percent'),
  carrier: text('carrier'),
  trackingNumber: text('tracking_number'),
  forceMajeure: text('force_majeure', { mode: 'json' }).$type<Record<string, unknown>>(),
  refundId: text('refund_id'),
  createdAt: createdAt(),
});

export const milestones = sqliteTable(
  'milestones',
  {
    id: id(),
    contractId: text('contract_id')
      .notNull()
      .references(() => contracts.id),
    plotId: text('plot_id')
      .notNull()
      .references(() => plots.id),
    type: text('type').$type<PlotMilestone>().notNull(),
    version: integer('version').notNull().default(1),
    state: text('state').$type<'PENDING' | 'RELEASED' | 'REVIEW' | 'REJECTED'>().notNull(),
    opensAt: integer('opens_at').notNull(),
    closesAt: integer('closes_at').notNull(),
    trancheCents: integer('tranche_cents').notNull(),
    premiumCents: integer('premium_cents').notNull().default(0),
    shares: text('shares', { mode: 'json' }).$type<Share[]>().notNull(),
    decision: text('decision', { mode: 'json' }).$type<Record<string, unknown>>(),
    decidedAt: integer('decided_at'),
  },
  (t) => [uniqueIndex('milestones_plot_type').on(t.contractId, t.plotId, t.type)],
);

export const challenges = sqliteTable('challenges', {
  id: id(),
  plotId: text('plot_id')
    .notNull()
    .references(() => plots.id),
  milestoneType: text('milestone_type').$type<PlotMilestone>().notNull(),
  code: text('code').notNull(),
  issuedAt: integer('issued_at').notNull(),
  usedAt: integer('used_at'),
});

export const evidence = sqliteTable('evidence', {
  id: id(),
  milestoneId: text('milestone_id')
    .notNull()
    .references(() => milestones.id),
  challengeId: text('challenge_id').references(() => challenges.id),
  kind: text('kind').$type<'PHOTO' | 'VOICE' | 'WEIGHT_SLIP'>().notNull(),
  sha256: text('sha256').notNull(),
  gps: text('gps', { mode: 'json' }).$type<LngLat>(),
  oracle: text('oracle', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: createdAt(),
});

export const mandates = sqliteTable('mandates', {
  id: id(),
  contractId: text('contract_id')
    .notNull()
    .references(() => contracts.id),
  vaultTokenId: text('vault_token_id'),
  capCents: integer('cap_cents').notNull(),
  usedCents: integer('used_cents').notNull().default(0),
  createdAt: createdAt(),
});

export type OpStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export const paypalOps = sqliteTable(
  'paypal_ops',
  {
    id: id(),
    op: text('op').notNull(),
    key: text('key').notNull(),
    requestId: text('request_id').notNull(),
    status: text('status').$type<OpStatus>().notNull(),
    paypalId: text('paypal_id'),
    debugId: text('debug_id'),
    errorRoute: text('error_route'),
    errorIssue: text('error_issue'),
    learnedFrom: text('learned_from').$type<'SYNC' | 'WEBHOOK'>(),
    syncMs: integer('sync_ms'),
    webhookMs: integer('webhook_ms'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('paypal_ops_key').on(t.key), index('paypal_ops_paypal_id').on(t.paypalId)],
);

export const payoutItems = sqliteTable(
  'payout_items',
  {
    id: id(),
    opId: text('op_id')
      .notNull()
      .references(() => paypalOps.id),
    payeeId: text('payee_id').notNull(),
    receiver: text('receiver').notNull(),
    cents: integer('cents').notNull(),
    payoutItemId: text('payout_item_id'),
    status: text('status').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('payout_items_paypal_id').on(t.payoutItemId)],
);

export const webhookEvents = sqliteTable('webhook_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  resourceId: text('resource_id'),
  replayCount: integer('replay_count').notNull().default(0),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  receivedAt: integer('received_at').notNull(),
});

export const ledgerReceipts = sqliteTable('ledger_receipts', {
  seq: integer('seq').primaryKey(),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull().unique(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
});

export const eudrRecords = sqliteTable('eudr_records', {
  id: id(),
  plotId: text('plot_id')
    .notNull()
    .references(() => plots.id),
  record: text('record', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
});

export const oracleReadings = sqliteTable('oracle_readings', {
  inputHash: text('input_hash').primaryKey(),
  model: text('model').notNull(),
  reading: text('reading', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
});

export type AgentCheck = { tool: string; input: Record<string, unknown>; finding: string };

export const agentReviews = sqliteTable(
  'agent_reviews',
  {
    id: id(),
    milestoneId: text('milestone_id')
      .notNull()
      .references(() => milestones.id),
    model: text('model').notNull(),
    recommendation: text('recommendation').$type<'APPROVE' | 'REFUSE' | 'UNSURE'>().notNull(),
    confidence: text('confidence').$type<'HIGH' | 'MEDIUM' | 'LOW'>().notNull(),
    summary: text('summary').notNull(),
    reasons: text('reasons', { mode: 'json' }).$type<string[]>().notNull(),
    checks: text('checks', { mode: 'json' }).$type<AgentCheck[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('agent_reviews_milestone').on(t.milestoneId)],
);
