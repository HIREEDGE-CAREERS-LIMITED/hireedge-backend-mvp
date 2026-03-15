import { loadRolesDataset } from "../lib/loadDataset.js";

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
  "https://hireedge.co.uk",
  "https://www.hireedge.co.uk",
];

const VERSION = "2.0.0";

function normalizeSlug(value) {
  if (!value) return "";
  return String(value).trim().toLowerCase().replace(/\s+/g, "-");
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) return null;
  return `£${value.toLocaleString("en-GB")}`;
}

function formatSalaryBand(salary) {
  if (!salary || typeof salary !== "object") return null;

  const min = Number(salary.min);
  const max = Number(salary.max);
  const mean = Number(salary.mean);

  return {
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
    mean: Number.isFinite(mean) ? mean : null,
    min_formatted: Number.isFinite(min) ? formatCurrency(min) : null,
    max_formatted: Number.isFinite(max) ? formatCurrency(max) : null,
    mean_formatted: Number.isFinite(mean) ? formatCurrency(mean) : null,
    currency: salary.currency || "GBP",
    period: salary.period || "year",
    source: salary.source || null,
  };
}

function safeRolePreview(role) {
  return {
    slug: role.slug,
    title: role.title || role.slug,
    category: role.category || "Other",
    seniority: role.seniority || "Unknown",
    salary_uk: formatSalaryBand(role.salary_uk),
  };
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
    const roles = loadRolesDataset();
    const roleParam = req.query.role ?? req.query.slug ?? "";
    const slug = normalizeSlug(roleParam);

    if (!slug) {
      return res.status(400).json({
        ok: false,
        error: "Missing role",
        example: "/api/salary-intelligence?role=data-analyst",
      });
    }

    const bySlug = new Map(
      roles
        .filter((r) => r && r.slug)
        .map((r) => [normalizeSlug(r.slug), r])
    );

    const currentRole = bySlug.get(slug);

    if (!currentRole) {
      return res.status(404).json({
        ok: false,
        error: "Role not found",
        role: slug,
      });
    }

    const currentSalary = formatSalaryBand(currentRole.salary_uk);

    const nextRoleSlugs = Array.isArray(currentRole?.career_paths?.next_roles)
      ? currentRole.career_paths.next_roles
      : [];

    const previousRoleSlugs = Array.isArray(currentRole?.career_paths?.previous_roles)
      ? currentRole.career_paths.previous_roles
      : [];

    const nextRoles = nextRoleSlugs
      .map((s) => bySlug.get(normalizeSlug(s)))
      .filter(Boolean)
      .map(safeRolePreview);

    const previousRoles = previousRoleSlugs
      .map((s) => bySlug.get(normalizeSlug(s)))
      .filter(Boolean)
      .map(safeRolePreview);

    let progression = null;

    if (
      currentSalary &&
      Number.isFinite(currentSalary.mean) &&
      nextRoles.length > 0
    ) {
      const nextMeans = nextRoles
        .map((r) => r.salary_uk?.mean)
        .filter((v) => Number.isFinite(v));

      if (nextMeans.length > 0) {
        const avgNextMean =
          Math.round(nextMeans.reduce((a, b) => a + b, 0) / nextMeans.length);

        const diff = avgNextMean - currentSalary.mean;

        progression = {
          current_mean: currentSalary.mean,
          current_mean_formatted: formatCurrency(currentSalary.mean),
          average_next_mean: avgNextMean,
          average_next_mean_formatted: formatCurrency(avgNextMean),
          difference: diff,
          difference_formatted: `${diff >= 0 ? "+" : ""}${formatCurrency(diff)}`,
        };
      }
    }

    return res.status(200).json({
      ok: true,
      version: VERSION,
      role: {
        slug: currentRole.slug,
        title: currentRole.title || currentRole.slug,
        category: currentRole.category || "Other",
        seniority: currentRole.seniority || "Unknown",
      },
      salary_uk: currentSalary,
      next_roles: nextRoles,
      previous_roles: previousRoles,
      progression,
    });
  } catch (err) {
    console.error("salary-intelligence error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to load salary intelligence",
    });
  }
}
