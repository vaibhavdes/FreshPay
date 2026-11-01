import type { PlotMilestone } from './engine/stateMachine';
import { coffeeTerms, type SeasonTerms, type StageTerms } from './season-terms';

// Starting points for a company posting an opportunity: the same engine with each crop's own
// stages, windows and bill caps. Each default yield and price comes from the published figure in
// its `basis`; the company edits them to its own contract. Rupee and sol figures use the FBIL
// rate in lib/season-terms.ts.
//
// Sources
//  Coffee: lib/season-terms.ts (Coffee Board of India, Database on Coffee, July 2023, Table 1.10).
//  Potato: Banaskantha 2024-25 yield 30.65 t/ha, Gujarat agriculture department figures reported by
//    DeshGujarat, 23 Aug 2025; Banaskantha mandi average Rs 1,550 per quintal, 23 Dec 2025.
//  Cocoa: San Martín average 400 kg/ha dry beans (Gobierno Regional de San Martín, 2022, cited in
//    Agroindustrial Science, Universidad Nacional de Trujillo); price set at the international
//    level of US$5,800/t, January 2026 (Gestión).
//  Cotton: Madhya Pradesh 2024-25 provisional, 15.35 lakh bales of 170 kg on 5.37 lakh ha
//    (Committee on Cotton Production and Consumption) = 486 kg lint/ha, about 1,430 kg seed cotton
//    at a 34% ginning out-turn; price the 2026-27 MSP of Rs 8,267 per quintal, medium staple
//    (Cabinet Committee on Economic Affairs, 13 May 2026).
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
    basis: 'Coffee Board of India: Kodagu Arabica yield 734 kg/ha clean coffee (2022-23); Karnataka parchment price, Oct 2026',
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
    basis: 'Banaskantha yield 30.65 t/ha (Gujarat, 2024-25); Banaskantha mandi average ₹1,550 per quintal (Dec 2025)',
    terms: {
      crop: 'potato',
      yieldKgPerHa: 30_650,
      priceCentsPerKg: 16,
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
    basis: 'San Martín average 400 kg/ha dry beans (regional government, 2022); international price US$5,800 per tonne (Jan 2026)',
    terms: {
      crop: 'cocoa',
      yieldKgPerHa: 400,
      priceCentsPerKg: 580,
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
    crop: 'Cotton',
    commodity: 'cotton',
    country: 'IN',
    region: 'Khargone, Madhya Pradesh',
    buyer: 'a clothing brand in Europe',
    basis: 'Madhya Pradesh 486 kg/ha lint, about 1,430 kg/ha seed cotton (2024-25); minimum support price ₹8,267 per quintal (2026-27)',
    terms: {
      crop: 'cotton',
      yieldKgPerHa: 1430,
      priceCentsPerKg: 87,
      advancePercent: 40,
      stages: {
        PLOT_VERIFIED: stage('Farm mapped', '2027-04-01', '2027-06-15', {}, 0),
        INPUTS: stage('Seed and fertiliser', '2027-05-15', '2027-07-15', { INPUTS: 8, LABOUR: 3 }, 2),
        CROP_CARE: stage('Pest control rounds', '2027-07-01', '2027-09-30', { INPUTS: 4, LABOUR: 2 }, 1),
        HARVEST: stage('Cotton picked', '2027-10-01', '2027-12-31', { LABOUR: 10 }, 3),
        PROCESSING: stage('Delivered to the gin', '2027-11-01', '2028-01-31', { MACHINERY: 3 }, 1),
      },
    },
    prompts: {
      PLOT_VERIFIED: MAPPED_PROMPT,
      INPUTS: "Photograph the seed and fertiliser bills next to the sown field, with today's code.",
      CROP_CARE: "Photograph the pesticide bill next to the crop, with today's code.",
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
