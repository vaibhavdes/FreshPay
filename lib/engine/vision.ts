import type { PlotMilestone } from './stateMachine';

export const CROP_STAGES = ['SOWING', 'VEGETATIVE', 'FLOWERING', 'FRUITING', 'MATURE', 'HARVESTED', 'DAMAGED', 'UNKNOWN'] as const;
export type CropStage = (typeof CROP_STAGES)[number];

// What a photo of each stage can plausibly show, for any crop: fertiliser goes on from sowing
// until the crop ripens, crop care runs through flowering and fruiting, and harvest shows a
// mature or picked crop.
const STAGES_FOR: Record<PlotMilestone, readonly CropStage[]> = {
  PLOT_VERIFIED: ['SOWING', 'VEGETATIVE', 'FLOWERING', 'FRUITING', 'MATURE', 'HARVESTED'],
  INPUTS: ['SOWING', 'VEGETATIVE', 'FRUITING', 'MATURE'],
  CROP_CARE: ['VEGETATIVE', 'FLOWERING', 'FRUITING', 'MATURE', 'DAMAGED'],
  HARVEST: ['MATURE', 'HARVESTED'],
  PROCESSING: ['HARVESTED'],
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
