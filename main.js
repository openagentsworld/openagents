import * as THREE from 'three';
import { createRenderer } from './blocks/renderer/createRenderer.js';
import { detectCapabilities } from './blocks/renderer/capabilityDetect.js';
import { QUALITY_TIERS } from './blocks/renderer/qualityTiers.js';
import { createScene } from './blocks/scene/createScene.js';
import { createCameraDirector } from './blocks/scene/cameraDirector.js';
import { createLighting } from './blocks/scene/lighting.js';
import { createDebugHud } from './blocks/scene/debugHud.js';
import { createComposer } from './blocks/postfx/createComposer.js';
import { createTerrainOasis } from './blocks/world/terrainOasis.js';
import { createWaterReflection } from './blocks/world/waterReflection.js';
import { createFogHaze } from './blocks/world/fogHaze.js';
import { createSkyDome } from './blocks/world/skyDome.js';
import { createCityRing } from './blocks/world/cityRing.js';
import { createLandmarks } from './blocks/world/landmarks.js';
import { createNeonPaths } from './blocks/world/neonPaths.js';
import { createWind } from './blocks/world/wind.js';
import { createParticlesDust } from './blocks/world/particlesDust.js';
import { createCharacterCrowd } from './blocks/characters/characterFactory.js';
import { createRaycastLandmarks } from './blocks/interaction/raycastLandmarks.js';
import { createWorldEventsMock } from './blocks/interaction/worldEventsMock.js';

const app = document.getElementById('app');

// Detect capabilities with a temporary renderer, then create the real tiered renderer.
const tmpRenderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const caps = detectCapabilities(tmpRenderer);
tmpRenderer.dispose();

const quality = QUALITY_TIERS[caps.preferredTier];
const renderer = createRenderer(caps.preferredTier);
app.appendChild(renderer.domElement);
window.__renderer = renderer;
window.__qualityTier = caps.preferredTier;

// Scene.
const scene = createScene();
const { fog, haze } = createFogHaze();
if (quality.fog) {
  scene.fog = fog;
  scene.add(haze);
}

if (quality.skyDome) {
  const { dome } = createSkyDome();
  scene.add(dome);
}

// Camera & lights.
const cameraDirector = createCameraDirector();
createLighting(scene);

// World.
const terrain = createTerrainOasis();
scene.add(terrain.group);

const worldUpdatables = [terrain];

if (quality.reflection) {
  const water = createWaterReflection();
  scene.add(water.group);
  worldUpdatables.push(water);
}

const cityRing = createCityRing(quality.cityRingCount);
scene.add(cityRing.group);
worldUpdatables.push(cityRing);

const landmarks = createLandmarks();
scene.add(landmarks.group);
worldUpdatables.push(landmarks);

const neonPaths = createNeonPaths();
scene.add(neonPaths.group);
worldUpdatables.push(neonPaths);

const wind = createWind();
let dust = null;
if (quality.particles > 0) {
  dust = createParticlesDust(Math.floor(180 * quality.particles));
  scene.add(dust.group);
}

// Characters.
const crowd = createCharacterCrowd(scene, quality.characterCount);

// PostFX.
const composer = createComposer(renderer, scene, cameraDirector.camera);
composer.setBloom(quality.bloom);

// Interaction & debug.
const debugHud = createDebugHud();
debugHud.set('tier', caps.preferredTier);

const raycast = createRaycastLandmarks(cameraDirector.camera, renderer, landmarks, debugHud);
const eventsMock = createWorldEventsMock();

// Loading overlay removal.
const loading = document.getElementById('loading');
if (loading) loading.style.display = 'none';

// Resize.
window.addEventListener('resize', () => {
  cameraDirector.resize();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.resize();
});

// Main loop.
const timer = new THREE.Timer();
timer.connect(document);
function animate(timestamp) {
  timer.update(timestamp);
  const t = timer.getElapsed();

  cameraDirector.update(t);
  worldUpdatables.forEach((u) => u.update(t));
  if (dust) dust.update(t, wind);
  crowd.update(t);
  raycast.update();
  eventsMock.tick(t, landmarks);

  composer.composer.render();
  debugHud.update(renderer.info);

  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
