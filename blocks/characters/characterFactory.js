import * as THREE from 'three';
import { createFallbackAgent } from './fallbackAgent.js';
import { getRoleConfig, ROLE_IDS } from './roleVariants.js';

export function createCharacterCrowd(scene, count = 8) {
  const group = new THREE.Group();
  scene.add(group);

  const agents = [];
  for (let i = 0; i < count; i++) {
    const roleId = ROLE_IDS[i % ROLE_IDS.length];
    const config = getRoleConfig(roleId);
    const agent = createFallbackAgent(config);

    const a = (i / count) * Math.PI * 2;
    const r = 2.4 + (i % 3) * 0.9;
    agent.group.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    agent.group.rotation.y = -a + Math.PI / 2;
    agent.orbitAngle = a;
    agent.orbitRadius = r;

    group.add(agent.group);
    agents.push(agent);
  }

  return {
    group,
    agents,
    update(t) {
      agents.forEach((agent, i) => {
        const bob = Math.sin(t * 1.8 + agent.phase) * 0.05;
        agent.group.position.y = bob;

        // Gentle idle rotation/wave.
        agent.group.rotation.y = -agent.orbitAngle + Math.PI / 2 + Math.sin(t * 0.7 + i) * 0.12;

        // Slow orbital drift.
        const a = agent.orbitAngle + Math.sin(t * 0.12 + agent.phase) * 0.04;
        agent.group.position.x = Math.cos(a) * agent.orbitRadius;
        agent.group.position.z = Math.sin(a) * agent.orbitRadius;
      });
    },
  };
}
