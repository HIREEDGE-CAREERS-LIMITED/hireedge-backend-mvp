import { loadRolesDataset } from "./loadDataset.js";

export function buildRoleIndex() {
  const roles = loadRolesDataset();
  return new Map(
    roles
      .filter((role) => role && role.slug)
      .map((role) => [role.slug, role])
  );
}
