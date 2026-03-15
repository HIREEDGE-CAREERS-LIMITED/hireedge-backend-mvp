// ============================================================================
// lib/copilot/responseComposer.js
// HireEdge — AI Career Intelligence Platform
//
// Composes a structured conversational reply from orchestrator insights,
// recommendations, and planned actions. Generates human-readable text
// deterministically (no LLM) while keeping the full structured data intact.
// ============================================================================

import { detectIntent } from "./intentDetector.js";
import { resolveContext, updateContext, checkReadiness, serializeContext } from "./conversationState.js";
import { orchestrate } from "./orchestrator.js";
import { generateRecommendations } from "./recommender.js";
import { planNextActions } from "./planner.js";

/**
 * Full Copilot pipeline: detect → resolve → orchestrate → recommend → plan → compose.
 *
 * @param {string} message  - User's raw message
 * @param {object} [context] - Incoming session context from the frontend
 * @returns {{ ok: boolean, data: { reply: string, intent: object, insights: object, recommendations: object[], next_actions: object[], context: object } }}
 */
export function composeChatResponse(message, context = {}) {
  // 1. Resolve context
  const ctx = resolveContext(context);

  // 2. Detect intent & extract entities
  const detected = detectIntent(message, ctx);

  // 3. Update context with new entities
  const updatedCtx = updateContext(ctx, detected.entities, detected.intent, _summariseTurn(detected));

  // 4. Check readiness
  const readiness = checkReadiness(updatedCtx, detected.intent);

  // 5. If not ready, compose a clarification response
  if (!readiness.ready) {
    const reply = _composeClarification(detected.intent, readiness.missing, updatedCtx);
    return {
      ok: true,
      data: {
        reply,
        intent: { name: detected.intent, confidence: detected.confidence },
        insights: {},
        recommendations: [],
        next_actions: _clarificationActions(readiness.missing),
        context: serializeContext(updatedCtx),
      },
    };
  }

  // 6. Orchestrate engine calls
  const { engines_called, insights } = orchestrate(detected.intent, detected.entities, updatedCtx);

  // 7. Generate recommendations
  const recommendations = generateRecommendations(detected.intent, insights, updatedCtx);

  // 8. Plan next actions
  const nextActions = planNextActions(detected.intent, insights, updatedCtx);

  // 9. Compose conversational reply
  const reply = _composeReply(detected.intent, insights, recommendations, updatedCtx);

  return {
    ok: true,
    data: {
      reply,
      intent: {
        name: detected.intent,
        confidence: detected.confidence,
        engines_called,
      },
      insights,
      recommendations,
      next_actions: nextActions,
      context: serializeContext(updatedCtx),
    },
  };
}

// ===========================================================================
// Reply composers per intent
// ===========================================================================

function _composeReply(intent, insights, recommendations, ctx) {
  switch (intent) {
    case "transition":
      return _composeTransition(insights, ctx);
    case "explore":
      return _composeExplore(insights, ctx);
    case "skills_gap":
      return _composeSkillsGap(insights, ctx);
    case "salary":
      return _composeSalary(insights, ctx);
    case "interview":
      return _composeInterview(insights, ctx);
    case "resume":
      return _composeResume(insights, ctx);
    case "linkedin":
      return _composeLinkedin(insights, ctx);
    case "visa":
      return _composeVisa(insights, ctx);
    case "career_pack":
      return _composeCareerPack(insights, ctx);
    case "role_info":
      return _composeRoleInfo(insights, ctx);
    case "compare":
      return _composeCompare(insights, ctx);
    default:
      return _composeGeneral(insights, ctx);
  }
}

function _composeTransition(ins, ctx) {
  const parts = [];
  const roadmap = ins.roadmap;
  const gap = ins.gap_explanation;
  const skillsGap = ins.skills_gap;
  const salary = ins.salary_comparison;

  if (roadmap?.reachable) {
    parts.push(`I've mapped a path from ${_title(ctx.role)} to ${_title(ctx.target)}. It's a ${roadmap.summary.total_steps}-step journey estimated at around ${roadmap.summary.total_estimated_years} years.`);
  } else if (roadmap?.reachable === false) {
    parts.push(`There's no standard career path from ${_title(ctx.role)} to ${_title(ctx.target)} in our dataset. This would be an unconventional move — but that doesn't mean it's impossible.`);
  }

  if (gap?.verdict) {
    const verdictLabels = { easy: "relatively straightforward", moderate: "a moderate challenge", hard: "a significant challenge", very_hard: "a very demanding transition", unreachable: "an unconventional path" };
    parts.push(`This transition is ${verdictLabels[gap.verdict] || gap.verdict} (difficulty score: ${gap.composite_score}/100).`);
  }

  if (skillsGap?.analysis) {
    const { readiness_pct, missing_count, matched_count } = skillsGap.analysis;
    parts.push(`Skills readiness: ${readiness_pct}% — you have ${matched_count} of the required skills and need ${missing_count} more.`);
  }

  if (salary?.summary?.spread) {
    const diff = (salary.summary.highest?.mean || 0) - (salary.summary.lowest?.mean || 0);
    if (diff > 0) {
      parts.push(`The salary uplift for this move is approximately £${diff.toLocaleString()}.`);
    }
  }

  return parts.join(" ") || `I can help you plan the move from ${_title(ctx.role)} to ${_title(ctx.target)}. Let me pull up the details.`;
}

