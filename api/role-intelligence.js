mport fs from "fs";
import path from "path";

let cached = null;

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

    // 1) exact lookup by slug
    if (slug) {
      const found = roles.find(
        (r) => r.slug === String(slug).trim().toLowerCase()
      );

      if (!found) return res.status(404).json({ error: "Role not found" });

      return res.status(200).json(found);
    }

    // 2) filters + search
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
          r.title.toLowerCase().includes(qq) ||
          r.slug.toLowerCase().includes(qq) ||
          (Array.isArray(r.skills) &&
            r.skills.some((s) => String(s).toLowerCase().includes(qq)))
      );
    }

    const lim = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    return res.status(200).json({
      total: results.length,
      limit: lim,
      offset: off,
      results: results.slice(off, off + lim),
    });
  } catch (e) {
    return res.status(500).json({
      error: "Failed to load role intelligence data",
      details: e?.message || String(e),
    });
  }
}
