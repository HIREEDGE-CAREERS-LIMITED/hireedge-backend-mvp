// ============================================================================
// lib/tools/roadmapEngine.js
// HireEdge — AI Career Intelligence Platform
// Builds step-by-step career roadmaps by composing careerPathEngine,
// salaryEngine, and skillsGapEngine. Zero logic duplication.
// ============================================================================

import { getRoleBySlug } from "../dataset/roleIndex.js";
import { findShortestPath, findAllPaths } from "../graph/careerPathEngine.js";
import { getSalaryIntelligence } from "../intelligence/salaryEngine.js";
import { analyseRoleTransitionGap } from "../intelligence/skillsGapEngine.js";

/**
 * Build a full career roadmap from current role to target role.
 *
 * Each step includes: role context, salary intelligence, skills gap to the
 * next step, difficulty rating, and estimated timeline.
 *
 * @param {string} fromSlug  - Current role slug
 * @param {string} toSlug    - Target role slug
 * @param {{ strategy?: 'fastest' | 'easiest' | 'highest_paid', maxDepth?: number }} opts
 * @returns {object | null}
 */
export function buildRoadmap(fromSlug, toSlug, opts = {}) {
  const fromRole = getRoleBySlug(fromSlug);
  const toRole = getRoleBySlug(toSlug);
  if (!fromRole || !toRole) return null;

  // ── 1. Find the best route ───────────────────────────────────────────────
  const strategy = opts.strategy || "fastest";
  const maxDepth = opts.maxDepth || 6;

  const allPaths = findAllPaths(fromSlug, toSlug, { maxDepth, maxResults: 15 });
  if (allPaths.length === 0) {
    // Try shortest path with deeper search as fallback
    const shortest = findShortestPath(fromSlug, toSlug, { maxDepth: 8 });
    if (!shortest) return { reachable: false, from: _roleSummary(fromRole), to: _roleSummary(toRole) };
    allPaths.push(shortest);
  }

  const chosen = _pickRoute(allPaths, strategy);
  const alternatives = allPaths
    .filter((p) => p.path.join("→") !== chosen.path.join("→"))
    .slice(0, 3)
    .map(_routeSummary);

  // ── 2. Enrich every step ─────────────────────────────────────────────────
  const steps = [];
  for (let i = 0; i < chosen.path.length; i++) {
    const slug = chosen.path[i];
    const role = getRoleBySlug(slug);
    const salary = getSalaryIntelligence(slug);
    const edge = chosen.edges[i] || null; // edge leading INTO this step (null for first)

    let skillsGap = null;
    if (i < chosen.path.length - 1) {
      skillsGap = analyseRoleTransitionGap(slug, chosen.path[i + 1]);
    }

    steps.push({
      step: i + 1,
      slug,
      title: role?.title || slug,
      category: role?.category || null,
      seniority: role?.seniority || null,
      seniority_level: role?.seniority_level ?? null,
      experience_years: role?.experience_years || null,
      industries: role?.industries || [],
      salary: salary
        ? {
            mean: salary.salary.mean,
            min: salary.salary.min,
            max: salary.salary.max,
            percentile_in_category: salary.category_benchmark.percentile_in_category,
            vs_category_pct: salary.category_benchmark.vs_category_pct,
          }
        : null,
      transition_in: edge
        ? {
            difficulty_score: edge.difficulty_score,
            difficulty_label: edge.difficulty_label,
            estimated_years: edge.estimated_years,
            salary_growth_pct: edge.salary_growth_pct,
          }
        : null,
      skills_gap_to_next: skillsGap
        ? {
            new_skills_needed: skillsGap.skills_analysis.new_skills_needed,
            new_needed_count: skillsGap.skills_analysis.new_needed_count,
            overlap_pct: skillsGap.skills_analysis.overlap_pct,
          }
        : null,
      is_current: i === 0,
      is_target: i === chosen.path.length - 1,
    });
  }

  // ── 3. Compute roadmap-level summary ─────────────────────────────────────
  const fromSalary = fromRole.salary_uk?.mean || 0;
  const toSalary = toRole.salary_uk?.mean || 0;
  const absoluteSalaryGrowth = toSalary - fromSalary;
  const salaryGrowthPct = fromSalary > 0
    ? Math.round((absoluteSalaryGrowth / fromSalary) * 100)
    : null;

  const totalNewSkills = steps.reduce(
    (acc, s) => acc + (s.skills_gap_to_next?.new_needed_count || 0),
    0
  );

  const avgDifficultyPerStep = chosen.edges.length
    ? Math.round(chosen.edges.reduce((a, e) => a + (e.difficulty_score || 0), 0) / chosen.edges.length)
    : 0;

  return {
    reachable: true,
    strategy,
    from: _roleSummary(fromRole),
    to: _roleSummary(toRole),
    summary: {
      total_steps: chosen.steps,
      total_estimated_years: chosen.totalYears,
      total_difficulty: chosen.totalDifficulty,
      avg_difficulty_per_step: avgDifficultyPerStep,
      salary_growth: absoluteSalaryGrowth,
      salary_growth_pct: salaryGrowthPct,
      total_new_skills_across_path: totalNewSkills,
      category_changes: _countCategoryChanges(steps),
    },
    steps,
    alternatives,
  };
}

/**
 * Build roadmaps to multiple target roles simultaneously (fan-out comparison).
 *
 * @param {string} fromSlug
 * @param {string[]} targetSlugs
 * @param {{ strategy?: string }} opts
 * @returns {object}
 */
export function buildMultiRoadmap(fromSlug, targetSlugs, opts = {}) {
  const results = targetSlugs.map((toSlug) => {
    const roadmap = buildRoadmap(fromSlug, toSlug, opts);
    return {
      target: toSlug,
      reachable: roadmap?.reachable ?? false,
      total_steps: roadmap?.summary?.total_steps ?? null,
      total_years: roadmap?.summary?.total_estimated_years ?? null,
      salary_growth_pct: roadmap?.summary?.salary_growth_pct ?? null,
      total_difficulty: roadmap?.summary?.total_difficulty ?? null,
    };
  });

  results.sort((a, b) => {
    if (a.reachable && !b.reachable) return -1;
    if (!a.reachable && b.reachable) return 1;
    return (a.total_difficulty || 999) - (b.total_difficulty || 999);
  });

  return {
    from: fromSlug,
    targets_analysed: targetSlugs.length,
    results,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _pickRoute(paths, strategy) {
  const sorted = [...paths];
  switch (strategy) {
    case "easiest":
      sorted.sort((a, b) => a.totalDifficulty - b.totalDifficulty);
      break;
    case "highest_paid":
      sorted.sort((a, b) => b.totalSalaryGrowthPct - a.totalSalaryGrowthPct);
      break;
    case "fastest":
    default:
      sorted.sort((a, b) => a.totalYears - b.totalYears || a.steps - b.steps);
      break;
  }
  return sorted[0];
}

function _routeSummary(route) {
  return {
    path: route.path,
    steps: route.steps,
    total_years: route.totalYears,
    total_difficulty: route.totalDifficulty,
    salary_growth_pct: route.totalSalaryGrowthPct,
  };
}

function _roleSummary(role) {
  return {
    slug: role.slug,
    title: role.title,
    category: role.category,
    seniority: role.seniority,
    seniority_level: role.seniority_level,
    salary_mean: role.salary_uk?.mean || null,
  };
}

function _countCategoryChanges(steps) {
  let changes = 0;
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].category && steps[i - 1].category && steps[i].category !== steps[i - 1].category) {
      changes++;
    }
  }
  return changes;
}
