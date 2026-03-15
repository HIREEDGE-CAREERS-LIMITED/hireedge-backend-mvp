// ============================================================================
// lib/copilot/orchestrator.js
// HireEdge — AI Career Intelligence Platform
//
// Central orchestrator. Takes a classified intent + entities and calls the
// appropriate downstream engines, returning structured insights.
// This is the brain of the Copilot — it decides WHICH engines to call
// for each intent and aggregates the results.
//
// Engine delegation:
//   transition   → roadmap + skillsGap + gapExplainer + salary
//   explore      → nextMoves + talentProfile + salary
//   skills_gap   → skillsGap + roleProfile
//   salary       → salaryIntelligence + compareSalaries
//   interview    → interviewPrep
//   resume       → resumeBlueprint
//   linkedin     → linkedinOptimisation
//   visa         → visaEligibility
//   career_pack  → careerPackEngine
//   role_info    → roleProfile + salary
//   compare      → compareRoles + compareSalaries
//   general      → roleProfile (if role available) or search
// ============================================================================

import { getRoleBySlug, searchRoles } from "../dataset/roleIndex.js";
import { getRoleProfile, compareRoles } from "../intelligence/roleIntelligenceEngine.js";
import { getSalaryIntelligence, compareSalaries } from "../intelligence/salaryEngine.js";
import { analyseSkillsGap } from "../intelligence/skillsGapEngine.js";
import { getNextMoves } from "../graph/careerPathEngine.js";
import { buildRoadmap } from "../tools/roadmapEngine.js";
import { explainTransitionGap } from "../tools/gapExplainerEngine.js";
import { generateTalentProfile } from "../tools/talentProfileEngine.js";
import { generateResumeBlueprint } from "../tools/resumeEngine.js";
import { generateLinkedInOptimisation } from "../tools/linkedinEngine.js";
import { generateInterviewPrep } from "../tools/interviewEngine.js";
import { assessVisaEligibility } from "../tools/visaEngine.js";
import { buildCareerPack } from "../career-pack/careerPackEngine.js";

/**
 * Orchestrate engine calls based on detected intent and entities.
 *
 * @param {string} intent
 * @param {object} entities   - { currentRole, targetRole, skills, yearsExp, mentionedRoles }
 * @param {object} context    - Resolved conversation context
 * @returns {{ engines_called: string[], insights: object }}
 */
