import * as THREE from 'three';

export function createParticlesDust(count = 180) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 26;
    positions[i * 3 + 1] = Math.random() * 6;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 26;
    speeds[i] = 0.2 + Math.random() * 0.4;
    phases[i] = Math.random() * Math.PI * 2;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xc9d4ff,
    size: 0.06,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);

  return {
    group: points,
    update(t, wind) {
      const pos = geometry.attributes.position.array;
      for (let i = 0; i < count; i++) {
        pos[i * 3] += Math.sin(t * 0.5 + phases[i]) * 0.01 + wind.direction.x * wind.speed * 0.01;
        pos[i * 3 + 1] += Math.cos(t * 0.3 + phases[i]) * 0.005;
        pos[i * 3 + 2] += Math.cos(t * 0.4 + phases[i]) * 0.01 + wind.direction.z * wind.speed * 0.01;

        if (pos[i * 3 + 1] > 6) pos[i * 3 + 1] = 0;
        if (Math.abs(pos[i * 3]) > 14) pos[i * 3] *= -0.9;
        if (Math.abs(pos[i * 3 + 2]) > 14) pos[i * 3 + 2] *= -0.9;
      }
      geometry.attributes.position.needsUpdate = true;
    },
  };
}
