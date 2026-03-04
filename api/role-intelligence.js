import fs from "fs";
import path from "path";

let cached = null;

const META = {
  version: "1.0.0",
  source: "HireEdge Role Intelligence Dataset (internal)",
};

// Read once and cache in memory
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

    const {
      slug,
      q,
      category,
      seniority,
      limit = "25",
      offset = "0",
    } = req.query;

    const runtimeMeta = {
      ...META,
      last_updated: new Date().toISOString(),
    };

    // ---------- 1) Exact lookup by slug ----------
    if (slug) {
      const cleanSlug = String(slug).trim().toLowerCase();

      const found = roles.find(
        (r) => String(r.slug).trim().toLowerCase() === cleanSlug
      );

      if (!found) {
        return res.status(404).json({
          ...runtimeMeta,
          error: "Role not found",
          slug: cleanSlug,
        });
      }

      // Related roles: same category, excluding itself
      const related = roles
        .filter(
          (r) =>
            r.category === found.category &&
            String(r.slug).trim().toLowerCase() !== cleanSlug
        )
        .slice(0, 8)
        .map((r) => ({
          slug: r.slug,
          title: r.title,
          seniority: r.seniority,
        }));

      return res.status(200).json({
        ...runtimeMeta,
        ...found,
        related_roles: related,
      });
    }

    // ---------- 2) Filters + search ----------
    let results = roles;

    if (category) {
      results = results.filter((r) => r.category === category);
    }

    if (seniority) {
      results = results.filter((r) => r.seniority === seniority);
    }

    if (q) {
      const qq = String(q).trim().toLowerCase();

      results = results.filter((r) => {
        const title = String(r.title || "").toLowerCase();
        const rslug = String(r.slug || "").toLowerCase();
        const skills = Array.isArray(r.skills) ? r.skills : [];

        return (
          title.includes(qq) ||
          rslug.includes(qq) ||
          skills.some((s) => String(s).toLowerCase().includes(qq))
        );
      });
    }

    // suggestions = top 8 (after filters/search)
    const suggestions = q
      ? results.slice(0, 8).map((r) => ({ slug: r.slug, title: r.title }))
      : [];

    const lim = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    return res.status(200).json({
      ...runtimeMeta,
      total: results.length,
      limit: lim,
      offset: off,
      suggestions,
      results: results.slice(off, off + lim),
    });
  } catch (e) {
    return res.status(500).json({
      ...META,
      last_updated: new Date().toISOString(),
      error: "Failed to load role intelligence data",
      details: e?.message || String(e),
    });
  }
}
