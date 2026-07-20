import * as THREE from 'three';
import { WORLD_CONFIG } from '../../data/world.config.js';

export function createWaterReflection() {
  const geometry = new THREE.CircleGeometry(WORLD_CONFIG.oasisRadius, 64);
  const material = new THREE.MeshStandardMaterial({
    color: 0x0a1a3a,
    roughness: 0.05,
    metalness: 0.85,
    emissive: 0x112244,
    emissiveIntensity: 0.25,
  });
  const water = new THREE.Mesh(geometry, material);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.01;
  water.receiveShadow = true;

  const group = new THREE.Group();
  group.add(water);

  // Subtle shimmer ring.
  const ringGeo = new THREE.RingGeometry(WORLD_CONFIG.oasisRadius * 0.7, WORLD_CONFIG.oasisRadius * 0.75, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x42ffd2,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
  });
  const shimmer = new THREE.Mesh(ringGeo, ringMat);
  shimmer.rotation.x = -Math.PI / 2;
  shimmer.position.y = 0.02;
  group.add(shimmer);

  return {
    group,
    update(t) {
      const s = 0.7 + Math.sin(t * 0.8) * 0.08;
      shimmer.scale.setScalar(s);
      ringMat.opacity = 0.12 + Math.sin(t * 1.2) * 0.06;
    },
  };
}
