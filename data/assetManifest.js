// Asset manifest for the OpenAgents World procedural demo.
// All assets are local or procedural. No runtime external fetch.

export const assetManifest = {
  models: [],
  textures: [],
  hdri: [],
  audio: [],
};

export const PALETTE = {
  background: 0x060816,
  basePlaza: 0x131a3d,
  neonCyan: 0x42ffd2,
  neonMagenta: 0xff78bc,
  warmGold: 0xffc85a,
  sandAccent: 0xc9a46a,
  warningRed: 0xff5b6e,
  plazaRing: 0x3fffd8,
  fog: 0x060816,
};

export const LANDMARKS = [
  {
    id: 'marketplace',
    name: 'Marketplace Kiosk',
    color: 0x42ffd2,
    position: { x: -5.5, y: 0, z: 2.5 },
    scale: 1,
  },
  {
    id: 'taskboard',
    name: 'Task Board Tower',
    color: 0xff78bc,
    position: { x: 5.2, y: 0, z: 2.8 },
    scale: 1,
  },
  {
    id: 'delivery',
    name: 'Delivery Portal',
    color: 0xffc85a,
    position: { x: 0, y: 0, z: -6.2 },
    scale: 1,
  },
  {
    id: 'review',
    name: 'Review Gate',
    color: 0x8fb2ff,
    position: { x: 0, y: 0, z: 6.5 },
    scale: 1,
  },
];

export const ROLES = {
  worker: {
    id: 'worker',
    label: 'Worker',
    bodyColor: 0x7f8cff,
    accent: 0x42ffd2,
    accessory: 'backpack',
    height: 1,
  },
  reviewer: {
    id: 'reviewer',
    label: 'Reviewer',
    bodyColor: 0xd58cff,
    accent: 0xff78bc,
    accessory: 'visor',
    height: 1.02,
  },
  owner: {
    id: 'owner',
    label: 'Owner/VIP',
    bodyColor: 0xffc85a,
    accent: 0xffd700,
    accessory: 'crest',
    height: 1.06,
  },
};
