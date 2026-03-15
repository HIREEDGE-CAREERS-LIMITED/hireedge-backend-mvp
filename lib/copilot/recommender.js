// ============================================================================
// lib/copilot/recommender.js
// HireEdge — AI Career Intelligence Platform
//
// Generates actionable, prioritised recommendations from orchestrated
// insights. Each recommendation has a type, priority, action, and reason.
// ============================================================================

import { getRoleBySlug } from "../dataset/roleIndex.js";

/**
 * @typedef {Object} Recommendation
 * @property {string} type       - Category: upskill | apply | explore | prepare | optimise | investigate
 * @property {'high'|'medium'|'low'} priority
 * @property {string} action     - What to do
 * @property {string} reason     - Why
 * @property {string} [engine]   - Which engine powers deeper exploration
 * @property {object} [data]     - Supporting data snippet
 */

/**
 * Generate recommendations based on intent and insights.
 *
 * @param {string} intent
 * @param {object} insights    - Output from orchestrator
 * @param {object} context     - Conversation context
 * @returns {Recommendation[]}
 */
export function generateRecommendations(intent, insights, context) {
  const recs = [];

  switch (intent) {
    case "transition":
      _transitionRecs(recs, insights, context);
      break;
    case "explore":
      _exploreRecs(recs, insights, context);
      break;
    case "skills_gap":
      _skillsGapRecs(recs, insights, context);
      break;
    case "salary":
      _salaryRecs(recs, insights, context);
      break;
    case "interview":
      _interviewRecs(recs, insights, context);
      break;
    case "resume":
      _resumeRecs(recs, insights, context);
      break;
    case "linkedin":
      _linkedinRecs(recs, insights, context);
      break;
    case "visa":
      _visaRecs(recs, insights, context);
      break;
    case "career_pack":
      _careerPackRecs(recs, insights, context);
      break;
    case "role_info":
      _roleInfoRecs(recs, insights, context);
      break;
    case "compare":
      _compareRecs(recs, insights, context);
      break;
    default:
      _generalRecs(recs, insights, context);
      break;
  }

  // Deduplicate by action text and sort by priority
  const seen = new Set();
  const unique = recs.filter((r) => {
    const key = r.action;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const order = { high: 0, medium: 1, low: 2 };
  unique.sort((a, b) => (order[a.priority] ?? 2) - (order[b.priority] ?? 2));

  return unique.slice(0, 8);
}

// ===========================================================================
// Recommendation builders per intent
// ===========================================================================

function _transitionRecs(recs, insights, ctx) {
  const gap = insights.gap_explanation;
  const skillsGap = insights.skills_gap;
  const roadmap = insights.roadmap;

  // Missing skills → upskill
  const missing = skillsGap?.analysis?.missing || [];
  if (missing.length > 0) {
    recs.push({
      type: "upskill",
      priority: "high",
      action: `Learn these skills first: ${missing.slice(0, 4).join(", ")}`,
      reason: `You're missing ${missing.length} skill${missing.length !== 1 ? "s" : ""} required for the target role (${skillsGap?.analysis?.readiness_pct ?? 0}% ready).`,
      engine: "skills-gap",
    });
  }

  // Roadmap intermediate step
  if (roadmap?.reachable && roadmap.summary?.total_steps >= 2) {
    const next = roadmap.steps?.[1];
    if (next) {
      recs.push({
        type: "explore",
        priority: "medium",
        action: `Target ${next.title} as your first milestone`,
        reason: `The full path is ${roadmap.summary.total_steps} steps over ~${roadmap.summary.total_estimated_years} years. Breaking it down makes it achievable.`,
        engine: "career-roadmap",
      });
    }
  }

  // Difficulty warning
  if (gap?.verdict === "hard" || gap?.verdict === "very_hard") {
    recs.push({
      type: "prepare",
      priority: "medium",
      action: "Consider getting a mentor in the target domain",
      reason: `This transition is rated "${gap.verdict}" — mentorship can significantly accelerate progress.`,
      engine: "career-gap-explainer",
    });
  }

  // Resume + interview prep
  if (ctx.target) {
    recs.push({
      type: "optimise",
      priority: "medium",
      action: "Generate a targeted resume and interview prep pack",
      reason: "Tailor your application materials to the specific requirements of the target role.",
      engine: "resume-optimiser",
    });
  }
}

function _exploreRecs(recs, insights, ctx) {
  const nextMoves = insights.next_moves || [];
  const profile = insights.talent_profile;

  // Top salary move
  const bestSalary = nextMoves[0];
  if (bestSalary) {
    recs.push({
      type: "explore",
      priority: "high",
      action: `Explore ${bestSalary.title} — highest salary growth (${bestSalary.salary_growth_pct}%)`,
      reason: "This is your top progression option by salary uplift.",
      engine: "career-roadmap",
      data: { slug: bestSalary.slug, salary_growth_pct: bestSalary.salary_growth_pct },
    });
  }

  // Easiest move
  const easiest = [...nextMoves].sort((a, b) => (a.difficulty_score || 0) - (b.difficulty_score || 0))[0];
  if (easiest && easiest.slug !== bestSalary?.slug) {
    recs.push({
      type: "explore",
      priority: "medium",
      action: `${easiest.title} is the easiest next step (difficulty: ${easiest.difficulty_label})`,
      reason: `Estimated ${easiest.estimated_years} year${easiest.estimated_years !== 1 ? "s" : ""} to transition.`,
      engine: "career-roadmap",
      data: { slug: easiest.slug },
    });
  }

  // Gaps in current role
  if (profile?.gaps?.total_gaps > 0) {
    recs.push({
      type: "upskill",
      priority: "medium",
      action: `Close ${profile.gaps.total_gaps} skill gap${profile.gaps.total_gaps !== 1 ? "s" : ""} in your current role`,
      reason: "Strengthening your current role makes you a stronger candidate for any next move.",
      engine: "skills-gap",
    });
  }
}

function _skillsGapRecs(recs, insights) {
  const gap = insights.skills_gap;
  if (!gap) return;

  const prioritised = gap.prioritised_learning_path || [];
  const high = prioritised.filter((p) => p.priority === "high").map((p) => p.skill);
  const medium = prioritised.filter((p) => p.priority === "medium").map((p) => p.skill);

  if (high.length > 0) {
    recs.push({
      type: "upskill",
      priority: "high",
      action: `Critical skills to learn: ${high.slice(0, 4).join(", ")}`,
      reason: "These are core competencies — without them you'll be screened out early.",
      engine: "skills-gap",
    });
  }
  if (medium.length > 0) {
    recs.push({
      type: "upskill",
      priority: "medium",
      action: `Technical skills to add: ${medium.slice(0, 4).join(", ")}`,
      reason: "These will strengthen your application and pass ATS filters.",
      engine: "skills-gap",
    });
  }
}

function _salaryRecs(recs, insights) {
  const comp = insights.salary_comparison;
  if (comp?.summary?.highest) {
    recs.push({
      type: "investigate",
      priority: "medium",
      action: `${comp.summary.highest.title} has the highest average salary (£${comp.summary.highest.mean?.toLocaleString()})`,
      reason: "Consider this if salary is your primary driver.",
      engine: "salary-intelligence",
    });
  }
}

function _interviewRecs(recs, insights) {
  const prep = insights.interview_prep;
  if (!prep) return;

  if (prep.weakness_strategy?.length > 0) {
    recs.push({
      type: "prepare",
      priority: "high",
      action: "Prepare reframes for your skill gaps before the interview",
      reason: `You have ${prep.weakness_strategy.length} potential weakness${prep.weakness_strategy.length !== 1 ? "es" : ""} to address.`,
      engine: "interview-prep",
    });
  }

  recs.push({
    type: "prepare",
    priority: "medium",
    action: `Write out ${prep.star_preparation?.stories_to_prepare?.length || 3} STAR stories using the preparation guide`,
    reason: "Prepared STAR stories are the single biggest predictor of interview success.",
    engine: "interview-prep",
  });
}

function _resumeRecs(recs, insights) {
  const blueprint = insights.resume_blueprint;
  if (!blueprint) return;

  const ats = blueprint.ats_score;
  if (ats?.label === "weak" || ats?.label === "needs_work") {
    recs.push({
      type: "upskill",
      priority: "high",
      action: `Your ATS score is ${ats.score}/100 — focus on adding missing keywords`,
      reason: `Critical missing keywords: ${(blueprint.keywords?.missing_critical || []).slice(0, 3).join(", ") || "see full report"}`,
      engine: "resume-optimiser",
    });
  }

  recs.push({
    type: "optimise",
    priority: "medium",
    action: "Follow the section order and bullet templates in the resume blueprint",
    reason: "ATS-optimised formatting significantly increases callback rates.",
    engine: "resume-optimiser",
  });
}

function _linkedinRecs(recs, insights) {
  const linkedin = insights.linkedin_optimisation;
  if (!linkedin) return;

  if (linkedin.strength_score?.label === "needs_work" || linkedin.strength_score?.label === "intermediate") {
    recs.push({
      type: "optimise",
      priority: "high",
      action: `Your LinkedIn profile strength is ${linkedin.strength_score.score}/100 — update your headline and skills`,
      reason: "A stronger profile gets up to 5x more recruiter views.",
      engine: "linkedin-optimiser",
    });
  }
}

function _visaRecs(recs, insights) {
  const visa = insights.visa_assessment;
  if (!visa) return;

  if (visa.recommended_route) {
    recs.push({
      type: "investigate",
      priority: "high",
      action: `Your best visa route appears to be: ${visa.recommended_route}`,
      reason: `${visa.eligible_routes_count} route${visa.eligible_routes_count !== 1 ? "s" : ""} potentially available. Consult an immigration adviser.`,
      engine: "visa-eligibility",
    });
  }

  if (visa.salary_gap && !visa.salary_gap.meets_threshold) {
    recs.push({
      type: "investigate",
      priority: "high",
      action: `Salary is £${visa.salary_gap.shortfall?.toLocaleString()} below the Skilled Worker threshold`,
      reason: "Negotiate a higher salary or consider higher-paying role variants.",
      engine: "visa-eligibility",
    });
  }
}

function _careerPackRecs(recs, insights) {
  const pack = insights.career_pack;
  if (!pack?.ok) return;

  recs.push({
    type: "prepare",
    priority: "high",
    action: "Your full Career Pack is ready — review each section and take action",
    reason: `Overall readiness: ${pack.summary?.overall_readiness ?? "N/A"}%. Start with the highest-priority gaps.`,
    engine: "career-pack",
  });
}

function _roleInfoRecs(recs, insights) {
  const profile = insights.role_profile;
  if (!profile) return;

  recs.push({
    type: "explore",
    priority: "medium",
    action: `${profile.title} has ${profile.career_mobility?.next_roles_count || 0} progression paths`,
    reason: "Explore specific transitions to see skills gaps and salary changes.",
    engine: "role-path",
  });
}

function _compareRecs(recs, insights) {
  const comp = insights.comparison;
  if (!comp) return;

  if (comp.salary_comparison?.difference_pct) {
    recs.push({
      type: "investigate",
      priority: "medium",
      action: `Salary difference: ${comp.salary_comparison.difference_pct > 0 ? "+" : ""}${comp.salary_comparison.difference_pct}%`,
      reason: `${comp.role_b?.title || "Role B"} pays ${comp.salary_comparison.difference_pct > 0 ? "more" : "less"} than ${comp.role_a?.title || "Role A"}.`,
      engine: "salary-intelligence",
    });
  }
}

function _generalRecs(recs, insights, ctx) {
  if (ctx.role) {
    recs.push({
      type: "explore",
      priority: "medium",
      action: "Tell me your target role and skills so I can give personalised guidance",
      reason: "The more context you share, the more specific my recommendations become.",
    });
  } else {
    recs.push({
      type: "explore",
      priority: "high",
      action: "Start by telling me your current role and key skills",
      reason: "I need this context to provide career intelligence.",
    });
  }
}
