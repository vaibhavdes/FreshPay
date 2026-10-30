// Season contracts the same engine runs with different settings. Only the coffee programme is
// live in this demo; the others show the milestones and checks a buyer would configure.
export type Programme = {
  id: string;
  crop: string;
  origin: string;
  buyer: string;
  why: string;
  live: boolean;
  milestones: { name: string; proof: string; paid: string }[];
  checks: string[];
};

export const PROGRAMMES: Programme[] = [
  {
    id: 'coffee-karnataka',
    crop: 'Coffee',
    origin: 'Chikkamagaluru, India',
    buyer: 'A coffee roaster in Germany',
    why: 'Must prove no forest was cleared for its coffee, and wants the same growers every season.',
    live: true,
    milestones: [
      { name: 'Plot registered', proof: 'Photo with the day’s code, standing on the plot', paid: '$25 to the farmer' },
      { name: 'Inputs bought', proof: 'Fertiliser bags or dealer bill, voice note', paid: '10% of plot value: 60% to the dealer, 40% to the farmer' },
      { name: 'Harvest picked', proof: 'Picked cherries or weighing slip', paid: '20% of plot value to the farmer' },
      { name: 'Lot delivered', proof: 'Weight and quality accepted at delivery', paid: 'The balance, for what passed quality' },
    ],
    checks: ['GPS inside the plot', 'Land check: no forest cleared after 2020', 'Weather for force majeure'],
  },
  {
    id: 'gherkins-karnataka',
    crop: 'Gherkins',
    origin: 'Karnataka, India',
    buyer: 'A pickle maker in Europe',
    why: 'Supplies the seed and buys the whole crop at a fixed price, so it needs every acre planted and sprayed on time.',
    live: false,
    milestones: [
      { name: 'Seedlings planted', proof: 'Photo of the planted rows with the code', paid: 'Planting labour to the farmer' },
      { name: 'Trellis and crop protection', proof: 'Trellis and spray products, voice note', paid: 'Mostly to the input dealer, the rest to the farmer' },
      { name: 'Picking graded', proof: 'Crates sorted by size at the collection centre', paid: 'By weight in each size grade' },
    ],
    checks: ['GPS inside the plot', 'Weather for force majeure'],
  },
  {
    id: 'cocoa-peru',
    crop: 'Cocoa',
    origin: 'San Martín, Peru',
    buyer: 'A chocolate maker in Belgium',
    why: 'Must prove no forest was cleared, and pays more for beans that are fermented and dried well.',
    live: false,
    milestones: [
      { name: 'Plot registered', proof: 'Photo with the code, standing on the plot', paid: 'A flat amount to the farmer' },
      { name: 'Pruning and shade trees', proof: 'Pruned trees and shade cover', paid: 'Labour to the farmer, saplings to the nursery' },
      { name: 'Fermented and dried', proof: 'Beans on the drying beds', paid: 'A quality premium to the farmer' },
    ],
    checks: ['GPS inside the plot', 'Land check: no forest cleared after 2020', 'Weather for force majeure'],
  },
  {
    id: 'cotton-madhya-pradesh',
    crop: 'Organic cotton',
    origin: 'Madhya Pradesh, India',
    buyer: 'A clothing brand in Europe',
    why: 'Pays a premium for cotton grown without synthetic fertiliser and wants proof from each field.',
    live: false,
    milestones: [
      { name: 'Organic seed sown', proof: 'Seed packet and sown field with the code', paid: 'Seed cost to the dealer' },
      { name: 'Bio-inputs applied', proof: 'Compost or bio-input bags in the field, voice note', paid: 'A practice premium to the farmer' },
      { name: 'Harvest delivered', proof: 'Weighing slip at the gin', paid: 'By accepted weight' },
    ],
    checks: ['GPS inside the plot', 'Weather for force majeure'],
  },
];
