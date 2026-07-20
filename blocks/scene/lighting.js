import * as THREE from 'three';

export function createLighting(scene) {
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x100718, 1.0);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(7, 12, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 50;
  key.shadow.camera.left = -18;
  key.shadow.camera.right = 18;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -18;
  scene.add(key);

  // Neon accent lights — no shadows.
  const cyanAccent = new THREE.PointLight(0x42ffd2, 2.5, 18);
  cyanAccent.position.set(-6, 2.5, -4);
  scene.add(cyanAccent);

  const magentaAccent = new THREE.PointLight(0xff78bc, 2.2, 16);
  magentaAccent.position.set(6, 2.2, 2);
  scene.add(magentaAccent);

  return { hemi, key, cyanAccent, magentaAccent };
}
