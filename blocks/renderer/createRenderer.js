import * as THREE from 'three';
import { WORLD_CONFIG } from '../../data/world.config.js';

export function createRenderer(tier = 'med') {
  const isLow = tier === 'low';
  const renderer = new THREE.WebGLRenderer({
    antialias: !isLow,
    powerPreference: 'high-performance',
    alpha: false,
  });

  const pixelRatioCap = isLow ? 1 : WORLD_CONFIG.pixelRatioCap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = WORLD_CONFIG.exposure;
  renderer.shadowMap.enabled = tier !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  return renderer;
}
