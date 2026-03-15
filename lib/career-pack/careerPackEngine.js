// ============================================================================
// lib/career-pack/careerPackEngine.js
// HireEdge — AI Career Intelligence Platform
//
// Career Pack orchestrator. Calls every downstream engine in a single pass
// and returns a unified, structured pack. Zero duplicated logic — every
// section delegates to the canonical engine.
//
// Downstream engines:
//   careerPathEngine   → roadmap (via roadmapEngine)
//   skillsGapEngine    → skills gap analysis
//   resumeEngine       → ATS-optimised resume blueprint
//   linkedinEngine     → LinkedIn profile optimisation
//   interviewEngine    → interview preparation pack
//   salaryEngine       → salary intelligence & benchmarks
//   visaEngine         → UK visa eligibility assessment
// ============================================================================

import { getRoleBySlug } from "../dataset/roleIndex.js";
import { buildRoadmap } from "../tools/roadmapEngine.js";
import { analyseSkillsGap } from "../intelligence/skillsGapEngine.js";
import { generateResumeBlueprint } from "../tools/resumeEngine.js";
import { generateLinkedInOptimisation } from "../tools/linkedinEngine.js";
import { generateInterviewPrep } from "../tools/interviewEngine.js";
import { getSalaryIntelligence, compareSalaries } from "../intelligence/salaryEngine.js";
import { assessVisaEligibility } from "../tools/visaEngine.js";

/**
 * Build a complete Career Pack by orchestrating all engines.
 *
 * @param {object} input
 * @param {string}   input.role      - Current role slug
 * @param {string}   input.target    - Target role slug
 * @param {string[]} input.skills    - User's current skills (comma-split already)
 * @param {number}   [input.yearsExp] - Years of experience
 * @returns {object}
 */
export function buildCareerPack(input) {
  const { role, target, skills, yearsExp } = input;

  // ── Validate inputs ──────────────────────────────────────────────────────
  const currentRole = getRoleBySlug(role);
  const targetRole = getRoleBySlug(target);
  const errors = [];

  if (!role) errors.push("Missing required param: role");
  if (!target) errors.push("Missing required param: target");
  if (!skills || skills.length === 0) errors.push("Missing required param: skills");
  if (!currentRole) errors.push(`Current role not found: ${role}`);
  if (!targetRole) errors.push(`Target role not found: ${target}`);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const userSkills = skills.map((s) => s.trim()).filter(Boolean);
  const parsedYears = typeof yearsExp === "number" ? yearsExp : undefined;

  // ── Generate a unique pack ID for export referencing ─────────────────────
  const packId = `cp_${role}_${target}_${Date.now()}`;
  const generatedAt = new Date().toISOString();

  // ── 1. Roadmap ───────────────────────────────────────────────────────────
  const roadmap = _safe("roadmap", () =>
    buildRoadmap(role, target, { strategy: "fastest" })
  );

  // ── 2. Skills Gap ────────────────────────────────────────────────────────
  const skillsGap = _safe("skills_gap", () =>
    analyseSkillsGap(userSkills, target)
  );

  // ── 3. Resume Blueprint ──────────────────────────────────────────────────
  const resumeBlueprint = _safe("resume_blueprint", () =>
    generateResumeBlueprint({
      targetRole: target,
      skills: userSkills,
      currentRole: role,
      yearsExp: parsedYears,
    })
  );

  // ── 4. LinkedIn Optimisation ─────────────────────────────────────────────
  const linkedinOptimisation = _safe("linkedin_optimisation", () =>
    generateLinkedInOptimisation({
      currentRole: role,
      skills: userSkills,
      yearsExp: parsedYears,
      targetRole: target,
    })
  );

  // ── 5. Interview Prep ────────────────────────────────────────────────────
  const interviewPrep = _safe("interview_prep", () =>
    generateInterviewPrep({
      targetRole: target,
      skills: userSkills,
      currentRole: role,
      yearsExp: parsedYears,
    })
  );

  // ── 6. Salary Insight ────────────────────────────────────────────────────
  const salaryInsight = _safe("salary_insight", () => {
    const currentSalary = getSalaryIntelligence(role);
    const targetSalary = getSalaryIntelligence(target);
    const comparison = compareSalaries([role, target]);

    return {
      current_role: currentSalary
        ? {
            mean: currentSalary.salary.mean,
            min: currentSalary.salary.min,
            max: currentSalary.salary.max,
            percentile_in_category: currentSalary.category_benchmark.percentile_in_category,
          }
        : null,
      target_role: targetSalary
        ? {
            mean: targetSalary.salary.mean,
            min: targetSalary.salary.min,
            max: targetSalary.salary.max,
            percentile_in_category: targetSalary.category_benchmark.percentile_in_category,
          }
        : null,
      comparison: comparison?.summary || null,
      progression: targetSalary?.progression?.slice(0, 5) || [],
    };
  });

  // ── 7. Visa Assessment ───────────────────────────────────────────────────
  const visaAssessment = _safe("visa_assessment", () =>
    assessVisaEligibility({
      targetRole: target,
      skills: userSkills,
    })
  );

  // ── Pack-level summary ───────────────────────────────────────────────────
  const summary = _buildSummary({
    role: currentRole,
    target: targetRole,
    roadmap,
    skillsGap,
    resumeBlueprint,
    interviewPrep,
    salaryInsight,
    visaAssessment,
  });

  return {
    ok: true,
    pack_id: packId,
    generated_at: generatedAt,
    input: {
      role,
      target,
      skills: userSkills,
      years_exp: parsedYears ?? null,
    },
    summary,
    data: {
      roadmap,
      skills_gap: skillsGap,
      resume_blueprint: resumeBlueprint,
      linkedin_optimisation: linkedinOptimisation,
      interview_prep: interviewPrep,
      salary_insight: salaryInsight,
      visa_assessment: visaAssessment,
    },
  };
}

