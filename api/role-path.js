import rolesData from "../data/roles-enriched.json";

function normSlug(s) {
  if (!s) return "";
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
}

function buildIndex(rolesArr) {
  const map = new Map();
  for (const r of rolesArr) map.set(r.slug, r);
  return map;
}

function bfsPath(from, to, index) {
  // Standard BFS for shortest path
  const queue = [from];
  const visited = new Set([from]);
  const parent = new Map(); // child -> parent

  while (queue.length) {
    const cur = queue.shift();
    if (cur === to) break;

    const role = index.get(cur);
    const next = role?.career_paths?.next_roles || [];

    for (const nxt of next) {
      if (!index.has(nxt)) continue;
      if (visited.has(nxt)) continue;
      visited.add(nxt);
      parent.set(nxt, cur);
      queue.push(nxt);
    }
  }

  if (!visited.has(to)) return null;

  // Reconstruct path
  const path = [];
  let cur = to;
  while (cur) {
    path.push(cur);
    cur = parent.get(cur);
    if (cur === from) {
      path.push(from);
      break;
    }
  }
  return path.reverse();
}

export default function handler(req, res) {
  try {
    const roles = rolesData.roles || [];
    const index = buildIndex(roles);

    const fromRaw = req.query.from;
    const toRaw = req.query.to;

    const from = normSlug(fromRaw);
    const to = normSlug(toRaw);

    if (!from || !to) {
      return res.status(400).json({
        error: "Missing required query params: from, to",
        example: "/api/role-path?from=data-analyst&to=product-manager",
      });
    }

    if (!index.has(from)) {
      return res.status(404).json({ error: "FROM role not found", from });
    }
    if (!index.has(to)) {
      return res.status(404).json({ error: "TO role not found", to });
    }

    const slugPath = bfsPath(from, to, index);

    if (!slugPath) {
      const fromRole = index.get(from);
      const suggestions = fromRole?.career_paths?.next_roles || [];
      return res.status(404).json({
        error: "No career path found between roles (multi-step)",
        from,
        to,
        suggestions,
      });
    }

    const nodes = slugPath.map((slug) => {
      const r = index.get(slug);
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
      steps: nodes.length - 1,
      path: nodes,
      slugs: slugPath,
    });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e) });
  }
}
