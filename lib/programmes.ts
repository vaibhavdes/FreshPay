// Contract templates: the same engine with different stages. Only coffee runs live in this demo;
// the others show the settings a company would pick.
export type Programme = {
  id: string;
  crop: string;
  origin: string;
  buyer: string;
  live: boolean;
  stages: string[];
};

export const PROGRAMMES: Programme[] = [
  {
    id: 'coffee',
    crop: 'Coffee',
    origin: 'Chikkamagaluru, India',
    buyer: 'a coffee roaster in Germany',
    live: true,
    stages: ['Farm mapped', 'Fertiliser bought', 'Crop care', 'Harvest picked', 'Delivered by quality'],
  },
  {
    id: 'potato',
    crop: 'Potato',
    origin: 'Gujarat, India',
    buyer: 'a crisps maker',
    live: false,
    stages: ['Farm mapped', 'Seed potatoes planted', 'Blight spray', 'Harvest graded', 'Delivered by size'],
  },
  {
    id: 'cocoa',
    crop: 'Cocoa',
    origin: 'San Martín, Peru',
    buyer: 'a chocolate maker in Belgium',
    live: false,
    stages: ['Farm mapped', 'Pruning and shade trees', 'Fermented and dried', 'Delivered by bean quality'],
  },
  {
    id: 'cotton',
    crop: 'Organic cotton',
    origin: 'Madhya Pradesh, India',
    buyer: 'a clothing brand in Europe',
    live: false,
    stages: ['Farm mapped', 'Organic seed sown', 'Compost applied', 'Delivered by weight', 'Good-practice bonus'],
  },
];
