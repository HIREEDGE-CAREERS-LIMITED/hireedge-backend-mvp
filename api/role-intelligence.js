import fs from "fs";
import path from "path";

let cached = null;

/**
 * Loads roles data safely from JSON file.
 * Supports:
 *  - Array: [ {...}, {...} ]
 *  - Object wrappers: { roles: [...] } or { results: [...] } or { data: [...] }
 */
function loadEnrichedRoles() {
  if (cached) return cached;

  // ✅ IMPORTANT: Your file name is roles-enriched.json (as per your data folder)
  const filePath = path.join(process.cwd(), "data", "roles-enriched.json");

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);

  // ✅ Ensure we always return an ARRAY
  const rolesArr = Array.isArray(parsed)
    ? parsed
    : parsed.roles || parsed.results || parsed.data || [];

  cached = rolesArr;
  return cached;
}

export default function handler(req, res) {
  try {
    const roles = loadEnrichedRoles();

    const {
      slug,
      q,
      category,
      seniority,
      limit = "25",
      offset = "0",
    } = req.query;

    // ✅ Meta info (useful for frontend)
    const META = {
      version: "1.0.0",
      last_updated: new Date().toISOString(),
      source: "HireEdge Role Intelligence Dataset (internal)",
    };

    // 1) Exact lookup by slug
    if (slug) {
      const found = roles.find(
        (r) => String(r.slug || "").trim().toLowerCase() === String(slug).trim().toLowerCase()
      );

      if (!found) return res.status(404).json({ error: "Role not found" });

      // ✅ Related roles (same category)
      const related = roles
        .filter(
          (r) =>
            r.category === found.category &&
            String(r.slug || "") !== String(found.slug || "")
        )
        .slice(0, 8)
        .map((r) => ({
          slug: r.slug,
          title: r.title,
          seniority: r.seniority,
        }));

      return res.status(200).json({
        ...META,
        ...found,
        related_roles: related,
      });
    }

    // 2) Filters + search
    let results = roles;

    if (category) {
      results = results.filter((r) => r.category === category);
    }

    if (seniority) {
      results = results.filter((r) => r.seniority === seniority);
    }

    if (q) {
      const qq = String(q).trim().toLowerCase();
      results = results.filter(
        (r) =>
          String(r.title || "").toLowerCase().includes(qq) ||
          String(r.slug || "").toLowerCase().includes(qq) ||
          (Array.isArray(r.skills) &&
            r.skills.some((s) => String(s).toLowerCase().includes(qq)))
      );
    }

    // ✅ Suggestions for autocomplete
    const suggestions = q
      ? results.slice(0, 8).map((r) => ({ slug: r.slug, title: r.title }))
      : [];

    const lim = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    return res.status(200).json({
      ...META,
      total: results.length,
      limit: lim,
      offset: off,
      suggestions,
      results: results.slice(off, off + lim),
    });
  } catch (e) {
    return res.status(500).json({
      error: "Failed to load role dataset",
      details: e?.message || String(e),
    });
  }
}
