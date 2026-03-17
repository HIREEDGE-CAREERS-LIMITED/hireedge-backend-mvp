import fs from "fs";
import path from "path";

const DATA_PATH = path.join(process.cwd(), "data", "roles-enriched.json");

function loadRoles() {
  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  const parsed = JSON.parse(raw);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed && Array.isArray(parsed.roles)) {
    return parsed.roles;
  }

  throw new Error("Unsupported dataset structure in roles-enriched.json");
}

function normalizeEdge(edge) {
  if (!edge) return null;

  if (typeof edge === "string") {
    return { slug: edge };
  }

  if (typeof edge === "object" && edge.slug) {
    return { slug: edge.slug };
  }

  return null;
}

function getSlug(role) {
  return role?.slug || role?.id || null;
}

function buildRoleMap(roles) {
  const map = new Map();

  for (const role of roles) {
    const slug = getSlug(role);
    if (!slug) continue;
    map.set(slug, role);
  }

  return map;
}

function buildAdjacency(roleMap) {
  const adjacency = new Map();

  for (const [slug, role] of roleMap.entries()) {
    const nextRoles = role?.career_paths?.next_roles || [];
    const normalized = nextRoles
      .map(normalizeEdge)
      .filter(Boolean)
      .map((e) => e.slug)
      .filter((targetSlug) => roleMap.has(targetSlug));

    adjacency.set(slug, [...new Set(normalized)]);
  }

  return adjacency;
}

function bfsShortestPath(adjacency, from, to) {
  if (!adjacency.has(from) || !adjacency.has(to)) return null;
  if (from === to) return [from];

  const visited = new Set([from]);
  const queue = [[from]];

  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    const neighbors = adjacency.get(current) || [];

    for (const next of neighbors) {
      if (visited.has(next)) continue;

      const nextPath = [...path, next];
      if (next === to) return nextPath;

      visited.add(next);
      queue.push(nextPath);
    }
  }

  return null;
}

function dfsAllPaths(adjacency, from, to, maxDepth = 5, maxResults = 5) {
  const results = [];

  function walk(current, target, path, visited) {
    if (results.length >= maxResults) return;
    if (path.length - 1 > maxDepth) return;

    if (current === target) {
      results.push([...path]);
      return;
    }

    const neighbors = adjacency.get(current) || [];
    for (const next of neighbors) {
      if (visited.has(next)) continue;

      visited.add(next);
      path.push(next);
      walk(next, target, path, visited);
      path.pop();
      visited.delete(next);
    }
  }

  if (!adjacency.has(from) || !adjacency.has(to)) return [];

  walk(from, to, [from], new Set([from]));
  return results;
}

function buildPathResponse(path, roleMap) {
  if (!Array.isArray(path) || path.length === 0) return null;

  const roles = path.map((slug) => {
    const role = roleMap.get(slug);
    return {
      slug,
      title: role?.title || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      category: role?.category || null,
      seniority: role?.seniority || null,
      salary_uk: role?.salary_uk || null,
    };
  });

  return {
    path,
    roles,
    steps: Math.max(path.length - 1, 0),
  };
}

export default function handler(req, res) {
  try {
    const roles = loadRoles();
    const roleMap = buildRoleMap(roles);
    const adjacency = buildAdjacency(roleMap);

    const { action = "shortest", from, to, slug, sortBy, maxDepth, maxResults } = req.query;

    if (action === "shortest") {
      if (!from || !to) {
        return res.status(400).json({ error: "Missing from or to parameter" });
      }

      const path = bfsShortestPath(adjacency, from, to);

      if (!path) {
        return res.status(404).json({ error: "No path found between these roles" });
      }

      return res.status(200).json(buildPathResponse(path, roleMap));
    }

    if (action === "all") {
      if (!from || !to) {
        return res.status(400).json({ error: "Missing from or to parameter" });
      }

      const paths = dfsAllPaths(
        adjacency,
        from,
        to,
        Number(maxDepth || 5),
        Number(maxResults || 5)
      ).map((path) => buildPathResponse(path, roleMap));

      return res.status(200).json(paths);
    }

    if (action === "next") {
      if (!slug) {
        return res.status(400).json({ error: "Missing slug parameter" });
      }

      const role = roleMap.get(slug);
      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }

      let nextRoles = (role?.career_paths?.next_roles || [])
        .map(normalizeEdge)
        .filter(Boolean)
        .map((edge) => {
          const target = roleMap.get(edge.slug);
          return {
            slug: edge.slug,
            title: target?.title || edge.slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            category: target?.category || null,
            seniority: target?.seniority || null,
            salary_uk: target?.salary_uk || null,
          };
        });

      if (sortBy === "salary") {
        nextRoles = nextRoles.sort((a, b) => {
          const aVal = a?.salary_uk?.max || a?.salary_uk?.min || 0;
          const bVal = b?.salary_uk?.max || b?.salary_uk?.min || 0;
          return bVal - aVal;
        });
      }

      return res.status(200).json(nextRoles);
    }

    if (action === "previous") {
      if (!slug) {
        return res.status(400).json({ error: "Missing slug parameter" });
      }

      const role = roleMap.get(slug);
      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }

      const previousRoles = (role?.career_paths?.previous_roles || [])
        .map(normalizeEdge)
        .filter(Boolean)
        .map((edge) => {
          const source = roleMap.get(edge.slug);
          return {
            slug: edge.slug,
            title: source?.title || edge.slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            category: source?.category || null,
            seniority: source?.seniority || null,
            salary_uk: source?.salary_uk || null,
          };
        });

      return res.status(200).json(previousRoles);
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (error) {
    console.error("[role-path] error:", error);
    return res.status(500).json({
      error: "Role path API failed",
      details: error.message,
    });
  }
}
