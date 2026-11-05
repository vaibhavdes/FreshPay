// Grades a delivered lot from what the AI saw in a sample photo. The AI only estimates the share
// of each defect; these rules turn that into a grade and the quality % the buyer pays for, and say
// when a person has to confirm before any money is captured.

export const GRADED_CROPS = ['coffee', 'cocoa', 'potato', 'cotton'] as const;
export type GradedCrop = (typeof GRADED_CROPS)[number];

export const DEFECTS = ['BLACK_OR_SOUR', 'INSECT_DAMAGED', 'BROKEN', 'MOULDY', 'SLATY', 'GERMINATED_OR_FLAT', 'ROT', 'GREENING', 'CUTS_OR_BRUISES', 'UNDERSIZE', 'TRASH', 'STAINED', 'IMMATURE', 'FOREIGN_MATTER'] as const;
export type Defect = (typeof DEFECTS)[number];

type Rule = { defect: Defect; label: string; weight: number };
type Rubric = { sample: string; rules: Rule[]; grade: (pct: Partial<Record<Defect, number>>, weighted: number) => string; contractGrades: string[]; source: string };

const bands = (weighted: number) => (weighted <= 3 ? 'A' : weighted <= 8 ? 'B' : 'Below contract');

export const RUBRICS: Record<GradedCrop, Rubric> = {
  coffee: {
    sample: 'green coffee beans',
    rules: [
      { defect: 'BLACK_OR_SOUR', label: 'Black or sour beans', weight: 1 },
      { defect: 'INSECT_DAMAGED', label: 'Insect-damaged beans', weight: 1 },
      { defect: 'BROKEN', label: 'Broken beans', weight: 0.5 },
      { defect: 'FOREIGN_MATTER', label: 'Husk, stones or sticks', weight: 1 },
    ],
    grade: (_, weighted) => bands(weighted),
    contractGrades: ['A', 'B'],
    source: 'Contract tolerances for defect beans in a green coffee sample',
  },
  cocoa: {
    sample: 'dried cocoa beans',
    rules: [
      { defect: 'MOULDY', label: 'Mouldy beans', weight: 1 },
      { defect: 'SLATY', label: 'Slaty (unfermented) beans', weight: 0.5 },
      { defect: 'INSECT_DAMAGED', label: 'Insect-damaged beans', weight: 1 },
      { defect: 'GERMINATED_OR_FLAT', label: 'Germinated or flat beans', weight: 0.5 },
      { defect: 'FOREIGN_MATTER', label: 'Foreign matter', weight: 1 },
    ],
    // ICCO limits: Grade I at most 3% mouldy, 3% slaty and 3% insect-damaged, germinated or flat;
    // Grade II at most 4%, 8% and 6%.
    grade: (p) => {
      const insectOrFlat = (p.INSECT_DAMAGED ?? 0) + (p.GERMINATED_OR_FLAT ?? 0);
      const [m, s] = [p.MOULDY ?? 0, p.SLATY ?? 0];
      return m <= 3 && s <= 3 && insectOrFlat <= 3 ? 'Grade I' : m <= 4 && s <= 8 && insectOrFlat <= 6 ? 'Grade II' : 'Below grade';
    },
    contractGrades: ['Grade I', 'Grade II'],
    source: 'ICCO grade limits for mouldy, slaty and insect-damaged cocoa beans',
  },
  potato: {
    sample: 'dug potatoes',
    rules: [
      { defect: 'ROT', label: 'Rotten tubers', weight: 1 },
      { defect: 'GREENING', label: 'Green skin', weight: 1 },
      { defect: 'CUTS_OR_BRUISES', label: 'Cuts or bruises', weight: 0.5 },
      { defect: 'UNDERSIZE', label: 'Undersized tubers', weight: 0.5 },
    ],
    grade: (_, weighted) => bands(weighted),
    contractGrades: ['A', 'B'],
    source: 'Contract tolerances for processing potatoes',
  },
  cotton: {
    sample: 'picked seed cotton',
    rules: [
      { defect: 'TRASH', label: 'Leaf and trash', weight: 1 },
      { defect: 'STAINED', label: 'Stained or yellow cotton', weight: 1 },
      { defect: 'IMMATURE', label: 'Immature or weak bolls', weight: 0.5 },
    ],
    grade: (_, weighted) => bands(weighted),
    contractGrades: ['A', 'B'],
    source: 'Contract tolerances for trash and stained seed cotton',
  },
};

export const isGradedCrop = (crop: string): crop is GradedCrop => (GRADED_CROPS as readonly string[]).includes(crop);

export type GradingReading = { cropSeen: string; isLotSample: boolean; defects: { defect: Defect; percent: number }[]; confidence: number };

export type PersonReason = 'WRONG_CROP' | 'NOT_A_SAMPLE' | 'LOW_CONFIDENCE' | 'BELOW_CONTRACT';
export const PERSON_COPY: Record<PersonReason, string> = {
  WRONG_CROP: "The photo doesn't show this contract's crop.",
  NOT_A_SAMPLE: "The photo isn't a clear sample of the delivered lot.",
  LOW_CONFIDENCE: "The AI isn't sure of its reading.",
  BELOW_CONTRACT: 'The lot looks below contract grade, so a person confirms before the price is cut.',
};

export type LotGrade = {
  grade: string | null;
  qualityPercent: number | null;
  defects: { defect: Defect; label: string; percent: number }[];
  needsPerson: PersonReason[];
  source: string;
};

export const MIN_GRADING_CONFIDENCE = 0.8;

export function gradeLot(crop: GradedCrop, reading: GradingReading): LotGrade {
  const rubric = RUBRICS[crop];
  const needsPerson: PersonReason[] = [];
  if (reading.cropSeen !== crop) needsPerson.push('WRONG_CROP');
  if (!reading.isLotSample) needsPerson.push('NOT_A_SAMPLE');
  if (reading.confidence < MIN_GRADING_CONFIDENCE) needsPerson.push('LOW_CONFIDENCE');
  if (needsPerson.includes('WRONG_CROP') || needsPerson.includes('NOT_A_SAMPLE')) return { grade: null, qualityPercent: null, defects: [], needsPerson, source: rubric.source };

  // Only the defects this crop is graded on count; anything else the model reports is ignored.
  const pct: Partial<Record<Defect, number>> = {};
  for (const d of reading.defects) {
    if (rubric.rules.some((r) => r.defect === d.defect)) pct[d.defect] = Math.min(100, Math.max(0, (pct[d.defect] ?? 0) + d.percent));
  }
  const weighted = rubric.rules.reduce((sum, r) => sum + r.weight * (pct[r.defect] ?? 0), 0);
  const grade = rubric.grade(pct, weighted);
  if (!rubric.contractGrades.includes(grade)) needsPerson.push('BELOW_CONTRACT');
  return {
    grade,
    qualityPercent: Math.max(0, Math.min(100, Math.round(100 - weighted))),
    defects: rubric.rules.map((r) => ({ defect: r.defect, label: r.label, percent: Math.round((pct[r.defect] ?? 0) * 10) / 10 })),
    needsPerson,
    source: rubric.source,
  };
}