export function orchestrate(intent, entities, context) {
  const role = entities.currentRole || context.role;
  const target = entities.targetRole || context.target;
  const skills = entities.skills?.length > 0 ? entities.skills : context.skills;
  const yearsExp = entities.yearsExp ?? context.yearsExp;
  const mentioned = entities.mentionedRoles || [];

  const enginesCalled = [];
  const insights = {};

  switch (intent) {
    // ── Transition ─────────────────────────────────────────────────────
    case "transition": {
      if (role && target) {
        insights.roadmap = _safe(() => buildRoadmap(role, target, { strategy: "fastest" }));
        enginesCalled.push("roadmapEngine");

        insights.gap_explanation = _safe(() => explainTransitionGap(role, target));
        enginesCalled.push("gapExplainerEngine");

        if (skills.length > 0) {
          insights.skills_gap = _safe(() => analyseSkillsGap(skills, target));
          enginesCalled.push("skillsGapEngine");
        }

        insights.salary_comparison = _safe(() => compareSalaries([role, target]));
        enginesCalled.push("salaryEngine");
      } else if (target) {
        insights.target_profile = _safe(() => getRoleProfile(target));
        enginesCalled.push("roleIntelligenceEngine");
        insights.target_salary = _safe(() => getSalaryIntelligence(target));
        enginesCalled.push("salaryEngine");
      }
      break;
    }

    // ── Explore ────────────────────────────────────────────────────────
    case "explore": {
      if (role) {
        insights.next_moves = _safe(() => getNextMoves(role, { sortBy: "salary" }));
        enginesCalled.push("careerPathEngine");

        insights.salary = _safe(() => getSalaryIntelligence(role));
        enginesCalled.push("salaryEngine");

        if (skills.length > 0) {
          insights.talent_profile = _safe(() => generateTalentProfile({
            currentRole: role,
            skills,
            yearsExp,
          }));
          enginesCalled.push("talentProfileEngine");
        }

        insights.role_profile = _safe(() => getRoleProfile(role));
        enginesCalled.push("roleIntelligenceEngine");
      }
      break;
    }

    // ── Skills Gap ─────────────────────────────────────────────────────
    case "skills_gap": {
      const targetSlug = target || role;
      if (targetSlug && skills.length > 0) {
        insights.skills_gap = _safe(() => analyseSkillsGap(skills, targetSlug));
        enginesCalled.push("skillsGapEngine");
      }
      if (targetSlug) {
        insights.role_profile = _safe(() => getRoleProfile(targetSlug));
        enginesCalled.push("roleIntelligenceEngine");
      }
      if (role && target) {
        insights.gap_explanation = _safe(() => explainTransitionGap(role, target));
        enginesCalled.push("gapExplainerEngine");
      }
      break;
    }

    // ── Salary ─────────────────────────────────────────────────────────
    case "salary": {
      const slugs = [];
      if (role) slugs.push(role);
      if (target && target !== role) slugs.push(target);
      if (mentioned.length > 0) {
        for (const m of mentioned) {
          if (!slugs.includes(m.slug)) slugs.push(m.slug);
        }
      }

      for (const s of slugs.slice(0, 4)) {
        insights[`salary_${s}`] = _safe(() => getSalaryIntelligence(s));
        enginesCalled.push("salaryEngine");
      }
      if (slugs.length >= 2) {
        insights.salary_comparison = _safe(() => compareSalaries(slugs.slice(0, 5)));
        enginesCalled.push("salaryEngine");
      }
      break;
    }

    // ── Interview ──────────────────────────────────────────────────────
    case "interview": {
      const t = target || role;
      if (t) {
        insights.interview_prep = _safe(() => generateInterviewPrep({
          targetRole: t,
          skills,
          currentRole: role || undefined,
          yearsExp,
        }));
        enginesCalled.push("interviewEngine");
      }
      break;
    }

    // ── Resume ─────────────────────────────────────────────────────────
    case "resume": {
      const t = target || role;
      if (t && skills.length > 0) {
        insights.resume_blueprint = _safe(() => generateResumeBlueprint({
          targetRole: t,
          skills,
          currentRole: role || undefined,
          yearsExp,
        }));
        enginesCalled.push("resumeEngine");
      } else if (t) {
        insights.target_profile = _safe(() => getRoleProfile(t));
        enginesCalled.push("roleIntelligenceEngine");
      }
      break;
    }

    // ── LinkedIn ───────────────────────────────────────────────────────
    case "linkedin": {
      if (role && skills.length > 0) {
        insights.linkedin_optimisation = _safe(() => generateLinkedInOptimisation({
          currentRole: role,
          skills,
          yearsExp,
          targetRole: target || undefined,
        }));
        enginesCalled.push("linkedinEngine");
      } else if (role) {
        insights.role_profile = _safe(() => getRoleProfile(role));
        enginesCalled.push("roleIntelligenceEngine");
      }
      break;
    }

    // ── Visa ───────────────────────────────────────────────────────────
    case "visa": {
      const t = target || role;
      if (t) {
        insights.visa_assessment = _safe(() => assessVisaEligibility({
          targetRole: t,
          skills,
        }));
        enginesCalled.push("visaEngine");

        insights.salary = _safe(() => getSalaryIntelligence(t));
        enginesCalled.push("salaryEngine");
      }
      break;
    }

    // ── Career Pack ────────────────────────────────────────────────────
    case "career_pack": {
      if (role && target && skills.length > 0) {
        insights.career_pack = _safe(() => buildCareerPack({
          role,
          target,
          skills,
          yearsExp,
        }));
        enginesCalled.push("careerPackEngine");
      }
      break;
    }

    // ── Role Info ──────────────────────────────────────────────────────
    case "role_info": {
      const slug = mentioned[0]?.slug || target || role;
      if (slug) {
        insights.role_profile = _safe(() => getRoleProfile(slug));
        enginesCalled.push("roleIntelligenceEngine");
        insights.salary = _safe(() => getSalaryIntelligence(slug));
        enginesCalled.push("salaryEngine");
      }
      break;
    }

    // ── Compare ────────────────────────────────────────────────────────
    case "compare": {
      if (mentioned.length >= 2) {
        insights.comparison = _safe(() => compareRoles(mentioned[0].slug, mentioned[1].slug));
        enginesCalled.push("roleIntelligenceEngine");
        insights.salary_comparison = _safe(() => compareSalaries(mentioned.map((m) => m.slug)));
        enginesCalled.push("salaryEngine");
      }
      break;
    }

    // ── General / fallback ─────────────────────────────────────────────
    case "general":
    default: {
      if (role) {
        insights.role_profile = _safe(() => getRoleProfile(role));
        enginesCalled.push("roleIntelligenceEngine");
      }
      // Try to search if there's text that might be a role
      if (mentioned.length > 0) {
        insights.mentioned_role = _safe(() => getRoleProfile(mentioned[0].slug));
        enginesCalled.push("roleIntelligenceEngine");
      }
      break;
    }
  }

  return { engines_called: [...new Set(enginesCalled)], insights };
}

// ===========================================================================
// Internal
// ===========================================================================
function _safe(fn) {
  try {
    return fn();
  } catch (err) {
    console.error("[orchestrator]", err.message);
    return null;
  }
}
