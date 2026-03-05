import fs from "fs";
import path from "path";

let CACHE = null;

function loadDataset() {
  if (CACHE) return CACHE;

  const filePath = path.join(process.cwd(), "data", "roles-enriched.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);

  const rolesArray = Array.isArray(json) ? json : (json.roles || json.results || []);
  const bySlug = new Map(rolesArray.map((r) => [r.slug, r]));

  CACHE = { rolesArray, bySlug };
  return CACHE;
}

function bfsPath(bySlug, start, goal, maxDepth = 10) {
  if (start === goal) return [start];

  const queue = [[start]];
  const visited = new Set([start]);

  while (queue.length) {
    const currentPath = queue.shift();
    if (currentPath.length > maxDepth) continue;

    const last = currentPath[currentPath.length - 1];
    const node = bySlug.get(last);
    if (!node) continue;

    const next = node?.career_paths?.next_roles || [];
    for (const n of next) {
      if (!n || visited.has(n)) continue;
      visited.add(n);

      const newPath = [...currentPath, n];
      if (n === goal) return newPath;
      queue.push(newPath);
    }
  }
  return null;
}

export default function handler(req, res) {
  try {
    const { from, to, maxDepth } = req.query || {};

    if (!from || !to) {
      return res.status(400).json({
        error: "Missing required query params",
        required: ["from", "to"],
        example: "/api/role-path?from=data-analyst&to=product-manager",
      });
    }

    const { bySlug } = loadDataset();

    if (!bySlug.has(from)) return res.status(404).json({ error: "FROM role not found", from });
    if (!bySlug.has(to)) return res.status(404).json({ error: "TO role not found", to });

    const depth = Number.isFinite(Number(maxDepth)) ? Number(maxDepth) : 10;
    const pathSlugs = bfsPath(bySlug, from, to, depth);

    if (!pathSlugs) {
      return res.status(200).json({
        found: false,
        from,
        to,
        maxDepth: depth,
        message: "No path found within maxDepth (try increasing maxDepth).",
        path: [],
      });
    }

    const pathRoles = pathSlugs.map((s) => bySlug.get(s));

    return res.status(200).json({
      found: true,
      from,
      to,
      maxDepth: depth,
      steps: pathSlugs.length - 1,
      path: pathSlugs,
      roles: pathRoles,
    });
  } catch (e) {
    return res.status(500).json({
      error: "Internal server error in role-path",
      detail: String(e?.stack || e),
    });
  }
}
