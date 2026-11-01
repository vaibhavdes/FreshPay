import type { LngLat } from '../engine/geo';
import { SUPPLIER_KINDS } from '../engine/gate';
import { CROP_TEMPLATES, templateFor } from '../programmes';
import { plotValueCents as termsValueCents, SEASON, type Variety } from '../season-terms';

// One 2026-27 coffee season in Kodagu district, Karnataka, built on public figures. Two farm
// outlines are coffee plantations mapped on OpenStreetMap (© OpenStreetMap contributors, ODbL),
// shown as outlines, not ownership records. The third is drawn over forest that Global Forest
// Watch records as cleared in 2023-24. Tree cover loss for each
// outline is real GFW data (lib/db/geo-checks.json, from npm run prefetch:geo).
//
// Contract terms and their sources are in lib/season-terms.ts.

function plotRing([lng, lat]: LngLat, widthM: number, heightM: number, skewM = 0): LngLat[] {
  const toLng = (m: number) => m / (111_320 * Math.cos((lat * Math.PI) / 180));
  const toLat = (m: number) => m / 110_574;
  const w = widthM / 2;
  const h = heightM / 2;
  const corners: [number, number][] = [
    [-w, -h],
    [w, -h + skewM],
    [w * 0.94, h],
    [-w * 1.04, h - skewM],
  ];
  return corners.map(([x, y]) => [Number((lng + toLng(x)).toFixed(6)), Number((lat + toLat(y)).toFixed(6))]);
}

export const buyer = { id: 'buyer-lavazzo', name: 'Lavazzo Caffè S.p.A.', country: 'IT' };

export const cooperative = { id: 'coop-malnad', name: 'Malnad Coffee Growers FPO', region: 'Kodagu, Karnataka', country: 'IN' };

const coffeeSuppliers = templateFor('coffee').suppliers;
export const dealer = coffeeSuppliers.INPUTS;
export const supplierIds = { INPUTS: coffeeSuppliers.INPUTS.id, LABOUR: coffeeSuppliers.LABOUR.id, MACHINERY: coffeeSuppliers.MACHINERY.id };

// Every crop's local suppliers, so a season of any crop pays its own sellers, labour and hire.
export const suppliers = CROP_TEMPLATES.flatMap((t) => SUPPLIER_KINDS.map((kind) => ({ ...t.suppliers[kind], kind })));

export const farmers = [
  { id: 'farmer-lakshmi', name: 'Lakshmi Gowda' },
  { id: 'farmer-ravi', name: 'Ravi Shetty' },
  { id: 'farmer-savitha', name: 'Savitha Poojary' },
];

export type SeedPlot = { id: string; farmerId: string; name: string; variety: Variety; ring: LngLat[]; outline: string; scenario: string };

// Three plots, three outcomes: paid on proof, held and reviewed, withheld for deforestation.
export const plots: SeedPlot[] = [
  {
    id: 'plot-lakshmi',
    farmerId: 'farmer-lakshmi',
    name: 'Hill block, Kodagu',
    variety: 'arabica',
    ring: [[75.890197, 12.322514], [75.890274, 12.32259], [75.890623, 12.32281], [75.890728, 12.323067], [75.891143, 12.323994], [75.891404, 12.323866], [75.891599, 12.324217], [75.891852, 12.32411], [75.892023, 12.324086], [75.89209, 12.323711], [75.892289, 12.323748], [75.892165, 12.323455], [75.89187, 12.322928], [75.891795, 12.322548], [75.891825, 12.321895], [75.891677, 12.32145], [75.891559, 12.321272], [75.891409, 12.321209], [75.891176, 12.321235], [75.890728, 12.321392], [75.890599, 12.321733], [75.890883, 12.321859], [75.890674, 12.322364]],
    outline: 'OpenStreetMap way 1201453773',
    scenario: 'Clear evidence, paid the same minute',
  },
  {
    id: 'plot-ravi',
    farmerId: 'farmer-ravi',
    name: 'Stream block, Kodagu',
    variety: 'robusta',
    ring: [[75.811671, 12.417576], [75.811704, 12.417437], [75.81178, 12.417179], [75.811859, 12.417018], [75.811923, 12.416921], [75.811881, 12.416856], [75.811792, 12.416785], [75.811744, 12.416766], [75.811712, 12.41674], [75.811703, 12.416706], [75.811706, 12.416671], [75.811621, 12.416614], [75.811592, 12.416618], [75.811494, 12.416552], [75.811464, 12.416531], [75.811419, 12.416526], [75.811371, 12.416551], [75.811339, 12.416554], [75.811319, 12.416538], [75.811228, 12.416572], [75.811174, 12.416585], [75.811151, 12.416602], [75.811118, 12.416587], [75.811057, 12.4166], [75.811033, 12.416605], [75.810996, 12.416635], [75.810986, 12.416682], [75.810999, 12.41673], [75.810972, 12.416796], [75.810967, 12.416886], [75.810984, 12.416913], [75.810978, 12.417007], [75.811015, 12.417031], [75.811012, 12.417111], [75.81097, 12.417364], [75.810969, 12.417423], [75.811004, 12.417436], [75.811021, 12.417456], [75.811032, 12.417474], [75.81109, 12.417484], [75.811114, 12.417496], [75.811157, 12.41751], [75.811172, 12.417517], [75.811237, 12.417526], [75.811282, 12.417528], [75.811348, 12.417534], [75.811405, 12.417549], [75.811464, 12.417566], [75.811493, 12.417558], [75.811559, 12.417567], [75.811612, 12.417551]],
    outline: 'OpenStreetMap way 98170640',
    scenario: 'Fertiliser bill too blurry to read: held, checked by the review agent, approved by the cooperative',
  },
  {
    // Drawn over GFW/UMD tree cover loss of 2023-24, found with npm run find-loss.
    id: 'plot-savitha',
    farmerId: 'farmer-savitha',
    name: 'New clearing, Kodagu',
    variety: 'arabica',
    ring: plotRing([75.8925, 12.2955], 110, 100, 4),
    outline: 'Drawn over cleared forest (Global Forest Watch)',
    scenario: 'Forest cleared after 2020: every payment refused',
  },
];

export const contract = { id: 'contract-lavazzo-2026', commodity: 'coffee', season: SEASON, currency: 'USD' };

export { areaHa, VARIETIES, type Variety } from '../season-terms';

export const plotValueCents = (plot: SeedPlot) => termsValueCents(plot.variety, plot.ring);
