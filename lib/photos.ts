import type { PlotMilestone } from './engine/stateMachine';

export type StagePhoto = { src: string; alt: string; page: string; author: string; license: string; licenseUrl: string };

const photo = (src: string, alt: string, file: string, author: string, license: string): StagePhoto => ({
  src,
  alt,
  page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replaceAll(' ', '_'))}`,
  author,
  license,
  licenseUrl: LICENSES[license],
});

const LICENSES: Record<string, string> = {
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
  'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
  'CC BY-SA 2.0': 'https://creativecommons.org/licenses/by-sa/2.0/',
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0/',
};

export const STAGE_PHOTOS: Record<string, Record<PlotMilestone, StagePhoto>> = {
  coffee: {
    PLOT_VERIFIED: photo('/photos/coffee/farm.jpg', 'Coffee growing under tall shade trees in Chikmagalur', 'Traditional shade coffee plantation Chikmagalur 1.jpg', 'Anand Osuri', 'CC BY-SA 4.0'),
    INPUTS: photo('/photos/coffee/inputs.jpg', 'A Robusta coffee bush with ripening cherries in Yercaud', 'Coffea canephora-1-five road-yercaud-salem-India.jpg', 'Yercaud-elango', 'CC BY-SA 4.0'),
    CROP_CARE: photo('/photos/coffee/crop-care.jpg', 'A Robusta coffee branch with green cherries', 'Coffee Plant Robusta.jpg', 'Gaurav Pant', 'CC BY-SA 3.0'),
    HARVEST: photo('/photos/coffee/harvest.jpg', 'A hand picking ripe coffee cherries', 'Hands-that-are-picking-coffee-beans-from-coffee-tree.jpg', 'Saddymonster', 'CC BY-SA 4.0'),
    PROCESSING: photo('/photos/coffee/processing.jpg', 'Coffee cherries drying on tarpaulins', 'WAE - Coffee cherries drying in Wae Rebo, Flores, Indonesia, 2019.jpg', 'Josep M. Gracia', 'CC BY-SA 4.0'),
  },
  potato: {
    PLOT_VERIFIED: photo('/photos/potato/farm.jpg', 'A potato field in leaf', 'Potato Field-1.jpg', 'Trikutdas', 'CC BY-SA 4.0'),
    INPUTS: photo('/photos/potato/inputs.jpg', 'Rows of young potato plants', 'Potatoe fields in Todarpur.jpg', 'Abdullah 467', 'CC BY-SA 4.0'),
    CROP_CARE: photo('/photos/potato/crop-care.jpg', 'Potato plants in flower', 'Potato flower.jpg', 'Debojyoti payal', 'CC BY-SA 4.0'),
    HARVEST: photo('/photos/potato/harvest.jpg', 'A farmer beside a heap of dug potatoes', 'Potatofarmer.jpg', 'Vishalsh521', 'CC BY-SA 3.0'),
    PROCESSING: photo('/photos/potato/processing.jpg', 'Workers grading potatoes beside filled sacks', 'Potato harvest in Himachal Pradesh India 2011.jpg', 'CIAT', 'CC BY-SA 2.0'),
  },
  cotton: {
    PLOT_VERIFIED: photo('/photos/cotton/farm.jpg', 'A cleared cotton field ready for sowing', 'After cutting anf picking the cotton crop.jpg', 'Muralikrishna m', 'CC BY 4.0'),
    INPUTS: photo('/photos/cotton/inputs.jpg', 'A young cotton crop in leaf', 'Cotton crop in the field.JPG', 'Bhaskaranaidu', 'CC BY-SA 3.0'),
    CROP_CARE: photo('/photos/cotton/crop-care.jpg', 'Cotton plants with opening bolls in Bhopal', 'Cotton Plant in Bhopal 003.jpg', 'Suyash.dwivedi', 'CC BY-SA 4.0'),
    HARVEST: photo('/photos/cotton/harvest.jpg', 'A woman picking cotton in Raichur', 'Woman picking cotton in Raichur, Karnataka.jpg', 'Nanditha Gogate, WELL Labs', 'CC BY-SA 4.0'),
    PROCESSING: photo('/photos/cotton/processing.jpg', 'Picked cotton heaped at the Raichur cotton market', 'Women heaping cotton in Raichur\'s cotton market.jpg', 'Nanditha Gogate, WELL Labs', 'CC BY-SA 4.0'),
  },
  cocoa: {
    PLOT_VERIFIED: photo('/photos/cocoa/farm.jpg', 'A cocoa farm visit in Pachiza, San Martín', 'Ruta turística del cacao de Alto el Sol.JPG', 'Municipalidad distrital de Pachiza', 'CC BY 3.0'),
    INPUTS: photo('/photos/cocoa/inputs.jpg', 'Cocoa pods ripening on the trunk', 'Matadecacao.jpg', 'Luisovalles', 'CC BY 3.0'),
    CROP_CARE: photo('/photos/cocoa/crop-care.jpg', 'A cocoa pod blackened by disease', 'Theobroma cacao 443605446.jpg', 'Leonel Roget', 'CC BY 4.0'),
    HARVEST: photo('/photos/cocoa/harvest.jpg', 'A cocoa pod opened at harvest in the Peruvian Amazon', 'Digital Inclusion in the Peruvian Amazon - 48138694956.jpg', 'USAID Digital Development', 'CC BY 2.0'),
    PROCESSING: photo('/photos/cocoa/processing.jpg', 'Cocoa beans drying under a roof', 'Sao Tome Monteforte Cocoa Beans Drying 3 (15629101423).jpg', 'Chuck Moravec', 'CC BY 2.0'),
  },
};

export const stagePhotos = (commodity: string) => STAGE_PHOTOS[commodity] ?? null;
