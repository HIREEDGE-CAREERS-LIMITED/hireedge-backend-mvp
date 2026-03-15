// ============================================================================
// lib/tools/gapExplainerEngine.js
// HireEdge — AI Career Intelligence Platform
// Explains why a career transition is difficult or easy by combining
// skills gap, path distance, salary delta, seniority gap, and category shift.
// ============================================================================

import { getRoleBySlug } from "../dataset/roleIndex.js";
import { findShortestPath } from "../graph/careerPathEngine.js";
import { analyseRoleTransitionGap } from "../intelligence/skillsGapEngine.js";
import { getSalaryIntelligence } from "../intelligence/salaryEngine.js";

/**
 * @typedef {'easy' | 'moderate' | 'hard' | 'very_hard' | 'unreachable'} DifficultyVerdict
 */

/**
 * Generate a structured explanation of why a career transition between two
 * roles is easy, moderate, hard, or unreachable.
 *
 * Composes signals from: skillsGapEngine, careerPathEngine, salaryEngine,
 * and raw role metadata. Returns machine-readable factors plus a
 * human-readable narrative array.
 *
 * @param {string} fromSlug
 * @param {string} toSlug
 * @returns {object | null}  null only if one of the slugs is invalid
 */
export function explainTransitionGap(fromSlug, toSlug) {
  const fromRole = getRoleBySlug(fromSlug);
  const toRole = getRoleBySlug(toSlug);
  if (!fromRole || !toRole) return null;

  // ── 1. Gather raw signals ────────────────────────────────────────────────
  const skillsGap = analyseRoleTransitionGap(fromSlug, toSlug);
  const pathResult = findShortestPath(fromSlug, toSlug, { maxDepth: 8 });
  const fromSalary = getSalaryIntelligence(fromSlug);
  const toSalary = getSalaryIntelligence(toSlug);

  // ── 2. Compute individual factors ────────────────────────────────────────
  const factors = [];

  // Factor: Skills overlap
  const overlapPct = skillsGap?.skills_analysis?.overlap_pct ?? 0;
  const newNeeded = skillsGap?.skills_analysis?.new_needed_count ?? 0;
  const skillsFactor = _buildSkillsFactor(overlapPct, newNeeded, skillsGap);
  factors.push(skillsFactor);

  // Factor: Path distance
  const pathSteps = pathResult?.steps ?? null;
  const pathYears = pathResult?.totalYears ?? null;
  const pathFactor = _buildPathFactor(pathSteps, pathYears);
  factors.push(pathFactor);

  // Factor: Salary jump
  const fromMean = fromRole.salary_uk?.mean || 0;
  const toMean = toRole.salary_uk?.mean || 0;
  const salaryDelta = toMean - fromMean;
  const salaryDeltaPct = fromMean > 0 ? Math.round((salaryDelta / fromMean) * 100) : null;
  const salaryFactor = _buildSalaryFactor(salaryDelta, salaryDeltaPct);
  factors.push(salaryFactor);

  // Factor: Seniority gap
  const seniorityGap = (toRole.seniority_level ?? 0) - (fromRole.seniority_level ?? 0);
  const seniorityFactor = _buildSeniorityFactor(seniorityGap, fromRole.seniority, toRole.seniority);
  factors.push(seniorityFactor);

  // Factor: Category shift
  const sameCategory = fromRole.category === toRole.category;
  const categoryFactor = _buildCategoryFactor(sameCategory, fromRole.category, toRole.category);
  factors.push(categoryFactor);

  // Factor: Direct transition exists
  const directTransition = skillsGap?.transition_metadata || null;
  const directFactor = _buildDirectTransitionFactor(directTransition);
  factors.push(directFactor);

  // ── 3. Composite score & verdict ─────────────────────────────────────────
  const weights = factors.map((f) => f.weight);
  const compositeScore = Math.round(weights.reduce((a, b) => a + b, 0) / weights.length);
  const verdict = _verdictFromScore(compositeScore, pathResult);

  // ── 4. Assemble narrative ────────────────────────────────────────────────
  const narrative = factors.map((f) => f.explanation).filter(Boolean);

  // ── 5. Actionable recommendations ────────────────────────────────────────
  const recommendations = _buildRecommendations(factors, skillsGap, pathResult);

  return {
    from: {
      slug: fromRole.slug,
      title: fromRole.title,
      category: fromRole.category,
      seniority: fromRole.seniority,
      seniority_level: fromRole.seniority_level,
      salary_mean: fromMean || null,
    },
    to: {
      slug: toRole.slug,
      title: toRole.title,
      category: toRole.category,
      seniority: toRole.seniority,
      seniority_level: toRole.seniority_level,
      salary_mean: toMean || null,
    },
    verdict,
    composite_score: compositeScore,
    factors,
    narrative,
    recommendations,
    raw: {
      path: pathResult
        ? { steps: pathResult.steps, total_years: pathResult.totalYears, route: pathResult.path }
        : null,
      skills_gap: skillsGap?.skills_analysis || null,
      direct_transition: directTransition,
    },
  };
}

