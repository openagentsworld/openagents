import * as THREE from 'three';

export function createRaycastLandmarks(camera, renderer, landmarks, debugHud) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let hovered = null;

  function onPointerMove(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function onClick() {
    if (hovered) {
      console.log('[landmark:click]', hovered.userData.landmarkId, hovered.userData.landmarkName);
      debugHud.set('hovered', `CLICK: ${hovered.userData.landmarkName}`);
    }
  }

  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('click', onClick);

  function update() {
    raycaster.setFromCamera(mouse, camera);
    const targets = landmarks.entries.map((e) => e.root);
    const intersects = raycaster.intersectObjects(targets, true);

    if (intersects.length > 0) {
      let obj = intersects[0].object;
      while (obj && !obj.userData.landmarkId) obj = obj.parent;
      if (obj && obj !== hovered) {
        hovered = obj;
        debugHud.set('hovered', obj.userData.landmarkName);
        document.body.style.cursor = 'pointer';
      }
    } else if (hovered) {
      hovered = null;
      debugHud.set('hovered', '-');
      document.body.style.cursor = 'default';
    }
  }

  return { update, dispose() {
    renderer.domElement.removeEventListener('pointermove', onPointerMove);
    renderer.domElement.removeEventListener('click', onClick);
  }};
}
