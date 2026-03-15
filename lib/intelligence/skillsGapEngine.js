// ============================================================================
// lib/intelligence/skillsGapEngine.js
// HireEdge — AI Career Intelligence Platform
// Skills gap analysis: what you need, what you have, what to learn.
// ============================================================================

import { getRoleBySlug, getRoleMap } from "../dataset/roleIndex.js";

/**
 * Analyse the skills gap between a person's current skills and a target role.
 *
 * @param {string[]} currentSkills - Skills the person already has
 * @param {string} targetSlug - Target role slug
 * @returns {object | null}
 */
export function analyseSkillsGap(currentSkills, targetSlug) {
  const target = getRoleBySlug(targetSlug);
  if (!target) return null;

  const current = new Set(currentSkills.map((s) => s.toLowerCase().trim()));
  const required = target.skills || [];

  const matched = [];
  const missing = [];

  for (const skill of required) {
    if (current.has(skill.toLowerCase())) {
      matched.push(skill);
    } else {
      missing.push(skill);
    }
  }

  const readinessPct = required.length
    ? Math.round((matched.length / required.length) * 100)
    : 100;

  // Categorise missing skills using skills_grouped
  const grouped = target.skills_grouped || {};
  const missingGrouped = {
    core: missing.filter((s) => (grouped.core || []).includes(s)),
    technical: missing.filter((s) => (grouped.technical || []).includes(s)),
    soft: missing.filter((s) => (grouped.soft || []).includes(s)),
  };

  // Priority scoring: core > technical > soft
  const prioritised = [
    ...missingGrouped.core.map((s) => ({ skill: s, priority: "high", group: "core" })),
    ...missingGrouped.technical.map((s) => ({ skill: s, priority: "medium", group: "technical" })),
    ...missingGrouped.soft.map((s) => ({ skill: s, priority: "low", group: "soft" })),
  ];

  // Any missing skills not in grouped categories
  const categorised = new Set([...missingGrouped.core, ...missingGrouped.technical, ...missingGrouped.soft]);
  for (const s of missing) {
    if (!categorised.has(s)) {
      prioritised.push({ skill: s, priority: "medium", group: "other" });
    }
  }

  return {
    target: {
      slug: target.slug,
      title: target.title,
      category: target.category,
      seniority: target.seniority,
      total_skills_required: required.length,
    },
    analysis: {
      matched,
      missing,
      matched_count: matched.length,
      missing_count: missing.length,
      readiness_pct: readinessPct,
    },
    missing_by_group: missingGrouped,
    prioritised_learning_path: prioritised,
  };
}

/**
 * Analyse skills gap between two roles (role-to-role transition).
 *
 * @param {string} fromSlug
 * @param {string} toSlug
 * @returns {object | null}
 */
export function analyseRoleTransitionGap(fromSlug, toSlug) {
  const from = getRoleBySlug(fromSlug);
  const to = getRoleBySlug(toSlug);
  if (!from || !to) return null;

  const fromSkills = new Set((from.skills || []).map((s) => s.toLowerCase()));
  const toSkills = to.skills || [];

  const shared = [];
  const newSkillsNeeded = [];

  for (const skill of toSkills) {
    if (fromSkills.has(skill.toLowerCase())) {
      shared.push(skill);
    } else {
      newSkillsNeeded.push(skill);
    }
  }

  // Skills from `from` role that are not required in `to` role
  const toSet = new Set(toSkills.map((s) => s.toLowerCase()));
  const unusedSkills = (from.skills || []).filter((s) => !toSet.has(s.toLowerCase()));

  const overlapPct = toSkills.length
    ? Math.round((shared.length / toSkills.length) * 100)
    : 100;

  // Find the transition metadata if it exists
  const transition = (from.transitions?.next || []).find((t) => t.to === toSlug);

  return {
    from: { slug: from.slug, title: from.title, category: from.category, seniority: from.seniority },
    to: { slug: to.slug, title: to.title, category: to.category, seniority: to.seniority },
    transition_metadata: transition
      ? {
          difficulty_score: transition.difficulty_score,
          difficulty_label: transition.difficulty_label,
          estimated_years: transition.estimated_years,
          salary_growth_pct: transition.salary_growth_pct,
        }
      : null,
    skills_analysis: {
      shared,
      new_skills_needed: newSkillsNeeded,
      unused_from_current: unusedSkills,
      overlap_pct: overlapPct,
      shared_count: shared.length,
      new_needed_count: newSkillsNeeded.length,
    },
  };
}

/**
 * Given a set of skills, find the best-matching roles.
 *
 * @param {string[]} skills
 * @param {{ limit?: number, category?: string, minMatch?: number }} opts
 * @returns {Array<object>}
 */
export function findRolesMatchingSkills(skills, opts = {}) {
  const limit = opts.limit || 20;
  const minMatch = opts.minMatch || 1;
  const inputSkills = new Set(skills.map((s) => s.toLowerCase().trim()));
  const roleMap = getRoleMap();
  const results = [];

  for (const [slug, role] of roleMap) {
    if (opts.category && role.category !== opts.category) continue;

    const roleSkills = (role.skills || []).map((s) => s.toLowerCase());
    let matchCount = 0;
    for (const s of roleSkills) {
      if (inputSkills.has(s)) matchCount++;
    }

    if (matchCount < minMatch) continue;

    const matchPct = roleSkills.length
      ? Math.round((matchCount / roleSkills.length) * 100)
      : 0;

    results.push({
      slug,
      title: role.title,
      category: role.category,
      seniority: role.seniority,
      salary_mean: role.salary_uk?.mean || null,
      matched_skills: matchCount,
      total_skills: roleSkills.length,
      match_pct: matchPct,
      gap_count: roleSkills.length - matchCount,
    });
  }

  results.sort((a, b) => b.match_pct - a.match_pct || b.matched_skills - a.matched_skills);
  return results.slice(0, limit);
}