function _composeExplore(ins, ctx) {
  const parts = [];
  const moves = ins.next_moves || [];

  if (moves.length > 0) {
    parts.push(`As a ${_title(ctx.role)}, you have ${moves.length} career progression option${moves.length !== 1 ? "s" : ""}.`);
    const top3 = moves.slice(0, 3).map((m) => `${m.title} (+${m.salary_growth_pct}% salary)`);
    parts.push(`Top options: ${top3.join(", ")}.`);
  }

  const salary = ins.salary;
  if (salary?.category_benchmark) {
    parts.push(`Your current role sits at the ${salary.category_benchmark.percentile_in_category}th percentile in ${salary.category_benchmark.category} salaries.`);
  }

  return parts.join(" ") || `Let me explore career options for you.`;
}

function _composeSkillsGap(ins, ctx) {
  const gap = ins.skills_gap;
  if (!gap) return "I need your skills list and a target role to analyse your skills gap.";

  const { readiness_pct, matched, missing } = gap.analysis;
  const target = gap.target;
  const parts = [`For ${target.title}, you're ${readiness_pct}% ready.`];

  if (matched.length > 0) {
    parts.push(`You already have: ${matched.slice(0, 5).join(", ")}${matched.length > 5 ? ` and ${matched.length - 5} more` : ""}.`);
  }
  if (missing.length > 0) {
    parts.push(`You need to learn: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}.`);
  }

  return parts.join(" ");
}

function _composeSalary(ins, ctx) {
  const parts = [];

  // Find all salary insights
  for (const [key, val] of Object.entries(ins)) {
    if (key.startsWith("salary_") && key !== "salary_comparison" && val?.salary) {
      parts.push(`${val.title}: £${val.salary.mean?.toLocaleString()} (range: £${val.salary.min?.toLocaleString()}–£${val.salary.max?.toLocaleString()}).`);
    }
  }

  const comp = ins.salary_comparison;
  if (comp?.summary?.spread) {
    parts.push(`The spread between these roles is £${comp.summary.spread.toLocaleString()}.`);
  }

  return parts.join(" ") || "Let me look up salary information for you.";
}

function _composeInterview(ins, ctx) {
  const prep = ins.interview_prep;
  if (!prep) return "I can help with interview preparation. Which role are you interviewing for?";

  const readiness = prep.readiness;
  const parts = [`Interview prep for ${prep.target_role.title} is ready.`];
  parts.push(`Your readiness score is ${readiness.score}/100 (${readiness.label.replace(/_/g, " ")}).`);
  parts.push(`I've prepared ${prep.competency_questions.length} competency questions, ${prep.technical_questions.length} technical questions, and ${prep.behavioural_questions.length} behavioural questions with STAR framework guidance.`);

  if (prep.salary_negotiation) {
    parts.push(`Salary negotiation range: £${prep.salary_negotiation.target_range.min.toLocaleString()}–£${prep.salary_negotiation.target_range.max.toLocaleString()}.`);
  }

  return parts.join(" ");
}

function _composeResume(ins, ctx) {
  const blueprint = ins.resume_blueprint;
  if (!blueprint) return "I can help optimise your resume. What role are you targeting?";

  const ats = blueprint.ats_score;
  return `Your ATS compatibility score for ${blueprint.target_role.title} is ${ats.score}/100 (${ats.label}). I've generated a full resume blueprint with keyword strategy, skills prioritisation, section ordering, and bullet templates. ${blueprint.keywords.matched.length} of your skills are keyword matches, and ${blueprint.keywords.missing_critical.length} critical keyword${blueprint.keywords.missing_critical.length !== 1 ? "s are" : " is"} missing.`;
}

function _composeLinkedin(ins, ctx) {
  const linkedin = ins.linkedin_optimisation;
  if (!linkedin) return "I can optimise your LinkedIn profile. Tell me your current role and skills.";

  return `Your LinkedIn profile strength score is ${linkedin.strength_score.score}/100 (${linkedin.strength_score.label}). I've generated ${linkedin.headlines.length} headline variants, a structured About section blueprint, and a skills prioritisation strategy. ${linkedin.skills_strategy.top_3.length > 0 ? `Pin these as your top 3: ${linkedin.skills_strategy.top_3.join(", ")}.` : ""}`;
}

