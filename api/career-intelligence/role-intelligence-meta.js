import fs from "fs";
import path from "path";

let cached = null;

const META = {
  version: "1.0.0",
  source: "HireEdge Role Intelligence Dataset (internal)",
};

function loadEnrichedRoles() {
  if (cached) return cached;

  const filePath = path.join(process.cwd(), "data", "roles-enriched.json");
  const raw = fs.readFileSync(filePath, "utf8");
  cached = JSON.parse(raw);

  return cached;
}

export default function handler(req, res) {
  try {
    const roles = loadEnrichedRoles();

    const categoriesMap = {};
    const senioritiesMap = {};

    for (const r of roles) {
      const c = r.category || "Unknown";
      const s = r.seniority || "Unknown";

      categoriesMap[c] = (categoriesMap[c] || 0) + 1;
      senioritiesMap[s] = (senioritiesMap[s] || 0) + 1;
    }

    const categories = Object.keys(categoriesMap)
      .sort()
      .map((name) => ({ name, count: categoriesMap[name] }));

    const seniorities = Object.keys(senioritiesMap)
      .sort()
      .map((name) => ({ name, count: senioritiesMap[name] }));

    return res.status(200).json({
      ...META,
      last_updated: new Date().toISOString(),
      total_roles: roles.length,
      categories,
      seniorities,
    });
  } catch (e) {
    return res.status(500).json({
      ...META,
      last_updated: new Date().toISOString(),
      error: "Failed to load meta data",
      details: e?.message || String(e),
    });
  }
}
