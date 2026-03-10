import fs from "fs";
import path from "path";

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
];

const DATASET_PATH = path.join(process.cwd(), "data", "roles-enriched.json");
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const META = {
  version: "2.0.0",
  source: "HireEdge Role Intelligence Dataset (internal)",
  last_updated: null,
};

// ------------------------------------------------------------
// Dataset loader (cached after first read)
// ------------------------------------------------------------

let _cache = null;

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

  const roles = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.roles)
    ? parsed.roles
    : Array.isArray(parsed.results)
    ? parsed.results
    : Array.isArray(parsed.data)
    ? parsed.data
    : null;

  if (!roles) {
    throw new Error("Dataset does not contain a recognisable roles array.");
  }

  _cache = {
    roles,
    meta: {
      ...META,
      last_updated: parsed.last_updated ?? "March 2026",
    },
  };

  return _cache;
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function formatRolePreview(role) {
  return {
    slug: role.slug,
    title: role.title,
    category: role.category,
    seniority: role.seniority,
  };
}

// ------------------------------------------------------------
// API Handler
// ------------------------------------------------------------

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
      error: "Method not allowed",
    });
  }

  try {
    const { roles, meta } = loadDataset();
    const { slug, role, q, limit } = req.query || {};

    // --------------------------------------------------------
    // Exact role lookup by slug
    // Supports both ?slug= and ?role=
    // --------------------------------------------------------
    const requestedSlug = slugify(slug || role);

    if (requestedSlug) {
      const currentRole = roles.find((r) => r.slug === requestedSlug);

      if (!currentRole) {
        return res.status(404).json({
          error: "Role not found",
          slug: requestedSlug,
        });
      }

      const nextRoles = roles.filter((r) =>
        currentRole.career_paths?.next_roles?.includes(r.slug)
      );

      const previousRoles = roles.filter((r) =>
        currentRole.career_paths?.previous_roles?.includes(r.slug)
      );

      return res.status(200).json({
        ...meta,
        slug: currentRole.slug,
        title: currentRole.title,
        category: currentRole.category,
        seniority: currentRole.seniority,
        skills: currentRole.skills || [],
        salary_uk: currentRole.salary_uk || null,
        career_paths: currentRole.career_paths || {
          next_roles: [],
          previous_roles: [],
        },
        uk_soc_2020: currentRole.uk_soc_2020 || null,
        related_roles: [
          ...nextRoles.map(formatRolePreview),
          ...previousRoles.map(formatRolePreview),
        ],
      });
    }

    // --------------------------------------------------------
    // Search mode by q
    // --------------------------------------------------------
    const query = String(q || "").trim().toLowerCase();

    if (!query) {
      return res.status(200).json({
        ...meta,
        total_roles: roles.length,
        roles: roles.slice(0, DEFAULT_LIMIT).map(formatRolePreview),
      });
    }

    const max = parseLimit(limit);

    const matches = roles.filter((r) => {
      const title = String(r.title || "").toLowerCase();
      const category = String(r.category || "").toLowerCase();
      const seniority = String(r.seniority || "").toLowerCase();
      const roleSkills = Array.isArray(r.skills) ? r.skills.join(" ").toLowerCase() : "";

      return (
        title.includes(query) ||
        category.includes(query) ||
        seniority.includes(query) ||
        roleSkills.includes(query) ||
        String(r.slug || "").includes(slugify(query))
      );
    });

    return res.status(200).json({
      ...meta,
      query,
      total_matches: matches.length,
      roles: matches.slice(0, max).map(formatRolePreview),
    });
  } catch (err) {
    console.error("role-intelligence error:", err);
    return res.status(500).json({
      error: err.message || "Failed to load role intelligence",
    });
  }
}
