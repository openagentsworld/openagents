import * as THREE from 'three';
import { LANDMARKS } from '../../data/assetManifest.js';

function makeLabelTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(6,8,22,0.82)';
  ctx.roundRect(8, 8, 496, 112, 24);
  ctx.fill();
  ctx.strokeStyle = '#' + new THREE.Color(color).getHexString();
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.font = 'bold 42px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createLandmarks() {
  const group = new THREE.Group();
  const entries = [];

  LANDMARKS.forEach((lm) => {
    const root = new THREE.Group();
    root.position.set(lm.position.x, lm.position.y, lm.position.z);
    root.userData.landmarkId = lm.id;
    root.userData.landmarkName = lm.name;

    // Base pedestal.
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.95, 0.25, 32),
      new THREE.MeshStandardMaterial({ color: 0x1e2858, roughness: 0.7, metalness: 0.25 })
    );
    base.position.y = 0.125;
    base.receiveShadow = true;
    base.castShadow = true;
    root.add(base);

    // Vertical core.
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.28, 2.4, 24),
      new THREE.MeshStandardMaterial({ color: 0x131a3d, roughness: 0.6, metalness: 0.35 })
    );
    core.position.y = 1.25;
    core.castShadow = true;
    root.add(core);

    // Glowing ring / top.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.06, 12, 48),
      new THREE.MeshStandardMaterial({
        color: lm.color,
        emissive: lm.color,
        emissiveIntensity: 1.2,
        roughness: 0.3,
      })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 2.5;
    root.add(ring);

    // Icon label floating above.
    const labelTex = makeLabelTexture(lm.name, lm.color);
    const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, opacity: 0.95 });
    const label = new THREE.Sprite(labelMat);
    label.position.y = 3.4;
    label.scale.set(3.2, 0.8, 1);
    root.add(label);

    // Hologram plane (task cards / scanner beam placeholder).
    const holo = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1.4),
      new THREE.MeshBasicMaterial({
        color: lm.color,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    holo.position.set(0.6, 1.6, 0);
    root.add(holo);

    group.add(root);
    entries.push({ root, ring, holo, label, labelMat, color: lm.color, phase: Math.random() * Math.PI * 2 });
  });

  return {
    group,
    entries,
    update(t) {
      entries.forEach((e) => {
        e.ring.rotation.z = t * 0.35 + e.phase;
        e.holo.material.opacity = 0.08 + Math.sin(t * 2 + e.phase) * 0.05;
        e.labelMat.opacity = 0.9 + Math.sin(t * 1.5 + e.phase) * 0.08;
      });
    },
  };
}
