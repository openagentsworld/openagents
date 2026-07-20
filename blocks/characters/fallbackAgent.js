import * as THREE from 'three';
import { createNameplate } from './nameplates.js';

export function createFallbackAgent(roleConfig) {
  const group = new THREE.Group();
  const { bodyColor, accent, accessory, height, label } = roleConfig;
  const scale = height;

  // Body (capsule with better proportions).
  const bodyGeo = new THREE.CapsuleGeometry(0.24, 0.58, 6, 14);
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.5, metalness: 0.1 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.86 * scale;
  body.castShadow = true;
  group.add(body);

  // Head.
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0x222848, roughness: 0.4, metalness: 0.2 })
  );
  head.position.y = 1.42 * scale;
  head.castShadow = true;
  group.add(head);

  // Visor.
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.07, 0.12),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.4 })
  );
  visor.position.set(0, 1.45 * scale, 0.12);
  group.add(visor);

  // Shoulders.
  const shoulderGeo = new THREE.SphereGeometry(0.12, 12, 12);
  const shoulderMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.55, metalness: 0.15 });
  const leftShoulder = new THREE.Mesh(shoulderGeo, shoulderMat);
  leftShoulder.position.set(-0.28, 1.2 * scale, 0);
  group.add(leftShoulder);
  const rightShoulder = new THREE.Mesh(shoulderGeo, shoulderMat);
  rightShoulder.position.set(0.28, 1.2 * scale, 0);
  group.add(rightShoulder);

  // Role accessories.
  if (accessory === 'backpack') {
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.45, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x3a446e, roughness: 0.6, metalness: 0.25 })
    );
    pack.position.set(0, 0.95 * scale, -0.28);
    pack.castShadow = true;
    group.add(pack);
  } else if (accessory === 'visor') {
    const scanner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.22, 12),
      new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.2 })
    );
    scanner.rotation.z = Math.PI / 2;
    scanner.position.set(0.22, 1.25 * scale, 0.18);
    group.add(scanner);
  } else if (accessory === 'crest') {
    const crest = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.24, 4),
      new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.8, roughness: 0.3 })
    );
    crest.position.set(0, 1.72 * scale, -0.16);
    crest.rotation.x = -0.2;
    group.add(crest);
  }

  // Nameplate.
  const nameplate = createNameplate(label, accent);
  group.add(nameplate.sprite);

  return {
    group,
    body,
    head,
    visor,
    nameplate,
    baseY: 0,
    phase: Math.random() * Math.PI * 2,
  };
}
