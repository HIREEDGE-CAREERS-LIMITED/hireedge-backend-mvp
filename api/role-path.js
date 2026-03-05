// Stable role-path API (BFS shortest path)
// Uses require() for JSON so Vercel bundles it correctly (no fs crashes)

const dataset = require("../data/roles-enriched.json");

function normalizeSlug(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

module.exports = (req, res) => {
  try {
    const from = normalizeSlug(req.query.from);
    const to = normalizeSlug(req.query.to);

    if (!from || !to) {
      return res.status(400).json({
        error: "Missing required query params: from, to",
        example: "/api/role-path?from=data-analyst&to=product-manager",
      });
    }

    const roles = dataset.roles || [];
    const bySlug = new Map(roles.map((r) => [r.slug, r]));

    if (!bySlug.has(from)) {
      return res.status(404).json({ error: "FROM role not found", from });
    }
    if (!bySlug.has(to)) {
      return res.status(404).json({ error: "TO role not found", to });
    }

    // adjacency list: slug -> next roles
    const adj = new Map();
    for (const r of roles) {
      const next = (r.career_paths?.next_roles || []).filter(Boolean);
      adj.set(r.slug, next);
    }

    // BFS
    const queue = [from];
    const prev = new Map();
    const seen = new Set([from]);

    while (queue.length) {
      const cur = queue.shift();
      if (cur === to) break;

      const nexts = adj.get(cur) || [];
      for (const n of nexts) {
        if (!bySlug.has(n)) continue;
        if (seen.has(n)) continue;
        seen.add(n);
        prev.set(n, cur);
        queue.push(n);
      }
    }

    if (!seen.has(to)) {
      return res.status(404).json({
        error: "No path found",
        from,
        to,
        suggestions: (bySlug.get(from).career_paths?.next_roles || []).slice(0, 10),
      });
    }

    // rebuild path
    const pathSlugs = [];
    let cur = to;
    while (cur) {
      pathSlugs.push(cur);
      if (cur === from) break;
      cur = prev.get(cur);
    }
    pathSlugs.reverse();

    const steps = pathSlugs.map((slug) => {
      const r = bySlug.get(slug);
      return {
        slug: r.slug,
        title: r.title,
        category: r.category,
        seniority: r.seniority,
      };
    });

    return res.status(200).json({
      from,
      to,
      steps_count: steps.length,
      steps,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Backend role-path failed",
      detail: String(err?.message || err),
    });
  }
};
