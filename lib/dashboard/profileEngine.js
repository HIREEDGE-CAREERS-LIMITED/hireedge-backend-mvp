// ============================================================================
// lib/dashboard/profileEngine.js
// HireEdge — AI Career Intelligence Platform
//
// Dashboard profile assembly. Composes a single dashboard-ready view from
// existing engines: talentProfileEngine, salaryEngine, skillsGapEngine,
// careerPathEngine, roleIntelligenceEngine. Zero duplicated logic.
// ============================================================================

import { getRoleBySlug } from "../dataset/roleIndex.js";
import { getRoleProfile } from "../intelligence/roleIntelligenceEngine.js";
import { getSalaryIntelligence } from "../intelligence/salaryEngine.js";
import { analyseSkillsGap } from "../intelligence/skillsGapEngine.js";
import { getNextMoves } from "../graph/careerPathEngine.js";
import { generateTalentProfile } from "../tools/talentProfileEngine.js";

/**
 * Build a complete dashboard profile for a user.
 *
 * @param {object} input
 * @param {string}   input.role      - Current role slug
 * @param {string}   [input.target]  - Target role slug (optional)
 * @param {string[]} input.skills    - User's skills
 * @param {number}   [input.yearsExp] - Years of experience
 * @returns {object}
 */
export function buildDashboardProfile(input) {
  const { role, target, skills, yearsExp } = input;

  const userSkills = (skills || []).map((s) => s.trim()).filter(Boolean);
  const currentRole = getRoleBySlug(role);
  if (!currentRole) {
    return { ok: false, error: `Role not found: ${role}` };
  }

  // ── 1. Profile summary (from talentProfileEngine) ────────────────────────
  const talentProfile = _safe(() => generateTalentProfile({
    currentRole: role,
    skills: userSkills,
    yearsExp,
    targetRole: target || undefined,
  }));

  // ── 2. Role snapshot ─────────────────────────────────────────────────────
  const roleProfile = _safe(() => getRoleProfile(role));
  const roleSnapshot = roleProfile ? {
    slug: roleProfile.slug,
    title: roleProfile.title,
    category: roleProfile.category,
    seniority: roleProfile.seniority,
    seniority_level: roleProfile.seniority_level,
    experience_years: roleProfile.experience_years,
    industries: roleProfile.industries,
    skills_required: roleProfile.skills,
    skills_grouped: roleProfile.skills_grouped,
    adjacent_roles: (roleProfile.adjacent_roles || []).slice(0, 4),
    career_mobility: roleProfile.career_mobility,
  } : null;

  // ── 3. Salary snapshot ───────────────────────────────────────────────────
  const salary = _safe(() => getSalaryIntelligence(role));
  const salarySnapshot = salary ? {
    mean: salary.salary.mean,
    min: salary.salary.min,
    max: salary.salary.max,
    currency: salary.salary.currency || "GBP",
    percentile_in_category: salary.category_benchmark.percentile_in_category,
    vs_category_pct: salary.category_benchmark.vs_category_pct,
    category_mean: salary.category_benchmark.category_mean,
    best_salary_move: salary.best_salary_move ? {
      slug: salary.best_salary_move.slug,
      title: salary.best_salary_move.title,
      growth_pct: salary.best_salary_move.salary_growth_pct,
    } : null,
  } : null;

  // ── 4. Readiness ─────────────────────────────────────────────────────────
  const readiness = _buildReadiness(talentProfile, target, userSkills);

  // ── 5. Next roles ────────────────────────────────────────────────────────
  const nextMoves = _safe(() => getNextMoves(role, { sortBy: "salary" })) || [];
  const nextRoles = nextMoves.slice(0, 6).map((m) => {
    const gap = userSkills.length > 0 ? _safe(() => analyseSkillsGap(userSkills, m.slug)) : null;
    return {
      slug: m.slug,
      title: m.title,
      seniority: m.target_seniority,
      category: m.target_category,
      difficulty_label: m.difficulty_label,
      estimated_years: m.estimated_years,
      salary_growth_pct: m.salary_growth_pct,
      target_salary_mean: m.target_salary?.mean || null,
      readiness_pct: gap?.analysis?.readiness_pct ?? null,
      top_missing: (gap?.analysis?.missing || []).slice(0, 3),
    };
  });

  // ── 6. Strengths ─────────────────────────────────────────────────────────
  const strengths = talentProfile?.strengths ? [
    ...(talentProfile.strengths.core_skills_held || []).map((s) => ({ skill: s, group: "core" })),
    ...(talentProfile.strengths.technical_skills_held || []).map((s) => ({ skill: s, group: "technical" })),
    ...(talentProfile.strengths.soft_skills_held || []).map((s) => ({ skill: s, group: "soft" })),
  ] : [];

  // ── 7. Gaps ──────────────────────────────────────────────────────────────
  const gaps = talentProfile?.gaps ? [
    ...(talentProfile.gaps.core_missing || []).map((s) => ({ skill: s, group: "core", priority: "high" })),
    ...(talentProfile.gaps.technical_missing || []).map((s) => ({ skill: s, group: "technical", priority: "medium" })),
    ...(talentProfile.gaps.soft_missing || []).map((s) => ({ skill: s, group: "soft", priority: "low" })),
  ] : [];

  return {
    ok: true,
    data: {
      profile_summary: {
        role: role,
        title: currentRole.title,
        category: currentRole.category,
        seniority: currentRole.seniority,
        skills_count: userSkills.length,
        years_exp: yearsExp ?? null,
        target: target || null,
        fitness: talentProfile?.role_fitness || null,
      },
      role_snapshot: roleSnapshot,
      salary_snapshot: salarySnapshot,
      readiness,
      next_roles: nextRoles,
      strengths,
      gaps,
    },
  };
}

// ===========================================================================
// Internal
// ===========================================================================

function _buildReadiness(talentProfile, target, skills) {
  const fitness = talentProfile?.role_fitness?.fitness_pct ?? null;
  const targetReadiness = talentProfile?.target_role_analysis?.readiness_pct ?? null;

  const scores = {};
  if (fitness !== null) scores.current_role_fitness = fitness;
  if (targetReadiness !== null) scores.target_readiness = targetReadiness;

  const overall = Object.values(scores).length > 0
    ? Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length)
    : null;

  let label = null;
  if (overall !== null) {
    if (overall >= 80) label = "strong";
    else if (overall >= 60) label = "good";
    else if (overall >= 40) label = "developing";
    else label = "early";
  }

  return {
    overall,
    label,
    scores,
    target_analysis: talentProfile?.target_role_analysis ? {
      slug: talentProfile.target_role_analysis.slug,
      title: talentProfile.target_role_analysis.title,
      readiness_pct: talentProfile.target_role_analysis.readiness_pct,
      matched_count: talentProfile.target_role_analysis.matched_skills?.length ?? 0,
      missing_count: talentProfile.target_role_analysis.missing_skills?.length ?? 0,
    } : null,
  };
}

function _safe(fn) {
  try { return fn(); } catch (e) { console.error("[profileEngine]", e.message); return null; }
}
