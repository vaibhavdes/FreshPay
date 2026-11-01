import type { PlotMilestone } from './engine/stateMachine';

// Photographs of a Robusta estate at Balamuri, Kodagu, February 2024, by Timothy A. Gonsalves
// on Wikimedia Commons (CC BY-SA 4.0), resized to 1,400 px.
export type StagePhoto = { src: string; alt: string; page: string };

const commons = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;

export const STAGE_PHOTOS: Record<PlotMilestone, StagePhoto> = {
  PLOT_VERIFIED: {
    src: '/photos/farm.jpg',
    alt: 'Coffee growing under tall shade trees beside a paddy field in Kodagu',
    page: commons('Coffee_Shade_Trees_Paddy_Fields_Coorg_Feb24_R16_07670.jpg'),
  },
  INPUTS: {
    src: '/photos/fertiliser.jpg',
    alt: 'Robusta coffee bushes under shade trees and pepper vines',
    page: commons('Coffee_Robusta_Pepper_Vines_Shade_Trees_Balamuri_Feb24_R16_07665.jpg'),
  },
  CROP_CARE: {
    src: '/photos/crop-care.jpg',
    alt: 'Flower buds on a Robusta coffee branch',
    page: commons('Flower_Buds_Coffee_Robusta_Coorg_Feb24_D72_25939.jpg'),
  },
  HARVEST: {
    src: '/photos/harvest.jpg',
    alt: 'A cluster of ripe red Robusta coffee cherries',
    page: commons('Ripe_Seeds_Coffee_Robusta_Coorg_Karnataka_India_Feb24_D72_25688.jpg'),
  },
  PROCESSING: {
    src: '/photos/processing.jpg',
    alt: 'Picked coffee cherries drying in the sun',
    page: commons('Beans_Drying_Coffee_Robusta_Balamuri_Coorg_Feb24_A7C_09491.jpg'),
  },
};

export const PHOTO_CREDIT = { author: 'Timothy A. Gonsalves', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' };
