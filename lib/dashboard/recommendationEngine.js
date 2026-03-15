// ============================================================================
// lib/dashboard/recommendationEngine.js
// HireEdge — AI Career Intelligence Platform
//
// Personalised dashboard recommendations: roles to target, tools to use,
// skills to learn, and concrete next actions.
// Reuses: careerPathEngine, skillsGapEngine, salaryEngine, roleIntelligenceEngine.
// ============================================================================

import { getRoleBySlug } from "../dataset/roleIndex.js";
import { getNextMoves } from "../graph/careerPathEngine.js";
import { getSalaryIntelligence } from "../intelligence/salaryEngine.js";
import { analyseSkillsGap, findRolesMatchingSkills } from "../intelligence/skillsGapEngine.js";
import { getRoleProfile } from "../intelligence/roleIntelligenceEngine.js";

/**
 * Generate personalised dashboard recommendations.
 *
 * @param {object} input
 * @param {string}   input.role      - Current role slug
 * @param {string[]} input.skills    - User's skills
 * @param {number}   [input.yearsExp]
 * @param {string}   [input.target]  - Target role slug (optional)
 * @returns {object}
 */
export function generateDashboardRecommendations(input) {
  const { role, skills, yearsExp, target } = input;

  const userSkills = (skills || []).map((s) => s.trim()).filter(Boolean);
  const currentRole = getRoleBySlug(role);
  if (!currentRole) return { ok: false, error: `Role not found: ${role}` };

  // ── 1. Recommended roles ─────────────────────────────────────────────────
  const recommendedRoles = _buildRoleRecommendations(role, userSkills, target);

  // ── 2. Recommended tools ─────────────────────────────────────────────────
  const recommendedTools = _buildToolRecommendations(role, userSkills, target, yearsExp);

  // ── 3. Recommended next actions ──────────────────────────────────────────
  const nextActions = _buildNextActions(role, userSkills, target, yearsExp, recommendedRoles);

  // ── 4. Skill focus areas ─────────────────────────────────────────────────
  const skillFocus = _buildSkillFocus(role, userSkills, target);

  return {
    ok: true,
    data: {
      recommended_roles: recommendedRoles,
      recommended_tools: recommendedTools,
      recommended_next_actions: nextActions,
      recommended_skill_focus: skillFocus,
    },
  };
}

// ===========================================================================
// Builders
// ===========================================================================

function _buildRoleRecommendations(role, skills, target) {
  const recs = [];

  // Next moves from graph (career progression)
  const nextMoves = _safe(() => getNextMoves(role, { sortBy: "salary" })) || [];
  for (const move of nextMoves.slice(0, 4)) {
    const gap = skills.length > 0 ? _safe(() => analyseSkillsGap(skills, move.slug)) : null;
    recs.push({
      slug: move.slug,
      title: move.title,
      category: move.target_category,
      source: "career_progression",
      reason: `Natural next step with ${move.salary_growth_pct}% salary growth`,
      salary_growth_pct: move.salary_growth_pct,
      difficulty_label: move.difficulty_label,
      estimated_years: move.estimated_years,
      readiness_pct: gap?.analysis?.readiness_pct ?? null,
    });
  }

  // Skill-matched roles (lateral / discovery)
  if (skills.length >= 2) {
    const matched = _safe(() => findRolesMatchingSkills(skills, { limit: 6, minMatch: 3 })) || [];
    for (const m of matched) {
      if (m.slug === role || recs.some((r) => r.slug === m.slug)) continue;
      recs.push({
        slug: m.slug,
        title: m.title,
        category: m.category,
        source: "skill_match",
        reason: `${m.match_pct}% skill overlap — your skills transfer well`,
        salary_growth_pct: null,
        difficulty_label: null,
        estimated_years: null,
        readiness_pct: m.match_pct,
      });
      if (recs.length >= 8) break;
    }
  }

  return recs.slice(0, 8);
}

function _buildToolRecommendations(role, skills, target, yearsExp) {
  const tools = [];

  // Always recommend talent profile if skills provided
  if (skills.length > 0) {
    tools.push({
      tool: "talent-profile",
      label: "Career Profile",
      reason: "See your strengths, gaps, and best-fit roles",
      endpoint: "/api/tools/talent-profile",
      params: { role, skills: skills.join(","), yearsExp, target },
      priority: "high",
    });
  }

  // Resume optimiser if target exists
  if (target) {
    tools.push({
      tool: "resume-optimiser",
      label: "Resume Optimiser",
      reason: `ATS-optimise your resume for ${_titleOf(target)}`,
      endpoint: "/api/tools/resume-optimiser",
      params: { action: "blueprint", target, skills: skills.join(","), current: role },
      priority: "high",
    });

    tools.push({
      tool: "interview-prep",
      label: "Interview Prep",
      reason: `Prepare for ${_titleOf(target)} interviews`,
      endpoint: "/api/tools/interview-prep",
      params: { target, skills: skills.join(","), current: role, yearsExp },
      priority: "medium",
    });

    tools.push({
      tool: "career-roadmap",
      label: "Career Roadmap",
      reason: `Step-by-step path from ${_titleOf(role)} to ${_titleOf(target)}`,
      endpoint: "/api/tools/career-roadmap",
      params: { action: "build", from: role, to: target, strategy: "fastest" },
      priority: "high",
    });
  }

  // LinkedIn always useful
  if (skills.length > 0) {
    tools.push({
      tool: "linkedin-optimiser",
      label: "LinkedIn Optimiser",
      reason: "Boost your LinkedIn visibility and recruiter matches",
      endpoint: "/api/tools/linkedin-optimiser",
      params: { role, skills: skills.join(","), yearsExp, target },
      priority: "medium",
    });
  }

  // Career pack if both role and target
  if (role && target && skills.length > 0) {
    tools.push({
      tool: "career-pack",
      label: "Full Career Pack",
      reason: "Get everything in one download",
      endpoint: "/api/career-pack/build",
      params: { role, target, skills: skills.join(","), yearsExp },
      priority: "low",
    });
  }

  // Sort by priority
  const order = { high: 0, medium: 1, low: 2 };
  tools.sort((a, b) => (order[a.priority] ?? 2) - (order[b.priority] ?? 2));

  return tools;
}

