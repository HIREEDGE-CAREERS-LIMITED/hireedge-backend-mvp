import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const DATASET_PATH = path.join(process.cwd(), "data", "roles-enriched.json");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT     = 100;

const META = {
  version:      "2.0.0",
  source:       "HireEdge Role Intelligence Dataset (internal)",
  last_updated: null, // filled at load time from dataset, see loadDataset()
};

// ─────────────────────────────────────────────────────────────
// Dataset loader  (cached after first read)
// ─────────────────────────────────────────────────────────────

let _cache = null;

/**
 * Reads and caches the dataset.
 * Throws a structured Error if the file is missing, unreadable,
 * or does not contain a recognisable roles array.
 *
 * @returns {{ roles: object[], meta: object }}
 */
function loadDataset() {
  if (_cache) return _cache;

  let raw;
  try {
    raw = fs.readFileSync(DATASET_PATH, "utf8");
  } catch {
    throw new Error("Dataset file could not be read.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Dataset file contains invalid JSON.");
  }

  // Support both a bare array and the structured-object format
  // (the HireEdge v3+ format is always { roles: [...], ... })
  const roles = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.roles)   ? parsed.roles
    : Array.isArray(parsed.results) ? parsed.results
    : Array.isArray(parsed.data)    ? parsed.data
    : null;

  if (!roles) {
    throw new Error("Dataset does not contain a recognisable roles array.");
  }

  _cache = {
    roles,
    meta: {
      ...META,
      last_updated: parsed.last_updated ?? new Date().toISOString(),
    },
  };

  return _cache;
}

// ─────────────────────────────────────────────────────────────
// Small pure helpers
// ─────────────────────────────────────────────────────────────

/**
 * Lower-case + trim a potential slug / query string safely.
 * Returns "" if the value is not a usable string.
 */
function normalizeSlug(value) {
  if (value == null) return "";
  return String(value).trim().toLowerCase();
}

/**
 * Converts a slug like "senior-data-analyst" into "Senior Data Analyst".
 * Used as a fallback title when the role record lacks one.
 */
function titleFromSlug(slug) {
  return String(slug)
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Produces a guaranteed-safe, fully-populated role object.
 * Every field has a fallback so callers never need to null-check.
 *
 * @param {object} raw  - The raw role record from the dataset
 * @returns {object}    - A clean role object with all required fields
 */
function safeRole(raw) {
  const slug = normalizeSlug(raw.slug) || "unknown";
  return {
    slug,
    title:        raw.title      || titleFromSlug(slug),
    category:     raw.category   || "Other",
    seniority:    raw.seniority  || "Not specified",
    skills:       Array.isArray(raw.skills) ? raw.skills : [],
    salary_uk:    raw.salary_uk  ?? null,
    career_paths: {
      next_roles:     Array.isArray(raw.career_paths?.next_roles)     ? raw.career_paths.next_roles     : [],
      previous_roles: Array.isArray(raw.career_paths?.previous_roles) ? raw.career_paths.previous_roles : [],
    },
    uk_soc_2020:  raw.uk_soc_2020 ?? null,
  };
}

/**
 * Returns the lightweight shape used in related_roles and suggestions.
 *
 * @param {object} raw
 * @returns {{ slug: string, title: string, category: string, seniority: string }}
 */
function slimRole(raw) {
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
 * @param {string|undefined} value   - Raw query-string value
 * @param {number}           def     - Default if unparseable
 * @param {number}           min     - Inclusive floor
 * @param {number}           max     - Inclusive ceiling
 * @returns {number}
 */
function safePosInt(value, def, min, max) {
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

  // ── Load dataset ──────────────────────────────────────────
  let roles, meta;
  try {
    ({ roles, meta } = loadDataset());
  } catch (err) {
    return res.status(500).json({ error: "Failed to load role dataset" });
  }

  try {
    // ── Parse query params ──────────────────────────────────
    //
    //  slug  – primary lookup key  (preferred)
    //  role  – legacy alias for slug  (backward-compatible)
    //  q     – free-text search across title, slug, skills
    //  category, seniority – exact-match filters
    //  limit, offset – pagination
    //
    const {
      slug:      slugParam,
      role:      roleParam, // backward-compat alias
      q:         qParam,
      category:  categoryParam,
      seniority: seniorityParam,
      limit:     limitParam,
      offset:    offsetParam,
    } = req.query;

    // Prefer `slug`; fall back to `role` alias
    const rawLookup = slugParam ?? roleParam ?? null;

    // ── 1) Single-role lookup ──────────────────────────────
    if (rawLookup != null) {
      const normalized = normalizeSlug(rawLookup);

      if (!normalized) {
        return res.status(400).json({ error: "Missing slug" });
      }

      const found = roles.find(
        (r) => normalizeSlug(r.slug) === normalized
      );

      if (!found) {
        return res.status(404).json({ error: "Role not found" });
      }

      const roleData = safeRole(found);

      // Related roles: same category, excluding self, lightweight shape
      const related = roles
        .filter(
          (r) =>
            r.category === found.category &&
            normalizeSlug(r.slug) !== normalized
        )
        .slice(0, 8)
        .map(slimRole);

      return res.status(200).json({
        ...meta,
        ...roleData,
        related_roles: related,
      });
    }

    // ── 2) List / search mode ──────────────────────────────
    let results = roles;

    // Exact-match filters (case-insensitive for safety)
    if (categoryParam) {
      const cat = String(categoryParam).trim().toLowerCase();
      results = results.filter(
        (r) => String(r.category || "").trim().toLowerCase() === cat
      );
    }

    if (seniorityParam) {
      const sen = String(seniorityParam).trim().toLowerCase();
      results = results.filter(
        (r) => String(r.seniority || "").trim().toLowerCase() === sen
      );
    }

    // Free-text search across title, slug, and skills
    if (qParam) {
      const q = String(qParam).trim().toLowerCase();
      if (!q) {
        return res.status(400).json({ error: "Query parameter q must not be blank" });
      }
      results = results.filter(
        (r) =>
          String(r.title || "").toLowerCase().includes(q) ||
          String(r.slug || "").toLowerCase().includes(q) ||
          (Array.isArray(r.skills) &&
            r.skills.some((s) => String(s).toLowerCase().includes(q)))
      );
    }

    // Autocomplete suggestions (only when a q is provided)
    const suggestions = qParam
      ? results.slice(0, 8).map(slimRole)
      : [];

    // Pagination
    const lim = safePosInt(limitParam, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const off = safePosInt(offsetParam, 0, 0, Infinity);

    const page = results.slice(off, off + lim);

    return res.status(200).json({
      ...meta,
      total: results.length,
      limit: lim,
      offset: off,
      suggestions,
      results: page.map(safeRole),
    });

  } catch (err) {
    // Catch any unexpected runtime error; never leak a raw stack trace
    return res.status(500).json({ error: "An unexpected error occurred" });
  }
}
