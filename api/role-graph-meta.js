// api/role-graph-meta.js
// Returns lightweight metadata + full role list for dropdowns/autocomplete.

const fs = require("fs");
const path = require("path");

let CACHE = null;
let CACHE_AT = 0;
const CACHE_MS = 1000 * 60 * 10; // 10 min

function loadRoles() {
  const now = Date.now();
  if (CACHE && now - CACHE_AT < CACHE_MS) return CACHE;

  const filePath = path.join(process.cwd(), "data", "roles-enriched.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const roles = JSON.parse(raw);

  // totals
  const total_roles = Array.isArray(roles) ? roles.length : 0;

  // edges
  let total_edges = 0;
  const categories = {};
  const seniorities = {};

  const roleList = (roles || []).map((r) => {
    const slug = r.slug;
    const title = r.title || r.slug;
    const category = r.category || "Other";
    const seniority = r.seniority || "Unknown";

    // counts
    categories[category] = (categories[category] || 0) + 1;
    seniorities[seniority] = (seniorities[seniority] || 0) + 1;

    const next = Array.isArray(r.career_paths?.next_roles) ? r.career_paths.next_roles.length : 0;
    total_edges += next;

    return { slug, title, category, seniority };
  });

  CACHE = {
    total_roles,
    total_edges,
    categories,
    seniorities,
    roles: roleList, // ✅ key fix for dropdown
  };
  CACHE_AT = now;

  return CACHE;
}

module.exports = (req, res) => {
  try {
    const data = loadRoles();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({
      error: err?.message || "Failed to load role graph meta",
    });
  }
};
