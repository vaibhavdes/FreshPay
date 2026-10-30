import type { PlotMilestone } from './stateMachine';

export const CROP_STAGES = ['VEGETATIVE', 'FLOWERING', 'GREEN_CHERRY', 'RIPE_CHERRY', 'HARVESTED', 'DAMAGED', 'UNKNOWN'] as const;
export type CropStage = (typeof CROP_STAGES)[number];

// Stages a photo can plausibly show for each milestone, following the Chikkamagaluru calendar
// (Coffee Board CCRI guide): inputs go on Aug-Nov while cherries develop, flowering is Mar-Apr,
// and harvest is Nov-Jan for Arabica, Dec-Feb for Robusta.
const STAGES_FOR: Record<PlotMilestone, readonly CropStage[]> = {
  PLOT_VERIFIED: ['VEGETATIVE', 'FLOWERING', 'GREEN_CHERRY', 'RIPE_CHERRY', 'HARVESTED'],
  INPUTS: ['VEGETATIVE', 'GREEN_CHERRY', 'RIPE_CHERRY'],
  CROP_CARE: ['VEGETATIVE', 'FLOWERING', 'GREEN_CHERRY', 'DAMAGED'],
  HARVEST: ['RIPE_CHERRY', 'HARVESTED'],
};

// A stage that doesn't fit the claim caps confidence below the gate's threshold, so a human looks.
export const STAGE_MISMATCH_CONFIDENCE = 0.5;

// Handwriting is compared without case, spaces or dashes; codes avoid look-alike characters.
export const normalizeCode = (code: string | null) => (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export type VisionReading = { challengeCodeRead: string | null; cropStage: CropStage; confidence: number };

export function visionVerdict(reading: VisionReading, issuedCode: string, milestone: PlotMilestone) {
  const codeMatch = reading.challengeCodeRead !== null && normalizeCode(reading.challengeCodeRead) === normalizeCode(issuedCode);
  const stageFits = STAGES_FOR[milestone].includes(reading.cropStage);
  const confidence = stageFits ? reading.confidence : Math.min(reading.confidence, STAGE_MISMATCH_CONFIDENCE);
  return { codeMatch, stageFits, confidence };
}