function _composeVisa(ins, ctx) {
  const visa = ins.visa_assessment;
  if (!visa) return "I can assess UK visa eligibility. Which role are you considering?";

  const parts = [`Visa assessment for ${visa.target_role.title}:`];
  parts.push(`${visa.eligible_routes_count} visa route${visa.eligible_routes_count !== 1 ? "s" : ""} potentially available.`);

  if (visa.recommended_route) {
    parts.push(`Recommended route: ${visa.recommended_route}.`);
  }
  if (visa.salary_gap && !visa.salary_gap.meets_threshold) {
    parts.push(`Note: salary is £${visa.salary_gap.shortfall.toLocaleString()} below the Skilled Worker threshold.`);
  }

  parts.push("Important: this is indicative guidance only — always consult a licensed immigration adviser.");

  return parts.join(" ");
}

function _composeCareerPack(ins, ctx) {
  const pack = ins.career_pack;
  if (!pack?.ok) return "I need your current role, target role, and skills to build a full Career Pack.";

  const summary = pack.summary;
  return `Your Career Pack is ready. Overall readiness: ${summary.overall_readiness}%. The pack includes a ${summary.roadmap.total_steps}-step roadmap (~${summary.roadmap.estimated_years} years), skills gap analysis (${summary.skills.readiness_pct}% ready), ATS-optimised resume blueprint (score: ${summary.resume.ats_score}/100), interview prep, LinkedIn optimisation, salary intelligence (${summary.salary.growth_pct > 0 ? "+" : ""}${summary.salary.growth_pct}% salary growth), and UK visa assessment.`;
}

function _composeRoleInfo(ins, ctx) {
  const profile = ins.role_profile;
  if (!profile) return "I couldn't find that role. Could you try a different name?";

  const salary = ins.salary;
  const parts = [`${profile.title} is a ${profile.seniority}-level role in ${profile.category}.`];
  if (profile.experience_years) {
    parts.push(`Typically requires ${profile.experience_years.min}–${profile.experience_years.max} years of experience.`);
  }
  if (salary?.salary) {
    parts.push(`UK salary: £${salary.salary.mean.toLocaleString()} (range: £${salary.salary.min.toLocaleString()}–£${salary.salary.max.toLocaleString()}).`);
  }
  parts.push(`Core skills: ${(profile.skills_grouped?.core || []).join(", ") || profile.skills.slice(0, 5).join(", ")}.`);
  parts.push(`${profile.career_mobility.next_roles_count} progression path${profile.career_mobility.next_roles_count !== 1 ? "s" : ""} available.`);

  return parts.join(" ");
}

function _composeCompare(ins, ctx) {
  const comp = ins.comparison;
  if (!comp) return "I need two roles to compare. Please mention both role names.";

  const parts = [`Comparing ${comp.role_a.title} and ${comp.role_b.title}:`];
  parts.push(`Skills overlap: ${comp.skills_comparison.overlap_pct}%.`);
  if (comp.salary_comparison.difference_pct !== null) {
    parts.push(`Salary difference: ${comp.salary_comparison.difference_pct > 0 ? "+" : ""}${comp.salary_comparison.difference_pct}% (£${Math.abs(comp.salary_comparison.difference || 0).toLocaleString()}).`);
  }
  parts.push(`Seniority gap: ${Math.abs(comp.seniority_gap)} level${Math.abs(comp.seniority_gap) !== 1 ? "s" : ""}.`);
  parts.push(`Same domain: ${comp.same_category ? "yes" : "no"}.`);

  return parts.join(" ");
}

function _composeGeneral(ins, ctx) {
  if (ins.role_profile) {
    return `I found information about ${ins.role_profile.title}. What would you like to know — career paths, salary, skills requirements, or something else?`;
  }
  return "Hi! I'm your HireEdge Career Copilot. Tell me your current role, target role, and skills — I'll help you with career paths, skills gaps, resume optimisation, interview prep, salary insights, and more.";
}

// ===========================================================================
// Clarification helpers
// ===========================================================================

function _composeClarification(intent, missing, ctx) {
  const intentLabels = {
    transition: "plan your career transition",
    career_pack: "build your Career Pack",
    skills_gap: "analyse your skills gap",
    interview: "prepare your interview pack",
    resume: "optimise your resume",
    linkedin: "optimise your LinkedIn profile",
    salary: "check salary information",
    explore: "explore your career options",
    visa: "assess visa eligibility",
  };

  const task = intentLabels[intent] || "help you";
  const missingStr = missing.join(", ");

  return `I'd love to ${task}, but I need a bit more information. Could you share your ${missingStr}?`;
}

function _clarificationActions(missing) {
  return missing.map((field) => ({
    label: `Provide ${field}`,
    type: "question",
    prompt: _clarificationPrompt(field),
  }));
}

function _clarificationPrompt(field) {
  switch (field) {
    case "current role": return "My current role is [your role]";
    case "target role": return "I want to become a [target role]";
    case "skills": return "My skills include [skill1, skill2, skill3]";
    case "a role to analyse":
    case "a role to check salary for":
      return "Tell me about [role name]";
    default: return `My ${field} is [your answer]`;
  }
}

// ===========================================================================
// Utility
// ===========================================================================
function _title(slug) {
  if (!slug) return "your role";
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function _summariseTurn(detected) {
  return `[${detected.intent}] ${detected.raw.slice(0, 80)}`;
}
