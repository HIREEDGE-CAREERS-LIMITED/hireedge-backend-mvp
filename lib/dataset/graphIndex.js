import { loadRolesDataset } from "./loadDataset.js";

export function buildGraphIndex() {
  const roles = loadRolesDataset();
  const bySlug = new Map();

  for (const role of roles) {
    if (!role?.slug) continue;
    bySlug.set(role.slug, {
      role,
      next_roles: Array.isArray(role?.career_paths?.next_roles) ? role.career_paths.next_roles : [],
      previous_roles: Array.isArray(role?.career_paths?.previous_roles) ? role.career_paths.previous_roles : [],
    });
  }

  return bySlug;
}
