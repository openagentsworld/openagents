import * as THREE from 'three';

export function createNameplate(label, color = 0xffffff) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(6,8,22,0.78)';
  ctx.roundRect(6, 6, 372, 84, 18);
  ctx.fill();
  ctx.strokeStyle = '#' + new THREE.Color(color).getHexString();
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.font = 'bold 34px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 192, 48);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.95 });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.8, 0.45, 1);
  sprite.position.y = 2.05;
  return { sprite, material };
}
