import * as THREE from 'three';
import { WORLD_CONFIG } from '../../data/world.config.js';
import { PALETTE } from '../../data/assetManifest.js';

export function createCityRing(count = WORLD_CONFIG.cityRingCount) {
  const group = new THREE.Group();

  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  buildingGeo.translate(0, 0.5, 0);
  const buildingMat = new THREE.MeshStandardMaterial({
    color: 0x1a2455,
    roughness: 0.72,
    metalness: 0.18,
  });
  const neonMat = new THREE.MeshStandardMaterial({
    color: PALETTE.neonCyan,
    emissive: PALETTE.neonCyan,
    emissiveIntensity: 0.9,
    roughness: 0.4,
  });

  const mesh = new THREE.InstancedMesh(buildingGeo, buildingMat, count);
  const neonMesh = new THREE.InstancedMesh(buildingGeo, neonMat, count);

  const dummy = new THREE.Object3D();
  const dummyNeon = new THREE.Object3D();
  const radius = WORLD_CONFIG.cityRingRadius;

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    const h = 2 + (i % 6) * 0.9;

    dummy.position.set(x, -0.2, z);
    dummy.scale.set(0.7 + (i % 3) * 0.2, h, 0.7 + (i % 3) * 0.2);
    dummy.lookAt(0, -0.2, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    // Neon cap band.
    dummyNeon.position.set(x, h - 0.3, z);
    dummyNeon.scale.set(0.72, 0.08, 0.72);
    dummyNeon.lookAt(0, h - 0.3, 0);
    dummyNeon.updateMatrix();
    neonMesh.setMatrixAt(i, dummyNeon.matrix);
  }

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  group.add(neonMesh);

  return {
    group,
    update(t) {
      // Slow skyline drift pulse.
      neonMat.emissiveIntensity = 0.7 + Math.sin(t * 0.9) * 0.25;
    },
  };
}
