// ============================================================================
// lib/tools/talentProfileEngine.js
// HireEdge — AI Career Intelligence Platform
// Generates a structured talent profile: career summary, strengths, gaps,
// market positioning, and next-move recommendations.
// ============================================================================

import { getRoleBySlug } from "../dataset/roleIndex.js";
import { getNextMoves, getPreviousMoves } from "../graph/careerPathEngine.js";
import { getSalaryIntelligence } from "../intelligence/salaryEngine.js";
import { getRoleProfile } from "../intelligence/roleIntelligenceEngine.js";
import { analyseSkillsGap, findRolesMatchingSkills } from "../intelligence/skillsGapEngine.js";

/**
 * Generate a comprehensive talent profile for a user.
 *
 * @param {object} input
 * @param {string}   input.currentRole   - Slug of the user's current role
 * @param {string[]} input.skills        - Skills the user claims to have
 * @param {number}   [input.yearsExp]    - Years of experience (optional)
 * @param {string}   [input.targetRole]  - Optional target role slug
 * @returns {object | null}
 */
export function generateTalentProfile(input) {
  const { currentRole, skills, yearsExp, targetRole } = input;

  const role = getRoleBySlug(currentRole);
  if (!role) return null;

  const userSkills = (skills || []).map((s) => s.trim()).filter(Boolean);
  const profile = getRoleProfile(currentRole);
  const salary = getSalaryIntelligence(currentRole);

  // ── 1. Role fitness — how well does the user match their current role? ───
  const roleFitness = _assessRoleFitness(role, userSkills);

  // ── 2. Salary context ────────────────────────────────────────────────────
  const salaryContext = salary
    ? {
        current_mean: salary.salary.mean,
        current_range: { min: salary.salary.min, max: salary.salary.max },
        percentile_in_category: salary.category_benchmark.percentile_in_category,
        vs_category_pct: salary.category_benchmark.vs_category_pct,
        category_mean: salary.category_benchmark.category_mean,
        best_salary_move: salary.best_salary_move
          ? {
              slug: salary.best_salary_move.slug,
              title: salary.best_salary_move.title,
              growth_pct: salary.best_salary_move.salary_growth_pct,
              target_salary: salary.best_salary_move.target_salary_mean,
            }
          : null,
      }
    : null;

  // ── 3. Strengths — skills the user has that are valued ───────────────────
  const strengths = _assessStrengths(role, userSkills);

  // ── 4. Gaps — skills the user is missing for their own role ──────────────
  const gaps = _assessGaps(role, userSkills);

  // ── 5. Next moves — enriched career options ──────────────────────────────
  const nextMoves = getNextMoves(currentRole, { sortBy: "salary" }).slice(0, 6);
  const nextMoveProfiles = nextMoves.map((move) => {
    const gapAnalysis = analyseSkillsGap(userSkills, move.slug);
    return {
      slug: move.slug,
      title: move.title,
      seniority: move.target_seniority,
      category: move.target_category,
      difficulty_label: move.difficulty_label,
      estimated_years: move.estimated_years,
      salary_growth_pct: move.salary_growth_pct,
      target_salary_mean: move.target_salary?.mean || null,
      readiness_pct: gapAnalysis?.analysis?.readiness_pct ?? null,
      missing_skills_count: gapAnalysis?.analysis?.missing_count ?? null,
      missing_skills: gapAnalysis?.analysis?.missing?.slice(0, 5) || [],
    };
  });

  // ── 6. Best-fit roles for the user's actual skill set ────────────────────
  const bestFitRoles = findRolesMatchingSkills(userSkills, { limit: 6, minMatch: 3 })
    .filter((r) => r.slug !== currentRole)
    .slice(0, 5)
    .map((r) => ({
      slug: r.slug,
      title: r.title,
      category: r.category,
      seniority: r.seniority,
      match_pct: r.match_pct,
      salary_mean: r.salary_mean,
      gap_count: r.gap_count,
    }));

  // ── 7. Target role analysis (if provided) ────────────────────────────────
  let targetAnalysis = null;
  if (targetRole) {
    const targetGap = analyseSkillsGap(userSkills, targetRole);
    const targetRoleData = getRoleBySlug(targetRole);
    if (targetGap && targetRoleData) {
      targetAnalysis = {
        slug: targetRole,
        title: targetRoleData.title,
        category: targetRoleData.category,
        seniority: targetRoleData.seniority,
        readiness_pct: targetGap.analysis.readiness_pct,
        matched_skills: targetGap.analysis.matched,
        missing_skills: targetGap.analysis.missing,
        missing_by_group: targetGap.missing_by_group,
        prioritised_learning_path: targetGap.prioritised_learning_path,
        target_salary_mean: targetRoleData.salary_uk?.mean || null,
      };
    }
  }

  // ── 8. Experience assessment ─────────────────────────────────────────────
  let experienceAssessment = null;
  if (yearsExp !== undefined && yearsExp !== null && role.experience_years) {
    const { min, max } = role.experience_years;
    let level;
    if (yearsExp < min) level = "below_typical";
    else if (yearsExp > max) level = "above_typical";
    else level = "within_range";

    experienceAssessment = {
      user_years: yearsExp,
      role_typical: role.experience_years,
      level,
      note:
        level === "below_typical"
          ? `You have less experience than typically expected (${min}–${max} years). Your skills may compensate, but expect tougher competition.`
          : level === "above_typical"
            ? `You exceed the typical experience range (${min}–${max} years). Consider whether a more senior role might be a better fit.`
            : `Your experience (${yearsExp} years) is within the typical ${min}–${max} year range for this role.`,
    };
  }

  // ── 9. Assemble the profile ──────────────────────────────────────────────
  return {
    current_role: {
      slug: role.slug,
      title: role.title,
      category: role.category,
      seniority: role.seniority,
      seniority_level: role.seniority_level,
      industries: role.industries || [],
    },
    user_skills: userSkills,
    role_fitness: roleFitness,
    experience: experienceAssessment,
    strengths,
    gaps,
    salary_context: salaryContext,
    next_moves: nextMoveProfiles,
    best_fit_roles: bestFitRoles,
    target_role_analysis: targetAnalysis,
    career_mobility: {
      next_options_count: profile?.career_mobility?.next_roles_count || 0,
      previous_routes_count: profile?.career_mobility?.previous_roles_count || 0,
      adjacent_roles: (role.adjacent_roles || []).slice(0, 4),
    },
  };
}

