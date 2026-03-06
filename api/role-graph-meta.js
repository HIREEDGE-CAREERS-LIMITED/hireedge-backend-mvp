// api/role-graph-meta.js
import fs from "fs";
import path from "path";

let CACHE = null;
let CACHE_AT = 0;
const CACHE_MS = 1000 * 60 * 10; // 10 minutes

function loadMeta() {
  const now = Date.now();
  if (CACHE && now - CACHE_AT < CACHE_MS) {
    return CACHE;
  }

  const filePath = path.join(process.cwd(), "data", "roles-enriched.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);

  // Support either:
  // 1) array root: [ {...}, {...} ]
  // 2) object root: { roles: [ {...}, {...} ] }
  const roles = Array.isArray(parsed) ? parsed : parsed.roles || [];

  let total_edges = 0;
  const categories = {};
  const seniorities = {};

  const roleList = roles.map((r) => {
    const slug = r.slug;
    const title = r.title || r.slug;
    const category = r.category || "Other";
    const seniority = r.seniority || "Unknown";

    categories[category] = (categories[category] || 0) + 1;
    seniorities[seniority] = (seniorities[seniority] || 0) + 1;

    const nextCount = Array.isArray(r?.career_paths?.next_roles)
      ? r.career_paths.next_roles.length
      : 0;

    total_edges += nextCount;

    return {
      slug,
      title,
      category,
      seniority,
    };
  });

  CACHE = {
    total_roles: roles.length,
    total_edges,
    categories,
    seniorities,
    roles: roleList,
  };

  CACHE_AT = now;
  return CACHE;
}

export default function handler(req, res) {
  try {
    const data = loadMeta();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: err?.message || "Failed to load role graph meta",
    });
  }
}