function _buildNextActions(role, skills, target, yearsExp, recommendedRoles) {
  const actions = [];

  // Missing skills
  if (skills.length === 0) {
    actions.push({
      type: "add_context",
      priority: "high",
      label: "Add your skills for personalised recommendations",
      description: "We need your skill set to calculate fit scores and gap analyses.",
    });
  }

  // No target
  if (!target && recommendedRoles.length > 0) {
    const top = recommendedRoles[0];
    actions.push({
      type: "set_target",
      priority: "high",
      label: `Set a career target — we suggest ${top.title}`,
      description: `${top.title} has ${top.salary_growth_pct || "strong"}% salary growth and aligns with your skills.`,
      data: { suggested_slug: top.slug },
    });
  }

  // Skills gaps to close
  if (target && skills.length > 0) {
    const gap = _safe(() => analyseSkillsGap(skills, target));
    if (gap && gap.analysis.missing_count > 0) {
      const topMissing = gap.analysis.missing.slice(0, 3);
      actions.push({
        type: "upskill",
        priority: "high",
        label: `Close your skills gap: learn ${topMissing.join(", ")}`,
        description: `You're ${gap.analysis.readiness_pct}% ready for ${_titleOf(target)}. ${gap.analysis.missing_count} skill${gap.analysis.missing_count !== 1 ? "s" : ""} to go.`,
      });
    }
  }

  // Experience check
  if (yearsExp && role) {
    const r = getRoleBySlug(role);
    if (r?.experience_years) {
      if (yearsExp > r.experience_years.max) {
        actions.push({
          type: "level_up",
          priority: "medium",
          label: "You may be overqualified — consider a more senior role",
          description: `${r.title} typically needs ${r.experience_years.min}–${r.experience_years.max} years. You have ${yearsExp}.`,
        });
      }
    }
  }

  // General action
  actions.push({
    type: "explore",
    priority: "low",
    label: "Ask the Copilot anything about your career",
    description: "Type a question in natural language and get personalised guidance.",
  });

  const order = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => (order[a.priority] ?? 2) - (order[b.priority] ?? 2));

  return actions.slice(0, 6);
}

function _buildSkillFocus(role, skills, target) {
  const focusAreas = [];
  const userLower = new Set(skills.map((s) => s.toLowerCase()));

  // Gaps for current role
  const currentRole = getRoleBySlug(role);
  if (currentRole) {
    const grouped = currentRole.skills_grouped || {};
    const coreMissing = (grouped.core || []).filter((s) => !userLower.has(s.toLowerCase()));
    const techMissing = (grouped.technical || []).filter((s) => !userLower.has(s.toLowerCase()));

    for (const s of coreMissing) {
      focusAreas.push({ skill: s, source: "current_role_gap", group: "core", priority: "high" });
    }
    for (const s of techMissing.slice(0, 4)) {
      focusAreas.push({ skill: s, source: "current_role_gap", group: "technical", priority: "medium" });
    }
  }

  // Gaps for target role
  if (target) {
    const gap = _safe(() => analyseSkillsGap(skills, target));
    if (gap) {
      for (const item of (gap.prioritised_learning_path || []).slice(0, 5)) {
        if (!focusAreas.some((f) => f.skill.toLowerCase() === item.skill.toLowerCase())) {
          focusAreas.push({ skill: item.skill, source: "target_role_gap", group: item.group, priority: item.priority });
        }
      }
    }
  }

  // Dedupe and cap
  const seen = new Set();
  const deduped = focusAreas.filter((f) => {
    const key = f.skill.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const order = { high: 0, medium: 1, low: 2 };
  deduped.sort((a, b) => (order[a.priority] ?? 2) - (order[b.priority] ?? 2));

  return deduped.slice(0, 10);
}

// ===========================================================================
// Util
// ===========================================================================
function _titleOf(slug) {
  const r = getRoleBySlug(slug);
  return r?.title || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function _safe(fn) {
  try { return fn(); } catch (e) { console.error("[recommendationEngine]", e.message); return null; }
}
