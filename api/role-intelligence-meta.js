import fs from "fs";
import path from "path";

let cached = null;

function loadEnrichedRoles() {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "data", "roles-enriched.json");
  cached = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return cached;
}

export default function handler(req, res) {
  try {
    const roles = loadEnrichedRoles();

    const categories = Array.from(new Set(roles.map((r) => r.category))).sort();
    const seniorities = Array.from(new Set(roles.map((r) => r.seniority))).sort();

    return res.status(200).json({
      total_roles: roles.length,
      categories,
      seniorities,
    });
  } catch (e) {
    return res.status(500).json({
      error: "Failed to load meta",
      details: e?.message || String(e),
    });
  }
}
