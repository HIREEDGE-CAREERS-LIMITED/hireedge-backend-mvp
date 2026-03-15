import { loadRolesDataset } from "../lib/loadDataset.js";

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
];

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

    const nextRoles = node?.career_paths?.next_roles || [];

    for (const next of nextRoles) {
      if (!next || visited.has(next)) continue;

      visited.add(next);
      const newPath = [...currentPath, next];

      if (next === goal) return newPath;

      queue.push(newPath);
    }
  }

  return null;
}

export default function handler(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  try {
    const { from, to, maxDepth } = req.query || {};

    if (!from || !to) {
      return res.status(400).json({
        ok: false,
        error: "Missing required query params",
        required: ["from", "to"],
        example: "/api/role-path?from=data-analyst&to=analytics-manager",
      });
    }

    const normalizedFrom = String(from).trim().toLowerCase().replace(/\s+/g, "-");
    const normalizedTo = String(to).trim().toLowerCase().replace(/\s+/g, "-");

    const rolesArray = loadRolesDataset();
    const bySlug = new Map(
      rolesArray
        .filter((r) => r && r.slug)
        .map((r) => [r.slug, r])
    );

    if (!bySlug.has(normalizedFrom)) {
      return res.status(404).json({
        ok: false,
        error: "FROM role not found",
        from: normalizedFrom,
      });
    }

    if (!bySlug.has(normalizedTo)) {
      return res.status(404).json({
        ok: false,
        error: "TO role not found",
        to: normalizedTo,
      });
    }

    const depth = Number.isFinite(Number(maxDepth)) ? Number(maxDepth) : 10;
    const pathSlugs = bfsPath(bySlug, normalizedFrom, normalizedTo, depth);

    if (!pathSlugs) {
      return res.status(200).json({
        ok: true,
        found: false,
        from: normalizedFrom,
        to: normalizedTo,
        maxDepth: depth,
        message: "No path found within maxDepth (try increasing maxDepth).",
        path: [],
        steps: 0,
      });
    }

    return res.status(200).json({
      ok: true,
      found: true,
      from: normalizedFrom,
      to: normalizedTo,
      maxDepth: depth,
      steps: Math.max(pathSlugs.length - 1, 0),
      path: pathSlugs,
    });
  } catch (err) {
    console.error("role-path error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to compute role path",
    });
  }
}
