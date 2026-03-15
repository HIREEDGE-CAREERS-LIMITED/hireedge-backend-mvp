// ============================================================================
// lib/intelligence/salaryEngine.js
// HireEdge — AI Career Intelligence Platform
// Salary intelligence: benchmarks, ranges, progression, and comparisons.
// ============================================================================

import { getRoleBySlug, getRolesByCategory, getRoleMap } from "../dataset/roleIndex.js";
import { getNextEdges } from "../dataset/graphIndex.js";

/**
 * Get detailed salary intelligence for a role.
 * @param {string} slug
 * @returns {object | null}
 */
export function getSalaryIntelligence(slug) {
  const role = getRoleBySlug(slug);
  if (!role || !role.salary_uk) return null;

  // Category benchmark
  const categoryRoles = getRolesByCategory(role.category);
  const categorySalaries = categoryRoles
    .filter((r) => r.salary_uk?.mean)
    .map((r) => r.salary_uk.mean)
    .sort((a, b) => a - b);

  const categoryMean = categorySalaries.length
    ? Math.round(categorySalaries.reduce((a, b) => a + b, 0) / categorySalaries.length)
    : null;

  const percentile = _percentileOf(categorySalaries, role.salary_uk.mean);

  // Salary progression from next roles
  const nextEdges = getNextEdges(slug);
  const progressionOptions = nextEdges.map((e) => {
    const target = getRoleBySlug(e.to);
    return {
      slug: e.to,
      title: e.title,
      target_salary_mean: target?.salary_uk?.mean || null,
      salary_growth_pct: e.salary_growth_pct,
      estimated_years: e.estimated_years,
      annual_growth_rate: e.estimated_years > 0 && e.salary_growth_pct > 0
        ? +(e.salary_growth_pct / e.estimated_years).toFixed(1)
        : null,
    };
  }).sort((a, b) => (b.salary_growth_pct || 0) - (a.salary_growth_pct || 0));

  return {
    slug: role.slug,
    title: role.title,
    category: role.category,
    seniority: role.seniority,
    salary: {
      ...role.salary_uk,
      range_width: role.salary_uk.max - role.salary_uk.min,
    },
    category_benchmark: {
      category: role.category,
      category_mean: categoryMean,
      vs_category: categoryMean ? role.salary_uk.mean - categoryMean : null,
      vs_category_pct: categoryMean
        ? Math.round(((role.salary_uk.mean - categoryMean) / categoryMean) * 100)
        : null,
      percentile_in_category: percentile,
    },
    progression: progressionOptions,
    best_salary_move: progressionOptions[0] || null,
  };
}

/**
 * Compare salaries across multiple roles.
 * @param {string[]} slugs
 * @returns {object}
 */
export function compareSalaries(slugs) {
  const results = slugs
    .map((s) => {
      const role = getRoleBySlug(s);
      if (!role) return null;
      return {
        slug: role.slug,
        title: role.title,
        category: role.category,
        seniority: role.seniority,
        salary_uk: role.salary_uk || null,
      };
    })
    .filter(Boolean);

  const means = results.filter((r) => r.salary_uk?.mean).map((r) => r.salary_uk.mean);
  const highest = results.reduce((max, r) =>
    (r.salary_uk?.mean || 0) > (max?.salary_uk?.mean || 0) ? r : max, results[0]);
  const lowest = results.reduce((min, r) =>
    (r.salary_uk?.mean || Infinity) < (min?.salary_uk?.mean || Infinity) ? r : min, results[0]);

  return {
    roles: results,
    summary: {
      count: results.length,
      avg_mean: means.length ? Math.round(means.reduce((a, b) => a + b, 0) / means.length) : null,
      highest: highest ? { slug: highest.slug, title: highest.title, mean: highest.salary_uk?.mean } : null,
      lowest: lowest ? { slug: lowest.slug, title: lowest.title, mean: lowest.salary_uk?.mean } : null,
      spread: means.length >= 2 ? Math.max(...means) - Math.min(...means) : 0,
    },
  };
}

/**
 * Get top-paying roles, optionally filtered by category or seniority.
 * @param {{ category?: string, seniority?: string, limit?: number }} opts
 * @returns {Array<object>}
 */
export function getTopPayingRoles(opts = {}) {
  const limit = opts.limit || 20;
  const roleMap = getRoleMap();
  const results = [];

  for (const [, role] of roleMap) {
    if (opts.category && role.category !== opts.category) continue;
    if (opts.seniority && role.seniority !== opts.seniority) continue;
    if (!role.salary_uk?.mean) continue;

    results.push({
      slug: role.slug,
      title: role.title,
      category: role.category,
      seniority: role.seniority,
      salary_mean: role.salary_uk.mean,
      salary_min: role.salary_uk.min,
      salary_max: role.salary_uk.max,
    });
  }

  results.sort((a, b) => b.salary_mean - a.salary_mean);
  return results.slice(0, limit);
}

/**
 * Salary distribution by seniority within a category.
 * @param {string} category
 * @returns {object}
 */
export function getSalaryBySeniority(category) {
  const roles = getRolesByCategory(category);
  const groups = {};

  for (const r of roles) {
    if (!r.salary_uk?.mean) continue;
    const sen = r.seniority || "Unknown";
    if (!groups[sen]) groups[sen] = { salaries: [], count: 0 };
    groups[sen].salaries.push(r.salary_uk.mean);
    groups[sen].count++;
  }

  const result = {};
  for (const [sen, data] of Object.entries(groups)) {
    const sorted = data.salaries.sort((a, b) => a - b);
    result[sen] = {
      count: data.count,
      mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      median: sorted[Math.floor(sorted.length / 2)],
    };
  }

  return { category, seniority_salary: result };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------
function _percentileOf(sorted, value) {
  if (!sorted.length) return null;
  let count = 0;
  for (const v of sorted) {
    if (v < value) count++;
  }
  return Math.round((count / sorted.length) * 100);
}
