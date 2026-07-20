import * as THREE from 'three';
import { WORLD_CONFIG } from '../../data/world.config.js';

function makeGradientTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#0b1a45');
  grad.addColorStop(0.55, '#c9a46a');
  grad.addColorStop(0.72, '#' + new THREE.Color(WORLD_CONFIG.background).getHexString());
  grad.addColorStop(1.0, '#' + new THREE.Color(WORLD_CONFIG.background).getHexString());
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSkyDome() {
  const geometry = new THREE.SphereGeometry(90, 24, 16);
  const material = new THREE.MeshBasicMaterial({
    map: makeGradientTexture(),
    side: THREE.BackSide,
    depthWrite: false,
  });

  const dome = new THREE.Mesh(geometry, material);
  return { dome };
}
