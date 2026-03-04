import fs from "fs";
import path from "path";

let cached = null;

function loadRoles() {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "data", "roles-enriched.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);

  // ✅ Ensure we always work with an ARRAY
  // Some builds accidentally wrap roles inside { results: [...] }
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
    const { slug, depth = "2" } = req.query;

    if (!slug) {
      return res.status(400).json({ error: "Missing slug. Use ?slug=data-analyst" });
    }

    const root = bySlug(roles, slug);
    if (!root) return res.status(404).json({ error: "Role not found" });

    const maxDepth = Math.min(Math.max(parseInt(depth, 10) || 2, 1), 5);

    // Build adjacency list from career_paths.next_roles
    const adj = new Map(); // slug -> [nextSlugs]
    for (const r of roles) {
      const key = String(r.slug || "").toLowerCase();
      const next = r?.career_paths?.next_roles || [];
      const nextArr = Array.isArray(next) ? next.map((x) => String(x).toLowerCase()) : [];
      adj.set(key, nextArr);
    }

    // BFS to collect nodes + edges up to depth
    const nodes = new Map(); // slug -> node data
    const edges = []; // { from, to }

    const queue = [{ slug: String(root.slug).toLowerCase(), d: 0 }];
    const visited = new Set([String(root.slug).toLowerCase()]);

    while (queue.length) {
      const { slug: cur, d } = queue.shift();

      const roleObj = bySlug(roles, cur);
      if (roleObj && !nodes.has(cur)) {
        nodes.set(cur, {
          slug: roleObj.slug,
          title: roleObj.title,
          category: roleObj.category,
          seniority: roleObj.seniority,
        });
      }

      if (d >= maxDepth) continue;

      const nxt = adj.get(cur) || [];
      for (const n of nxt) {
        edges.push({ from: cur, to: n });

        if (!visited.has(n)) {
          visited.add(n);
          queue.push({ slug: n, d: d + 1 });
        }

        // Add node details if present
        const nextRoleObj = bySlug(roles, n);
        if (nextRoleObj && !nodes.has(n)) {
          nodes.set(n, {
            slug: nextRoleObj.slug,
            title: nextRoleObj.title,
            category: nextRoleObj.category,
            seniority: nextRoleObj.seniority,
          });
        }
      }
    }

    return res.status(200).json({
      root: {
        slug: root.slug,
        title: root.title,
        category: root.category,
        seniority: root.seniority,
      },
      depth: maxDepth,
      node_count: nodes.size,
      edge_count: edges.length,
      nodes: Array.from(nodes.values()),
      edges,
    });
  } catch (e) {
    return res.status(500).json({
      error: "Failed to build role graph",
      details: e?.message || String(e),
    });
  }
}
