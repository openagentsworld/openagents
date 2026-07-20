import * as THREE from 'three';
import { WORLD_CONFIG } from '../../data/world.config.js';
import { PALETTE } from '../../data/assetManifest.js';

export function createTerrainOasis() {
  const group = new THREE.Group();

  // Cyber plaza base.
  const plazaMat = new THREE.MeshStandardMaterial({
    color: PALETTE.basePlaza,
    roughness: 0.85,
    metalness: 0.12,
  });
  const plaza = new THREE.Mesh(
    new THREE.CylinderGeometry(WORLD_CONFIG.oasisRadius * 1.6, WORLD_CONFIG.groundRadius, 0.35, 96),
    plazaMat
  );
  plaza.position.y = -0.18;
  plaza.receiveShadow = true;
  group.add(plaza);

  // Outer terra/sand ring.
  const sandMat = new THREE.MeshStandardMaterial({
    color: PALETTE.sandAccent,
    roughness: 0.95,
    metalness: 0.02,
  });
  const sandRing = new THREE.Mesh(
    new THREE.RingGeometry(WORLD_CONFIG.oasisRadius * 1.6 + 0.1, WORLD_CONFIG.groundRadius, 96),
    sandMat
  );
  sandRing.rotation.x = -Math.PI / 2;
  sandRing.position.y = -0.16;
  sandRing.receiveShadow = true;
  group.add(sandRing);

  // Neon ring trim.
  const neonTrim = new THREE.Mesh(
    new THREE.TorusGeometry(WORLD_CONFIG.oasisRadius * 1.6, 0.035, 12, 180),
    new THREE.MeshStandardMaterial({
      color: PALETTE.plazaRing,
      emissive: PALETTE.plazaRing,
      emissiveIntensity: 0.85,
      roughness: 0.4,
    })
  );
  neonTrim.rotation.x = Math.PI / 2;
  neonTrim.position.y = 0.02;
  group.add(neonTrim);

  return {
    group,
    update(t) {
      neonTrim.rotation.z = t * 0.06;
    },
  };
}
