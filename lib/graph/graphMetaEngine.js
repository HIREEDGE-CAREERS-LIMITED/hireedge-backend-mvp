import { loadRolesDataset } from "../dataset/loadDataset.js";

export function buildGraphMeta() {
  const roles = loadRolesDataset();
  let totalEdges = 0;
  const categories = {};
  const seniorities = {};

  for (const role of roles) {
    const category = role?.category || "Other";
    const seniority = role?.seniority || "Unknown";
    const nextCount = Array.isArray(role?.career_paths?.next_roles) ? role.career_paths.next_roles.length : 0;

    categories[category] = (categories[category] || 0) + 1;
    seniorities[seniority] = (seniorities[seniority] || 0) + 1;
    totalEdges += nextCount;
  }

  return {
    total_roles: roles.length,
    total_edges: totalEdges,
    categories,
    seniorities,
  };
}
