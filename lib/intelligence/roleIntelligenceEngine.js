import { loadRolesDataset } from "../dataset/loadDataset.js";

export function getRoleIntelligence(slug) {
  const roles = loadRolesDataset();
  return roles.find((role) => role?.slug === slug) || null;
}
