import { ROLES } from '../../data/assetManifest.js';

export function getRoleConfig(roleId) {
  return ROLES[roleId] || ROLES.worker;
}

export const ROLE_IDS = Object.keys(ROLES);