/**
 * Batch-explain multiple transitions from a single origin.
 *
 * @param {string} fromSlug
 * @param {string[]} targetSlugs
 * @returns {{ from: string, explanations: object[] }}
 */
export function explainMultipleGaps(fromSlug, targetSlugs) {
  const explanations = targetSlugs.map((toSlug) => {
    const result = explainTransitionGap(fromSlug, toSlug);
    if (!result) return { target: toSlug, error: "Role not found" };
    return {
      target: toSlug,
      target_title: result.to.title,
      verdict: result.verdict,
      composite_score: result.composite_score,
      narrative_summary: result.narrative[0] || null,
      key_blockers: result.factors
        .filter((f) => f.weight >= 70)
        .map((f) => f.label),
    };
  });

  explanations.sort((a, b) => (a.composite_score || 999) - (b.composite_score || 999));

  return { from: fromSlug, explanations };
}

// ===========================================================================
// Factor builders — each returns { label, weight (0-100), signal, explanation }
// weight: 0 = trivial, 100 = very hard
// ===========================================================================

function _buildSkillsFactor(overlapPct, newNeeded, skillsGap) {
  let weight;
  if (overlapPct >= 80) weight = 10;
  else if (overlapPct >= 60) weight = 30;
  else if (overlapPct >= 40) weight = 55;
  else if (overlapPct >= 20) weight = 75;
  else weight = 90;

  const newSkills = skillsGap?.skills_analysis?.new_skills_needed || [];

  let explanation;
  if (overlapPct >= 80) {
    explanation = `Strong skills overlap (${overlapPct}%) — most of your current skills transfer directly.`;
  } else if (overlapPct >= 50) {
    explanation = `Moderate skills overlap (${overlapPct}%) — you need to pick up ${newNeeded} new skill${newNeeded !== 1 ? "s" : ""}: ${newSkills.slice(0, 5).join(", ")}${newSkills.length > 5 ? ` and ${newSkills.length - 5} more` : ""}.`;
  } else {
    explanation = `Low skills overlap (${overlapPct}%) — significant upskilling required across ${newNeeded} skill${newNeeded !== 1 ? "s" : ""}: ${newSkills.slice(0, 5).join(", ")}${newSkills.length > 5 ? ` and ${newSkills.length - 5} more` : ""}.`;
  }

  return { label: "skills_overlap", weight, signal: { overlap_pct: overlapPct, new_needed: newNeeded }, explanation };
}

function _buildPathFactor(steps, years) {
  if (steps === null) {
    return {
      label: "path_distance",
      weight: 95,
      signal: { steps: null, years: null },
      explanation: "No known career path exists between these roles in the dataset — this is an unconventional transition.",
    };
  }

  let weight;
  if (steps <= 1) weight = 5;
  else if (steps <= 2) weight = 25;
  else if (steps <= 3) weight = 50;
  else weight = 70 + Math.min(steps - 3, 3) * 5;

  const yearStr = years ? `~${years} year${years !== 1 ? "s" : ""}` : "unknown timeline";
  const explanation = steps === 1
    ? `Direct transition — this is a single-step move (${yearStr}).`
    : `${steps}-step career path with an estimated timeline of ${yearStr}.`;

  return { label: "path_distance", weight, signal: { steps, years }, explanation };
}

function _buildSalaryFactor(delta, deltaPct) {
  let weight;
  if (deltaPct === null) weight = 30;
  else if (deltaPct <= 0) weight = 10;
  else if (deltaPct <= 20) weight = 20;
  else if (deltaPct <= 50) weight = 35;
  else weight = 50;

  let explanation;
  if (deltaPct === null) {
    explanation = "Salary comparison unavailable for one or both roles.";
  } else if (deltaPct <= 0) {
    explanation = `Lateral or downward salary move (${deltaPct >= 0 ? "+" : ""}${deltaPct}%) — no salary barrier.`;
  } else if (deltaPct <= 20) {
    explanation = `Modest salary increase (+${deltaPct}%, +£${delta.toLocaleString()}) — achievable within normal progression.`;
  } else {
    explanation = `Significant salary jump (+${deltaPct}%, +£${delta.toLocaleString()}) — typically requires substantial experience or skill uplift.`;
  }

  return { label: "salary_jump", weight, signal: { delta, delta_pct: deltaPct }, explanation };
}

