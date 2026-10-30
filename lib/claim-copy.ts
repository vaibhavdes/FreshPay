import type { RejectReason, ReviewReason } from './engine/gate';
import type { PlotMilestone } from './engine/stateMachine';

export const MILESTONE_LABELS: Record<PlotMilestone, { title: string; prompt: string }> = {
  PLOT_VERIFIED: { title: 'Register your plot', prompt: 'Stand inside your plot with the code.' },
  INPUTS: { title: 'Inputs bought', prompt: "Show the fertiliser bags or the dealer's bill next to your plants with the code." },
  HARVEST: { title: 'Harvest picked', prompt: 'Show the picked cherries or the weighing slip with the code.' },
};

// What a farmer reads when a claim is held or refused: what happened and what to do next.
export const REASON_COPY: Record<RejectReason | ReviewReason, string> = {
  CONTRACT_NOT_ACTIVE: "The buyer hasn't funded this season yet, so nothing can be paid out.",
  MILESTONE_OUT_OF_ORDER: "This isn't the next payment for your plot. Check which step you are sending.",
  CHALLENGE_MISSING: "The code didn't match one we sent. Get a new code and try again.",
  CHALLENGE_MISMATCH: "The code didn't match the one we sent. Get a new code and try again.",
  CHALLENGE_EXPIRED: 'The code expired after 15 minutes. Get a new code and take the photo again.',
  CHALLENGE_USED: 'That code was already used. Get a new code.',
  VISION_CODE_MISMATCH: "Today's code couldn't be read in the photo. Write it larger and keep the paper in the frame.",
  OUTSIDE_PLOT: "Your phone wasn't at the plot. Send the evidence while you are standing on it.",
  OUTSIDE_WINDOW: "This payment isn't open right now.",
  EUDR_FAILED: 'Satellite data shows forest was cleared on this plot after 2020, so its payments are on hold. Talk to your cooperative.',
  ESCROW_EXCEEDED: "The season advance doesn't cover this payment yet. Your cooperative has been told.",
  PREMIUM_NOT_ALLOWED: 'This payment has no traceability premium.',
  NO_MANDATE: "The buyer hasn't approved premium payments yet.",
  MANDATE_EXCEEDED: "The buyer's premium limit is used up for now.",
  NOT_HELD_FOR_REVIEW: 'This payment is not waiting for a review.',
  REVIEWER_REFUSED: 'Your cooperative checked the evidence and could not accept it. Send new evidence.',
  EUDR_REVIEW: 'A person needs to look at the satellite check for your plot.',
  LOW_CONFIDENCE: 'Your cooperative will check the photo before paying.',
  ORACLE_UNAVAILABLE: "The photo couldn't be checked automatically. Your cooperative will review it.",
};
