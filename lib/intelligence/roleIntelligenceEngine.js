// ============================================================================
// lib/intelligence/roleIntelligenceEngine.js
// HireEdge — AI Career Intelligence Platform
// Rich role profiles, role comparisons, and category intelligence.
// ============================================================================

import { getRoleBySlug, getRolesByCategory, searchRoles, getCategories } from "../dataset/roleIndex.js";
import { getNextEdges, getPreviousEdges } from "../dataset/graphIndex.js";

/**
 * Build a comprehensive intelligence profile for a single role.
 * @param {string} slug
 * @returns {object | null}
 */
export function getRoleProfile(slug) {
  const role = getRoleBySlug(slug);
  if (!role) return null;

  const nextEdges = getNextEdges(slug);
  const prevEdges = getPreviousEdges(slug);

  return {
    slug: role.slug,
    title: role.title,
    category: role.category,
    seniority: role.seniority,
    seniority_level: role.seniority_level,
    experience_years: role.experience_years,
    industries: role.industries || [],
    skills: role.skills || [],
    skills_grouped: role.skills_grouped || {},
    salary_uk: role.salary_uk,
    uk_soc_2020: role.uk_soc_2020 || null,
    ai_context: role.ai_context || null,
    career_mobility: {
      next_roles_count: nextEdges.length,
      previous_roles_count: prevEdges.length,
      next_roles: nextEdges.map((e) => ({
        slug: e.to,
        title: e.title,
        difficulty_label: e.difficulty_label,
        estimated_years: e.estimated_years,
        salary_growth_pct: e.salary_growth_pct,
      })),
      previous_roles: prevEdges.map((e) => ({
        slug: e.from,
        title: getRoleBySlug(e.from)?.title || e.from,
      })),
    },
    adjacent_roles: role.adjacent_roles || [],
  };
}

/**
 * Compare two roles side-by-side.
 * @param {string} slugA
 * @param {string} slugB
 * @returns {object | null}
 */
export function compareRoles(slugA, slugB) {
  const a = getRoleBySlug(slugA);
  const b = getRoleBySlug(slugB);
  if (!a || !b) return null;

  const skillsA = new Set(a.skills || []);
  const skillsB = new Set(b.skills || []);
  const shared = [...skillsA].filter((s) => skillsB.has(s));
  const onlyA = [...skillsA].filter((s) => !skillsB.has(s));
  const onlyB = [...skillsB].filter((s) => !skillsA.has(s));

  const overlapPct = skillsA.size + skillsB.size > 0
    ? Math.round((shared.length / new Set([...skillsA, ...skillsB]).size) * 100)
    : 0;

  const salaryDiff = (a.salary_uk?.mean && b.salary_uk?.mean)
    ? b.salary_uk.mean - a.salary_uk.mean
    : null;

  const salaryDiffPct = (a.salary_uk?.mean && b.salary_uk?.mean)
    ? Math.round(((b.salary_uk.mean - a.salary_uk.mean) / a.salary_uk.mean) * 100)
    : null;

  return {
    role_a: _summary(a),
    role_b: _summary(b),
    skills_comparison: {
      shared,
      only_in_a: onlyA,
      only_in_b: onlyB,
      overlap_pct: overlapPct,
    },
    salary_comparison: {
      a_mean: a.salary_uk?.mean || null,
      b_mean: b.salary_uk?.mean || null,
      difference: salaryDiff,
      difference_pct: salaryDiffPct,
    },
    seniority_gap: (b.seniority_level ?? 0) - (a.seniority_level ?? 0),
    same_category: a.category === b.category,
  };
}

/**
 * Get intelligence summary for an entire category.
 * @param {string} category
 * @returns {object | null}
 */
export function getCategoryIntelligence(category) {
  const roles = getRolesByCategory(category);
  if (roles.length === 0) return null;

  const salaries = roles.filter((r) => r.salary_uk?.mean).map((r) => r.salary_uk.mean);
  const avgSalary = salaries.length
    ? Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length)
    : null;
  const minSalary = salaries.length ? Math.min(...salaries) : null;
  const maxSalary = salaries.length ? Math.max(...salaries) : null;

  // Skill frequency across all roles in category
  const skillFreq = new Map();
  for (const r of roles) {
    for (const s of r.skills || []) {
      skillFreq.set(s, (skillFreq.get(s) || 0) + 1);
    }
  }
  const topSkills = [...skillFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([skill, count]) => ({ skill, count, pct: Math.round((count / roles.length) * 100) }));

  // Seniority distribution
  const senDist = {};
  for (const r of roles) {
    senDist[r.seniority] = (senDist[r.seniority] || 0) + 1;
  }

  return {
    category,
    total_roles: roles.length,
    salary_stats: { mean: avgSalary, min: minSalary, max: maxSalary },
    top_skills: topSkills,
    seniority_distribution: senDist,
    roles: roles.map((r) => ({
      slug: r.slug,
      title: r.title,
      seniority: r.seniority,
      salary_mean: r.salary_uk?.mean || null,
    })),
  };
}

/**
 * Search roles with optional filters.
 * @param {string} query
 * @param {{ limit?: number, category?: string, seniority?: string }} opts
 * @returns {Array<object>}
 */
export function searchRoleIntelligence(query, opts = {}) {
  const roles = searchRoles(query, opts);
  return roles.map(_summary);
}

/**
 * List all available categories.
 * @returns {string[]}
 */
export function listCategories() {
  return getCategories();
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------
function _summary(role) {
  return {
    slug: role.slug,
    title: role.title,
    category: role.category,
    seniority: role.seniority,
    seniority_level: role.seniority_level,
    salary_mean: role.salary_uk?.mean || null,
    skills_count: (role.skills || []).length,
  };
}
