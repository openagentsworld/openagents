import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { WORLD_CONFIG } from '../../data/world.config.js';

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const { threshold, strength, radius } = WORLD_CONFIG.bloom;
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    strength,
    radius,
    threshold
  );
  composer.addPass(bloomPass);

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    composer.setSize(width, height);
    bloomPass.resolution.set(width, height);
  }

  function setBloom(enabled) {
    bloomPass.enabled = enabled;
  }

  return { composer, bloomPass, resize, setBloom };
}
