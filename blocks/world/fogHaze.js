import * as THREE from 'three';
import { WORLD_CONFIG } from '../../data/world.config.js';

export function createFogHaze() {
  const color = WORLD_CONFIG.fogColor;
  const fog = new THREE.FogExp2(color, WORLD_CONFIG.fogDensity);

  // Distant horizon haze plane to avoid empty background.
  const geo = new THREE.PlaneGeometry(220, 80, 1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });
  const haze = new THREE.Mesh(geo, mat);
  haze.position.set(0, 15, -60);

  return { fog, haze };
}
