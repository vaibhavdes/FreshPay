import type { PlotMilestone } from './engine/stateMachine';
import { coffeeTerms, type SeasonTerms, type StageTerms } from './season-terms';

// Starting points for a company posting an opportunity: the same engine with each crop's own
// stages, windows and bill caps. Yields and prices are typical figures to edit, not quotes; the
// coffee terms are the cited ones the shared season runs on (lib/season-terms.ts).
export type CropTemplate = {
  id: string;
  crop: string;
  commodity: string;
  country: string;
  region: string;
  buyer: string;
  // Where the default yield and price come from, shown next to the numbers.
  basis: string;
  terms: SeasonTerms;
  prompts: Record<PlotMilestone, string>;
};

const stage = (label: string, opensAt: string, closesAt: string, caps: StageTerms['caps'], farmerPercent: number): StageTerms => ({ label, opensAt, closesAt, caps, farmerPercent });

const MAPPED_PROMPT = "Stand on the farm with today's code.";

export const CROP_TEMPLATES: CropTemplate[] = [
  {
    id: 'coffee',
    crop: 'Arabica coffee',
    commodity: 'coffee',
    country: 'IN',
    region: 'Kodagu, Karnataka',
    buyer: 'a coffee roaster in Germany',
    basis: 'Coffee Board of India district yield (783 kg/ha clean Arabica, Chikkamagaluru) and Karnataka parchment prices, Oct 2026',
    terms: coffeeTerms('arabica'),
    prompts: {
      PLOT_VERIFIED: MAPPED_PROMPT,
      INPUTS: "Photograph the seller's bill and any labour bill next to the fertiliser bags, with today's code.",
      CROP_CARE: "Photograph the spray bill and the spraying crew's bill next to the treated plants, with today's code.",
      HARVEST: "Photograph the pickers' wage sheet next to the picked cherries, with today's code.",
      PROCESSING: "Photograph the pulper or lorry hire bill next to the dried coffee, with today's code.",
    },
  },
  {
    id: 'potato',
    crop: 'Processing potato',
    commodity: 'potato',
    country: 'IN',
    region: 'Banaskantha, Gujarat',
    buyer: 'a crisps maker',
    basis: 'Typical Gujarat rabi yield of about 30 t/ha and a contract rate near ₹14/kg; set your own',
    terms: {
      crop: 'potato',
      yieldKgPerHa: 30_000,
      priceCentsPerKg: 15,
      advancePercent: 50,
      stages: {
        PLOT_VERIFIED: stage('Farm mapped', '2026-10-01', '2026-11-30', {}, 0),
        INPUTS: stage('Seed potatoes planted', '2026-10-15', '2026-12-15', { INPUTS: 20, LABOUR: 3 }, 2),
        CROP_CARE: stage('Blight spray', '2026-12-01', '2027-01-31', { INPUTS: 5, LABOUR: 2 }, 1),
        HARVEST: stage('Harvest dug and graded', '2027-02-01', '2027-03-15', { LABOUR: 5, MACHINERY: 2 }, 2),
        PROCESSING: stage('Delivered to the factory', '2027-02-15', '2027-03-31', { MACHINERY: 3 }, 1),
      },
    },
    prompts: {
      PLOT_VERIFIED: MAPPED_PROMPT,
      INPUTS: "Photograph the seed and fertiliser bills next to the planted rows, with today's code.",
      CROP_CARE: "Photograph the fungicide bill and the spraying crew's bill next to the crop, with today's code.",
      HARVEST: "Photograph the diggers' wage sheet next to the graded potatoes, with today's code.",
      PROCESSING: "Photograph the lorry hire bill next to the loaded sacks, with today's code.",
    },
  },
  {
    id: 'cocoa',
    crop: 'Fine-flavour cocoa',
    commodity: 'cocoa',
    country: 'PE',
    region: 'San Martín',
    buyer: 'a chocolate maker in Belgium',
    basis: 'Typical smallholder yield near 900 kg/ha of dry beans and a farm-gate price to agree; set your own',
    terms: {
      crop: 'cocoa',
      yieldKgPerHa: 900,
      priceCentsPerKg: 400,
      advancePercent: 40,
      stages: {
        PLOT_VERIFIED: stage('Farm mapped', '2026-11-01', '2027-01-31', {}, 0),
        INPUTS: stage('Pruning and shade trees', '2026-12-01', '2027-02-28', { INPUTS: 4, LABOUR: 4 }, 2),
        CROP_CARE: stage('Pod disease control', '2027-01-15', '2027-04-30', { INPUTS: 2, LABOUR: 3 }, 1),
        HARVEST: stage('Pods harvested', '2027-04-01', '2027-07-31', { LABOUR: 8 }, 4),
        PROCESSING: stage('Fermented, dried and delivered', '2027-04-15', '2027-08-31', { MACHINERY: 3, LABOUR: 2 }, 2),
      },
    },
    prompts: {
      PLOT_VERIFIED: MAPPED_PROMPT,
      INPUTS: "Photograph the pruning crew's bill and the shade seedlings bill on the farm, with today's code.",
      CROP_CARE: "Photograph the treatment bill next to the treated trees, with today's code.",
      HARVEST: "Photograph the harvest crew's wage sheet next to the opened pods, with today's code.",
      PROCESSING: "Photograph the drying beans and the transport bill, with today's code.",
    },
  },
  {
    id: 'cotton',
    crop: 'Organic cotton',
    commodity: 'cotton',
    country: 'IN',
    region: 'Khargone, Madhya Pradesh',
    buyer: 'a clothing brand in Europe',
    basis: 'Typical organic seed-cotton yield near 1.2 t/ha and the 2025-26 MSP of ₹7,710 per quintal plus an organic premium; set your own',
    terms: {
      crop: 'cotton',
      yieldKgPerHa: 1200,
      priceCentsPerKg: 90,
      advancePercent: 40,
      stages: {
        PLOT_VERIFIED: stage('Farm mapped', '2027-04-01', '2027-06-15', {}, 0),
        INPUTS: stage('Organic seed and compost', '2027-05-15', '2027-07-15', { INPUTS: 8, LABOUR: 3 }, 2),
        CROP_CARE: stage('Bio-pesticide rounds', '2027-07-01', '2027-09-30', { INPUTS: 4, LABOUR: 2 }, 1),
        HARVEST: stage('Cotton picked', '2027-10-01', '2027-12-31', { LABOUR: 10 }, 3),
        PROCESSING: stage('Delivered to the gin', '2027-11-01', '2028-01-31', { MACHINERY: 3 }, 1),
      },
    },
    prompts: {
      PLOT_VERIFIED: MAPPED_PROMPT,
      INPUTS: "Photograph the seed and compost bills next to the sown field, with today's code.",
      CROP_CARE: "Photograph the bio-pesticide bill next to the crop, with today's code.",
      HARVEST: "Photograph the pickers' wage sheet next to the picked cotton, with today's code.",
      PROCESSING: "Photograph the transport bill next to the loaded bales, with today's code.",
    },
  },
];

export const cropTemplate = (id: string) => CROP_TEMPLATES.find((t) => t.id === id);

// What the stages of a template pay, in total, as a share of the crop's value.
export const stagesPercent = (terms: SeasonTerms) =>
  Object.values(terms.stages).reduce((sum, s) => sum + Object.values(s.caps).reduce((a, b) => a + (b ?? 0), 0) + s.farmerPercent, 0);

// The home page's "any crop" row.
export const PROGRAMMES = CROP_TEMPLATES.map((t) => ({
  id: t.id,
  crop: t.crop,
  origin: t.region,
  buyer: t.buyer,
  live: t.id === 'coffee',
  stages: Object.values(t.terms.stages).map((s) => s.label),
}));

// What the farmer is asked to photograph for a stage of this crop.
export const stagePrompt = (commodity: string, type: PlotMilestone) => (CROP_TEMPLATES.find((t) => t.commodity === commodity) ?? CROP_TEMPLATES[0]).prompts[type];
