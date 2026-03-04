import fs from "fs";
import path from "path";

let cached = null;

function loadRoles() {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "data", "roles-enriched.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);
  cached = Array.isArray(json) ? json : Array.isArray(json?.results) ? json.results : [];
  return cached;
}

function bySlug(roles, slug) {
  const s = String(slug || "").trim().toLowerCase();
  return roles.find((r) => String(r.slug).toLowerCase() === s);
}

export default function handler(req, res) {
  try {
    const roles = loadRoles();
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: "Use ?from=data-analyst&to=analytics-manager" });
    }

    const start = bySlug(roles, from);
    const goal = bySlug(roles, to);

    if (!start) return res.status(404).json({ error: "FROM role not found" });
    if (!goal) return res.status(404).json({ error: "TO role not found" });

    // Build adjacency
    const adj = new Map();
    for (const r of roles) {
      const key = String(r.slug || "").toLowerCase();
      const next = r?.career_paths?.next_roles || [];
      const nextArr = Array.isArray(next) ? next.map((x) => String(x).toLowerCase()) : [];
      adj.set(key, nextArr);
    }

    // BFS shortest path
    const startSlug = String(start.slug).toLowerCase();
    const goalSlug = String(goal.slug).toLowerCase();

    const queue = [startSlug];
    const parent = new Map(); // child -> parent
    parent.set(startSlug, null);

    while (queue.length) {
      const cur = queue.shift();
      if (cur === goalSlug) break;

      const nxt = adj.get(cur) || [];
      for (const n of nxt) {
        if (!parent.has(n)) {
          parent.set(n, cur);
          queue.push(n);
        }
      }
    }

    if (!parent.has(goalSlug)) {
      return res.status(200).json({
        found: false,
        from: start.slug,
        to: goal.slug,
        path: [],
        message: "No path found using next_roles links",
      });
    }

    // Reconstruct
    const pathSlugs = [];
    let cur = goalSlug;
    while (cur) {
      pathSlugs.push(cur);
      cur = parent.get(cur);
    }
    pathSlugs.reverse();

    const pathRoles = pathSlugs
      .map((s) => bySlug(roles, s))
      .filter(Boolean)
      .map((r) => ({
        slug: r.slug,
        title: r.title,
        category: r.category,
        seniority: r.seniority,
      }));

    return res.status(200).json({
      found: true,
      from: start.slug,
      to: goal.slug,
      steps: pathRoles.length - 1,
      path: pathRoles,
    });
  } catch (e) {
    return res.status(500).json({
      error: "Failed to compute role path",
      details: e?.message || String(e),
    });
  }
}
