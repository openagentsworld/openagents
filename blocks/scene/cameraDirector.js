import * as THREE from 'three';

export function createCameraDirector() {
  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 180);
  camera.position.set(0, 6.2, 13.5);
  camera.lookAt(0, 1.3, 0);

  const target = new THREE.Vector3(0, 1.3, 0);

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  function update(t) {
    // Slow cinematic orbit.
    const r = 13.5;
    camera.position.x = Math.sin(t * 0.08) * r * 0.35;
    camera.position.z = Math.cos(t * 0.08) * r * 0.85;
    camera.position.y = 6.2 + Math.sin(t * 0.04) * 0.4;
    camera.lookAt(target);
  }

  return { camera, resize, update };
}
