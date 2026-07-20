import * as THREE from 'three';

export function createBloomMaterial(threshold, strength, radius) {
  // Returns a configured UnrealBloomPass ready for the composer.
  const { UnrealBloomPass } = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js');
  const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
  const pass = new UnrealBloomPass(resolution, strength, radius, threshold);
  return pass;
}
