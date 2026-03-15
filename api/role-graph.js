import { loadRolesDataset } from "../lib/loadDataset.js";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
];

const VERSION = "2.0.0";
const DEFAULT_DEPTH = 2;
const MIN_DEPTH = 1;
const MAX_DEPTH = 5;

// ─────────────────────────────────────────────────────────────
// Small pure helpers
// ─────────────────────────────────────────────────────────────

function normalizeSlug(value) {
  if (value == null) return "";
  return String(value).trim().toLowerCase();
}

function titleFromSlug(slug) {
  return String(slug)
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function safeNode(raw) {
  const slug = normalizeSlug(raw.slug) || "unknown";
  return {
    slug,
    title: raw.title || titleFromSlug(slug),
    category: raw.category || "Other",
    seniority: raw.seniority || "Not specified",
  };
}

function safeInt(value, def, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

// ─────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────

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
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rawSlug = req.query.slug ?? req.query.role ?? null;
    const slug = normalizeSlug(rawSlug);

    if (!slug) {
      return res.status(400).json({ error: "Missing slug" });
    }

    const depth = safeInt(req.query.depth, DEFAULT_DEPTH, MIN_DEPTH, MAX_DEPTH);

    const roles = loadRolesDataset();
    const bySlug = new Map(roles.map((r) => [normalizeSlug(r.slug), r]));

    const rootRaw = bySlug.get(slug);
    if (!rootRaw) {
      return res.status(404).json({ error: "Role not found" });
    }

    const nodesMap = new Map();
    const links = [];
    const visited = new Set();

    nodesMap.set(slug, safeNode(rootRaw));
    visited.add(slug);

    const queue = [{ slug, level: 0 }];

    while (queue.length) {
      const { slug: currentSlug, level } = queue.shift();
      if (level >= depth) continue;

      const current = bySlug.get(currentSlug);
      if (!current) continue;

      const cp = current.career_paths;
      const nextSlugs = Array.isArray(cp?.next_roles) ? cp.next_roles : [];

      for (const raw of nextSlugs) {
        const targetSlug = normalizeSlug(raw);
        if (!targetSlug) continue;

        const targetRaw = bySlug.get(targetSlug);
        if (!targetRaw) continue;

        if (!nodesMap.has(targetSlug)) {
          nodesMap.set(targetSlug, safeNode(targetRaw));
        }

        links.push({
          source: currentSlug,
          target: targetSlug,
          type: "next",
        });

        if (!visited.has(targetSlug)) {
          visited.add(targetSlug);
          queue.push({ slug: targetSlug, level: level + 1 });
        }
      }

      if (level === 0) {
        const prevSlugs = Array.isArray(cp?.previous_roles) ? cp.previous_roles : [];

        for (const raw of prevSlugs) {
          const prevSlug = normalizeSlug(raw);
          if (!prevSlug) continue;

          const prevRaw = bySlug.get(prevSlug);
          if (!prevRaw) continue;

          if (!nodesMap.has(prevSlug)) {
            nodesMap.set(prevSlug, safeNode(prevRaw));
          }

          links.push({
            source: prevSlug,
            target: currentSlug,
            type: "previous",
          });
        }
      }
    }

    return res.status(200).json({
      version: VERSION,
      root: safeNode(rootRaw),
      depth,
      nodes: Array.from(nodesMap.values()),
      links,
    });
  } catch {
    return res.status(500).json({ error: "Failed to build role graph" });
  }
}
