import fs from "fs";
import path from "path";

let cachedRoles = null;

export function loadRolesDataset() {
  if (cachedRoles) return cachedRoles;

  const datasetPath = path.join(process.cwd(), "data", "roles-enriched.json");

  try {
    const raw = fs.readFileSync(datasetPath, "utf-8");
    const parsed = JSON.parse(raw);

    const roles = Array.isArray(parsed) ? parsed : parsed.roles;

    if (!Array.isArray(roles)) {
      throw new Error("Invalid roles dataset format");
    }

    cachedRoles = roles;
    return cachedRoles;
  } catch {
    throw new Error("Failed to load HireEdge roles dataset");
  }
}
