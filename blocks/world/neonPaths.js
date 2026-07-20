import * as THREE from 'three';
import { LANDMARKS } from '../../data/assetManifest.js';

export function createNeonPaths() {
  const group = new THREE.Group();
  const curves = [];

  for (let i = 0; i < LANDMARKS.length; i++) {
    const a = LANDMARKS[i];
    const b = LANDMARKS[(i + 1) % LANDMARKS.length];
    const mid = new THREE.Vector3(
      (a.position.x + b.position.x) * 0.5,
      0.08,
      (a.position.z + b.position.z) * 0.5
    );
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(a.position.x, 0.06, a.position.z),
      mid,
      new THREE.Vector3(b.position.x, 0.06, b.position.z),
    ]);
    curves.push({ curve, color: a.color, phase: i });
  }

  const tubeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x42ffd2,
    emissiveIntensity: 0.9,
    roughness: 0.3,
    transparent: true,
    opacity: 0.85,
  });

  const meshes = [];
  curves.forEach(({ curve, color }) => {
    const geo = new THREE.TubeGeometry(curve, 48, 0.045, 8, false);
    const mat = tubeMaterial.clone();
    mat.emissive = new THREE.Color(color);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
    meshes.push({ mesh, mat, color });
  });

  return {
    group,
    update(t) {
      meshes.forEach(({ mat }, i) => {
        mat.emissiveIntensity = 0.6 + Math.sin(t * 2 + i) * 0.35;
        mat.opacity = 0.7 + Math.sin(t * 1.5 + i) * 0.15;
      });
    },
  };
}
