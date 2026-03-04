// api/role-graph.js
import fs from "fs";
import path from "path";

function loadRolesEnriched() {
  // Your repo structure shows: /data/roles-enriched.json exists
  const filePath = path.join(process.cwd(), "data", "roles-enriched.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  const json = JSON.parse(raw);

  // Support both shapes:
  // 1) { roles: [...] }
  // 2) [ ... ]
  const roles = Array.isArray(json) ? json : json.roles;

  if (!Array.isArray(roles)) {
    throw new Error("roles-enriched.json format invalid (expected array or {roles:[]})");
  }
  return roles;
}

function pickRoleFields(r) {
  return {
    slug: r.slug,
    title: r.title,
    category: r.category,
    seniority: r.seniority,
  };
}

export default function handler(req, res) {
  try {
    const { slug, depth } = req.query;

    if (!slug) {
      return res.status(400).json({ error: "Missing required query param: slug" });
    }

    const maxDepth = Math.min(parseInt(depth || "2", 10) || 2, 5);

    const roles = loadRolesEnriched();
    const bySlug = new Map(roles.map((r) => [r.slug, r]));

    const root = bySlug.get(slug);
    if (!root) {
      return res.status(404).json({
        error: "Role not found",
        hint: "Check slug exists in data/roles-enriched.json",
        slug,
      });
    }

    // BFS graph expansion using career_paths.next_roles
    const nodesMap = new Map();
    const links = [];

    nodesMap.set(root.slug, pickRoleFields(root));

    const queue = [{ slug: root.slug, level: 0 }];
    const visited = new Set([root.slug]);

    while (queue.length) {
      const { slug: currentSlug, level } = queue.shift();
      if (level >= maxDepth) continue;

      const current = bySlug.get(currentSlug);
      if (!current) continue;

      const next = current?.career_paths?.next_roles || [];
      if (!Array.isArray(next)) continue;

      for (const nextSlug of next) {
        const target = bySlug.get(nextSlug);
        if (!target) continue;

        // add node
        if (!nodesMap.has(target.slug)) {
          nodesMap.set(target.slug, pickRoleFields(target));
        }

        // add link
        links.push({
          source: currentSlug,
          target: target.slug,
          type: "next_role",
        });

        // continue BFS
        if (!visited.has(target.slug)) {
          visited.add(target.slug);
          queue.push({ slug: target.slug, level: level + 1 });
        }
      }
    }

    const nodes = Array.from(nodesMap.values());

    return res.status(200).json({
      version: "1.0.0",
      root: pickRoleFields(root),
      depth: maxDepth,
      nodes,
      links,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to build role graph",
      details: err?.message || String(err),
    });
  }
}