// ===========================================================================
// Internal helpers
// ===========================================================================

function _assessRoleFitness(role, userSkills) {
  const required = role.skills || [];
  const userSet = new Set(userSkills.map((s) => s.toLowerCase()));
  let matched = 0;

  for (const s of required) {
    if (userSet.has(s.toLowerCase())) matched++;
  }

  const fitnessPct = required.length ? Math.round((matched / required.length) * 100) : 100;

  let label;
  if (fitnessPct >= 85) label = "strong_fit";
  else if (fitnessPct >= 65) label = "good_fit";
  else if (fitnessPct >= 45) label = "partial_fit";
  else label = "weak_fit";

  return {
    fitness_pct: fitnessPct,
    label,
    matched_count: matched,
    total_required: required.length,
  };
}

function _assessStrengths(role, userSkills) {
  const userSet = new Set(userSkills.map((s) => s.toLowerCase()));
  const grouped = role.skills_grouped || {};

  const coreMatched = (grouped.core || []).filter((s) => userSet.has(s.toLowerCase()));
  const techMatched = (grouped.technical || []).filter((s) => userSet.has(s.toLowerCase()));
  const softMatched = (grouped.soft || []).filter((s) => userSet.has(s.toLowerCase()));

  // Extra skills the user has beyond what the role requires
  const roleSkillsLower = new Set((role.skills || []).map((s) => s.toLowerCase()));
  const bonusSkills = userSkills.filter((s) => !roleSkillsLower.has(s.toLowerCase()));

  return {
    core_skills_held: coreMatched,
    technical_skills_held: techMatched,
    soft_skills_held: softMatched,
    bonus_skills: bonusSkills,
    total_strengths: coreMatched.length + techMatched.length + softMatched.length,
  };
}

function _assessGaps(role, userSkills) {
  const userSet = new Set(userSkills.map((s) => s.toLowerCase()));
  const grouped = role.skills_grouped || {};

  const coreMissing = (grouped.core || []).filter((s) => !userSet.has(s.toLowerCase()));
  const techMissing = (grouped.technical || []).filter((s) => !userSet.has(s.toLowerCase()));
  const softMissing = (grouped.soft || []).filter((s) => !userSet.has(s.toLowerCase()));

  return {
    core_missing: coreMissing,
    technical_missing: techMissing,
    soft_missing: softMissing,
    total_gaps: coreMissing.length + techMissing.length + softMissing.length,
    critical_gaps: coreMissing,
  };
}
