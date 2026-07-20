import * as THREE from 'three';

export function createWind() {
  const direction = new THREE.Vector3(1, 0, 0.35).normalize();
  return {
    direction,
    speed: 0.35,
    gust(t) {
      return 0.5 + Math.sin(t * 0.7) * 0.5;
    },
  };
}
