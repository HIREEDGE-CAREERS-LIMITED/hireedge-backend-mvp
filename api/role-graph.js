import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const DATASET_PATH  = path.join(process.cwd(), "data", "roles-enriched.json");
const VERSION       = "2.0.0";
const DEFAULT_DEPTH = 2;
const MIN_DEPTH     = 1;
const MAX_DEPTH     = 5;

// ─────────────────────────────────────────────────────────────
// Dataset loader  (module-level cache)
// ─────────────────────────────────────────────────────────────

let _cache = null;

/**
 * Reads and caches roles from the dataset file.
 * Supports both a bare array and { roles: [...] } wrapper.
 * Throws a plain Error (no raw I/O details) on any failure.
 *
 * @returns {object[]}
 */
function loadRolesEnriched() {
  if (_cache) return _cache;

  let raw;
  try {
    raw = fs.readFileSync(DATASET_PATH, "utf-8");
  } catch {
    throw new Error("Dataset file could not be read.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Dataset file contains invalid JSON.");
  }

  const roles = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.roles)   ? parsed.roles
    : Array.isArray(parsed.results) ? parsed.results
    : Array.isArray(parsed.data)    ? parsed.data
    : null;

  if (!roles) {
    throw new Error("Dataset does not contain a recognisable roles array.");
  }

  _cache = roles;
  return _cache;
}

// ─────────────────────────────────────────────────────────────
// Small pure helpers
// ─────────────────────────────────────────────────────────────

/**
 * Lower-case + trim a value safely.
 * Returns "" for anything null / undefined / non-string.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeSlug(value) {
  if (value == null) return "";
  return String(value).trim().toLowerCase();
}

/**
 * Converts "senior-data-analyst" → "Senior Data Analyst".
 * Used as a fallback title when a role record lacks one.
 *
 * @param {string} slug
 * @returns {string}
 */
function titleFromSlug(slug) {
  return String(slug)
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Returns a guaranteed-safe graph node for a role record.
 * Every field has a typed fallback — callers never need to null-check.
 *
 * @param {object} raw - Raw role record from the dataset
 * @returns {{ slug: string, title: string, category: string, seniority: string }}
 */
function safeNode(raw) {
  const slug = normalizeSlug(raw.slug) || "unknown";
  return {
    slug,
    title:     raw.title     || titleFromSlug(slug),
    category:  raw.category  || "Other",
    seniority: raw.seniority || "Not specified",
  };
}

/**
 * Parses and clamps an integer query param.
 *
 * @param {string|undefined} value
 * @param {number} def   - Default if unparseable
 * @param {number} min   - Inclusive floor
 * @param {number} max   - Inclusive ceiling
 * @returns {number}
 */
function safeInt(value, def, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

// ─────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────

export default function handler(req, res) {
  // ── Method guard ──────────────────────────────────────────
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // ── Validate slug param ───────────────────────────────
    const rawSlug = req.query.slug ?? null;
    const slug    = normalizeSlug(rawSlug);

    if (!slug) {
      return res.status(400).json({ error: "Missing slug" });
    }

    // ── Parse depth ───────────────────────────────────────
    const depth = safeInt(req.query.depth, DEFAULT_DEPTH, MIN_DEPTH, MAX_DEPTH);

    // ── Load dataset ──────────────────────────────────────
    const roles = loadRolesEnriched();

    // Build a lookup map keyed by normalised slug so casing
    // differences in the dataset never cause missed lookups.
    const bySlug = new Map(
      roles.map((r) => [normalizeSlug(r.slug), r])
    );

    // ── Find root role ────────────────────────────────────
    const rootRaw = bySlug.get(slug);
    if (!rootRaw) {
      return res.status(404).json({ error: "Role not found" });
    }

    // ── BFS graph expansion ───────────────────────────────
    //
    //  We walk both next_roles and previous_roles so the graph
    //  reflects the full career context around the root.
    //
    //  Link types:
    //    "next"     – root → successor (forward progression)
    //    "previous" – root → predecessor (where you came from)
    //
    //  previous_roles links are only traversed from the root
    //  itself (depth 0) to give context without exploding the
    //  graph. BFS continuation uses next_roles only.
    //
    const nodesMap = new Map(); // normalised slug → safeNode
    const links    = [];        // { source, target, type }
    const visited  = new Set();

    // Seed with root
    nodesMap.set(slug, safeNode(rootRaw));
    visited.add(slug);

    const queue = [{ slug, level: 0 }];

    while (queue.length) {
      const { slug: currentSlug, level } = queue.shift();
      if (level >= depth) continue;

      const current = bySlug.get(currentSlug);
      if (!current) continue;

      const cp = current.career_paths;

      // ── next_roles (forward) ────────────────────────────
      const nextSlugs = Array.isArray(cp?.next_roles) ? cp.next_roles : [];

      for (const raw of nextSlugs) {
        const targetSlug = normalizeSlug(raw);
        if (!targetSlug) continue;

        const targetRaw = bySlug.get(targetSlug);
        if (!targetRaw) continue;

        if (!nodesMap.has(targetSlug)) {
          nodesMap.set(targetSlug, safeNode(targetRaw));
        }

        links.push({ source: currentSlug, target: targetSlug, type: "next" });

        if (!visited.has(targetSlug)) {
          visited.add(targetSlug);
          queue.push({ slug: targetSlug, level: level + 1 });
        }
      }

      // ── previous_roles (backward, root level only) ──────
      //
      //  Showing where you could come *from* is useful for the
      //  Career Intelligence Layer but we scope it to the root
      //  node to keep the graph focused and bounded.
      //
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

          links.push({ source: prevSlug, target: currentSlug, type: "previous" });
          // previous_roles nodes are not enqueued — no BFS continuation
        }
      }
    }

    // ── Build response ────────────────────────────────────
    return res.status(200).json({
      version: VERSION,
      root:    safeNode(rootRaw),
      depth,
      nodes:   Array.from(nodesMap.values()),
      links,
    });

  } catch {
    // Never leak raw error details to the client
    return res.status(500).json({ error: "Failed to build role graph" });
  }
}
