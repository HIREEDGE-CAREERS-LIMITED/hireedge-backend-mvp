import fs from "fs";
import path from "path";

let cached = null;

function loadRoles() {
  if (cached) return cached;

  const filePath = path.join(process.cwd(), "data", "roles-enriched.json");

  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);

  // dataset structure: { roles: [...] }
  const roles = json.roles || [];

  cached = roles;
  return cached;
}

export default function handler(req, res) {
  try {
    const roles = loadRoles();

    const categories = {};
    const seniorities = {};
    let edgeCount = 0;

    for (const r of roles) {
      const c = r.category || "Unknown";
      const s = r.seniority || "Unknown";

      categories[c] = (categories[c] || 0) + 1;
      seniorities[s] = (seniorities[s] || 0) + 1;

      const next = r.career_paths?.next_roles || [];
      if (Array.isArray(next)) edgeCount += next.length;
    }

    return res.status(200).json({
      total_roles: roles.length,
      total_edges: edgeCount,
      categories,
      seniorities
    });

  } catch (e) {
    return res.status(500).json({
      error: "Failed to load graph meta",
      details: e.message || String(e)
    });
  }
}