function _buildSeniorityFactor(gap, fromSeniority, toSeniority) {
  const absGap = Math.abs(gap);
  let weight;
  if (absGap === 0) weight = 5;
  else if (absGap === 1) weight = 20;
  else if (absGap === 2) weight = 45;
  else weight = 60 + Math.min(absGap - 2, 3) * 10;

  let explanation;
  if (gap === 0) {
    explanation = `Same seniority band (${fromSeniority}) — no seniority barrier.`;
  } else if (gap > 0) {
    explanation = `Moving up ${absGap} seniority level${absGap !== 1 ? "s" : ""} (${fromSeniority} → ${toSeniority}) — requires demonstrated leadership and deeper expertise.`;
  } else {
    explanation = `Moving down ${absGap} seniority level${absGap !== 1 ? "s" : ""} (${fromSeniority} → ${toSeniority}) — a step-down, typically to pivot into a new domain.`;
  }

  return { label: "seniority_gap", weight, signal: { gap, from: fromSeniority, to: toSeniority }, explanation };
}

function _buildCategoryFactor(sameCategory, fromCat, toCat) {
  const weight = sameCategory ? 5 : 55;
  const explanation = sameCategory
    ? `Both roles are in ${fromCat} — staying within the same domain.`
    : `Cross-domain move from ${fromCat} to ${toCat} — requires adapting to a different professional context and potentially new industry knowledge.`;

  return { label: "category_shift", weight, signal: { same: sameCategory, from: fromCat, to: toCat }, explanation };
}

function _buildDirectTransitionFactor(transition) {
  if (transition) {
    const weight = transition.difficulty_score ?? 30;
    return {
      label: "direct_transition",
      weight,
      signal: transition,
      explanation: `A direct transition path exists with difficulty rated ${transition.difficulty_label || "unknown"} (score ${transition.difficulty_score ?? "N/A"}/100), estimated at ${transition.estimated_years ?? "?"} year${(transition.estimated_years ?? 0) !== 1 ? "s" : ""}.`,
    };
  }
  return {
    label: "direct_transition",
    weight: 50,
    signal: null,
    explanation: "No direct one-step transition exists between these roles — an intermediate role may be needed.",
  };
}

// ===========================================================================
// Verdict & recommendations
// ===========================================================================

/** @returns {DifficultyVerdict} */
function _verdictFromScore(score, pathResult) {
  if (!pathResult) return "unreachable";
  if (score <= 20) return "easy";
  if (score <= 40) return "moderate";
  if (score <= 65) return "hard";
  return "very_hard";
}

function _buildRecommendations(factors, skillsGap, pathResult) {
  const recs = [];

  const skillsFactor = factors.find((f) => f.label === "skills_overlap");
  if (skillsFactor && skillsFactor.weight >= 40) {
    const topMissing = (skillsGap?.skills_analysis?.new_skills_needed || []).slice(0, 3);
    if (topMissing.length) {
      recs.push({
        type: "upskill",
        priority: "high",
        message: `Focus on acquiring these skills first: ${topMissing.join(", ")}.`,
      });
    }
  }

  if (!pathResult) {
    recs.push({
      type: "find_bridge",
      priority: "high",
      message: "No direct or multi-step path found — look for a bridge role that connects both domains.",
    });
  } else if (pathResult.steps >= 3) {
    const intermediate = pathResult.path[1];
    recs.push({
      type: "intermediate_step",
      priority: "medium",
      message: `Consider targeting ${intermediate} as your first milestone — break this into smaller moves.`,
    });
  }

  const catFactor = factors.find((f) => f.label === "category_shift");
  if (catFactor && catFactor.weight >= 50) {
    recs.push({
      type: "domain_exposure",
      priority: "medium",
      message: `Gain exposure to ${catFactor.signal.to} through side projects, volunteering, or internal transfers before committing.`,
    });
  }

  const senFactor = factors.find((f) => f.label === "seniority_gap");
  if (senFactor && senFactor.signal.gap >= 2) {
    recs.push({
      type: "leadership_growth",
      priority: "medium",
      message: "This transition spans multiple seniority levels — seek mentorship and leadership opportunities in your current role.",
    });
  }

  return recs;
}
