// ============================================================================
// lib/dashboard/savedRolesEngine.js
// HireEdge — AI Career Intelligence Platform
//
// Enriches a list of saved role slugs with dashboard-ready intelligence:
// fit score, salary, missing skills, and suggested next action.
// Reuses: roleIntelligenceEngine, salaryEngine, skillsGapEngine.
// ============================================================================

import { getRoleBySlug } from "../dataset/roleIndex.js";
import { getSalaryIntelligence } from "../intelligence/salaryEngine.js";
import { analyseSkillsGap } from "../intelligence/skillsGapEngine.js";
import { findShortestPath } from "../graph/careerPathEngine.js";

/**
 * Enrich a list of saved role slugs for dashboard display.
 *
 * @param {object} input
 * @param {string[]} input.roles      - Array of saved role slugs
 * @param {string}   [input.currentRole] - User's current role slug (for fit + path)
 * @param {string[]} [input.skills]   - User's skills (for gap analysis)
 * @returns {object}
 */
export function enrichSavedRoles(input) {
  const { roles, currentRole, skills } = input;
  const slugs = (roles || []).map((s) => s.trim()).filter(Boolean);
  const userSkills = (skills || []).map((s) => s.trim()).filter(Boolean);

  if (slugs.length === 0) {
    return { ok: true, data: { total: 0, roles: [] } };
  }

  const enriched = slugs.map((slug) => {
    const role = getRoleBySlug(slug);
    if (!role) return { slug, error: "Role not found" };

    const salary = _safe(() => getSalaryIntelligence(slug));
    const gap = userSkills.length > 0 ? _safe(() => analyseSkillsGap(userSkills, slug)) : null;
    const path = currentRole ? _safe(() => findShortestPath(currentRole, slug)) : null;

    const readinessPct = gap?.analysis?.readiness_pct ?? null;
    const missingSkills = gap?.analysis?.missing || [];

    return {
      slug,
      title: role.title,
      category: role.category,
      seniority: role.seniority,
      seniority_level: role.seniority_level,
      salary: salary ? {
        mean: salary.salary.mean,
        min: salary.salary.min,
        max: salary.salary.max,
      } : null,
      estimated_fit: readinessPct,
      fit_label: _fitLabel(readinessPct),
      top_missing_skills: missingSkills.slice(0, 5),
      missing_count: missingSkills.length,
      matched_count: gap?.analysis?.matched_count ?? null,
      path_steps: path?.steps ?? null,
      path_years: path?.totalYears ?? null,
      suggested_action: _suggestAction(readinessPct, missingSkills, path, slug),
    };
  });

  // Sort: valid results first, then by fit descending
  const valid = enriched.filter((r) => !r.error);
  const invalid = enriched.filter((r) => r.error);
  valid.sort((a, b) => (b.estimated_fit ?? -1) - (a.estimated_fit ?? -1));

  return {
    ok: true,
    data: {
      total: valid.length,
      roles: [...valid, ...invalid],
    },
  };
}

// ===========================================================================
// Internal
// ===========================================================================

function _fitLabel(pct) {
  if (pct === null) return null;
  if (pct >= 80) return "strong_fit";
  if (pct >= 60) return "good_fit";
  if (pct >= 40) return "partial_fit";
  return "stretch";
}

function _suggestAction(readinessPct, missingSkills, path, slug) {
  if (readinessPct === null) {
    return { type: "add_skills", label: "Add your skills to see fit analysis", prompt: `Check skills gap for ${slug}` };
  }
  if (readinessPct >= 80) {
    return { type: "apply", label: "You're a strong match — start applying", prompt: `Help me with my resume for ${slug}` };
  }
  if (readinessPct >= 50) {
    const top = missingSkills.slice(0, 2).join(", ");
    return { type: "upskill", label: `Learn ${top} to strengthen your fit`, prompt: `What skills do I need for ${slug}?` };
  }
  if (path && path.steps >= 2) {
    return { type: "plan", label: "Build a step-by-step roadmap", prompt: `Build me a roadmap to ${slug}` };
  }
  return { type: "explore", label: "Explore the path to this role", prompt: `How do I move to ${slug}?` };
}

function _safe(fn) {
  try { return fn(); } catch (e) { console.error("[savedRolesEngine]", e.message); return null; }
}
