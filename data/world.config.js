import { PALETTE } from './assetManifest.js';

export const WORLD_CONFIG = {
  background: PALETTE.background,
  fogDensity: 0.018,
  fogColor: PALETTE.fog,
  groundRadius: 14,
  oasisRadius: 4.2,
  cityRingRadius: 11,
  cityRingCount: 24,
  characterCount: 8,
  bloom: {
    threshold: 0.85,
    strength: 0.4,
    radius: 0.3,
  },
  exposure: 0.9,
  pixelRatioCap: 2,
  shadowMapSize: 2048,
};