// ===========================================================================
// Internal helpers
// ===========================================================================

/**
 * Safely execute an engine call. If it throws, return an error envelope
 * instead of crashing the entire pack.
 */
function _safe(section, fn) {
  try {
    const result = fn();
    return result ?? { _error: `${section} returned no data` };
  } catch (err) {
    console.error(`[careerPack] ${section} failed:`, err.message);
    return { _error: `${section} failed: ${err.message}` };
  }
}

/**
 * Build a high-level summary across all pack sections.
 */
function _buildSummary({ role, target, roadmap, skillsGap, resumeBlueprint, interviewPrep, salaryInsight, visaAssessment }) {
  // Roadmap summary
  const roadmapReachable = roadmap?.reachable ?? false;
  const totalSteps = roadmap?.summary?.total_steps ?? null;
  const totalYears = roadmap?.summary?.total_estimated_years ?? null;

  // Skills readiness
  const readinessPct = skillsGap?.analysis?.readiness_pct ?? null;
  const missingCount = skillsGap?.analysis?.missing_count ?? null;

  // Resume ATS score
  const atsScore = resumeBlueprint?.ats_score?.score ?? null;
  const atsLabel = resumeBlueprint?.ats_score?.label ?? null;

  // Interview readiness
  const interviewReadiness = interviewPrep?.readiness?.score ?? null;

  // Salary delta
  const currentMean = salaryInsight?.current_role?.mean ?? null;
  const targetMean = salaryInsight?.target_role?.mean ?? null;
  const salaryGrowth = currentMean && targetMean ? targetMean - currentMean : null;
  const salaryGrowthPct = currentMean && salaryGrowth
    ? Math.round((salaryGrowth / currentMean) * 100)
    : null;

  // Visa
  const visaRoutes = visaAssessment?.eligible_routes_count ?? null;
  const visaRecommended = visaAssessment?.recommended_route ?? null;

  // Overall readiness composite (weighted average of available scores)
  const scores = [];
  if (readinessPct !== null) scores.push({ value: readinessPct, weight: 3 });
  if (atsScore !== null) scores.push({ value: atsScore, weight: 2 });
  if (interviewReadiness !== null) scores.push({ value: interviewReadiness, weight: 2 });

  const overallReadiness = scores.length > 0
    ? Math.round(
        scores.reduce((sum, s) => sum + s.value * s.weight, 0) /
        scores.reduce((sum, s) => sum + s.weight, 0)
      )
    : null;

  return {
    from: { slug: role.slug, title: role.title, category: role.category },
    to: { slug: target.slug, title: target.title, category: target.category },
    overall_readiness: overallReadiness,
    roadmap: {
      reachable: roadmapReachable,
      total_steps: totalSteps,
      estimated_years: totalYears,
    },
    skills: {
      readiness_pct: readinessPct,
      missing_count: missingCount,
    },
    resume: {
      ats_score: atsScore,
      ats_label: atsLabel,
    },
    interview: {
      readiness_score: interviewReadiness,
    },
    salary: {
      current_mean: currentMean,
      target_mean: targetMean,
      growth: salaryGrowth,
      growth_pct: salaryGrowthPct,
    },
    visa: {
      eligible_routes: visaRoutes,
      recommended_route: visaRecommended,
    },
  };
}
