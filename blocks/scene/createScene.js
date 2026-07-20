import * as THREE from 'three';
import { WORLD_CONFIG } from '../../data/world.config.js';

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(WORLD_CONFIG.background);
  scene.fog = new THREE.FogExp2(WORLD_CONFIG.fogColor, WORLD_CONFIG.fogDensity);
  return scene;
}
