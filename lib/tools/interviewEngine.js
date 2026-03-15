// ============================================================================
// lib/tools/interviewEngine.js
// HireEdge — AI Career Intelligence Platform
// Interview preparation: competency-based questions, STAR framework guidance,
// technical topic briefs, and salary negotiation intel.
// Reuses: roleIntelligenceEngine, skillsGapEngine, salaryEngine, careerPathEngine.
// ============================================================================

import { getRoleBySlug } from "../dataset/roleIndex.js";
import { getRoleProfile } from "../intelligence/roleIntelligenceEngine.js";
import { analyseSkillsGap, analyseRoleTransitionGap } from "../intelligence/skillsGapEngine.js";
import { getSalaryIntelligence } from "../intelligence/salaryEngine.js";
import { getPreviousMoves } from "../graph/careerPathEngine.js";

/**
 * Generate a comprehensive interview preparation pack for a target role.
 *
 * @param {object} input
 * @param {string}   input.targetRole    - Role being interviewed for
 * @param {string[]} input.skills        - User's current skills
 * @param {string}   [input.currentRole] - User's current role slug
 * @param {number}   [input.yearsExp]    - Years of experience
 * @returns {object | null}
 */
export function generateInterviewPrep(input) {
  const { targetRole, skills, currentRole, yearsExp } = input;

  const target = getRoleBySlug(targetRole);
  if (!target) return null;

  const userSkills = (skills || []).map((s) => s.trim()).filter(Boolean);
  const targetProfile = getRoleProfile(targetRole);
  const salary = getSalaryIntelligence(targetRole);
  const gapAnalysis = analyseSkillsGap(userSkills, targetRole);

  let transitionGap = null;
  if (currentRole && currentRole !== targetRole) {
    transitionGap = analyseRoleTransitionGap(currentRole, targetRole);
  }

  // ── 1. Competency questions ──────────────────────────────────────────────
  const competencyQuestions = _generateCompetencyQuestions(target, transitionGap);

  // ── 2. Technical questions ───────────────────────────────────────────────
  const technicalQuestions = _generateTechnicalQuestions(target, userSkills, gapAnalysis);

  // ── 3. Behavioural questions ─────────────────────────────────────────────
  const behaviouralQuestions = _generateBehaviouralQuestions(target, currentRole);

  // ── 4. STAR framework preparation ────────────────────────────────────────
  const starPrep = _generateSTARPrep(target, userSkills);

  // ── 5. Questions to ask interviewer ──────────────────────────────────────
  const questionsToAsk = _generateQuestionsToAsk(target, salary);

  // ── 6. Salary negotiation intel ──────────────────────────────────────────
  const salaryIntel = _buildSalaryIntel(salary, currentRole);

  // ── 7. Weakness handling ─────────────────────────────────────────────────
  const weaknessStrategy = _buildWeaknessStrategy(gapAnalysis, transitionGap, currentRole, target);

  // ── 8. Readiness assessment ──────────────────────────────────────────────
  const readiness = _assessReadiness(gapAnalysis, transitionGap, yearsExp, target);

  return {
    target_role: {
      slug: target.slug,
      title: target.title,
      category: target.category,
      seniority: target.seniority,
      seniority_level: target.seniority_level,
      industries: target.industries || [],
    },
    readiness,
    competency_questions: competencyQuestions,
    technical_questions: technicalQuestions,
    behavioural_questions: behaviouralQuestions,
    star_preparation: starPrep,
    questions_to_ask: questionsToAsk,
    salary_negotiation: salaryIntel,
    weakness_strategy: weaknessStrategy,
  };
}

// ===========================================================================
// Question generators
// ===========================================================================

function _generateCompetencyQuestions(target, transitionGap) {
  const grouped = target.skills_grouped || {};
  const questions = [];

  // Core skill questions
  for (const skill of (grouped.core || []).slice(0, 3)) {
    questions.push({
      category: "core_competency",
      skill,
      question: `Can you describe a project where ${skill} was central to your approach? What was the outcome?`,
      why_asked: `${skill} is a core competency for ${target.title}. Interviewers validate hands-on depth here.`,
      preparation_tip: `Prepare a specific example with measurable results. Quantify impact: percentages, revenue, time saved.`,
    });
  }

  // Seniority-appropriate questions
  const level = target.seniority_level ?? 3;
  if (level >= 5) {
    questions.push({
      category: "leadership",
      skill: "Strategic Thinking",
      question: "Tell me about a time you set the strategic direction for a team or initiative. How did you align stakeholders?",
      why_asked: `${target.seniority}-level roles require demonstrated strategic leadership.`,
      preparation_tip: "Use a STAR story showing vision, stakeholder management, and measurable strategic outcome.",
    });
    questions.push({
      category: "leadership",
      skill: "Team Management",
      question: "Describe how you've built or scaled a team. What was your hiring philosophy and how did you develop team members?",
      why_asked: "Senior roles are evaluated on their ability to multiply impact through others.",
      preparation_tip: "Include team size, retention, and development outcomes.",
    });
  }

  if (level >= 4) {
    questions.push({
      category: "ownership",
      skill: "Decision Making",
      question: "Tell me about a difficult technical or business decision you made with incomplete information. What was the result?",
      why_asked: `${target.seniority} professionals are expected to operate with ambiguity.`,
      preparation_tip: "Show your reasoning framework, stakeholders consulted, and how you managed risk.",
    });
  }

  // Cross-domain question if transitioning categories
  if (transitionGap && transitionGap.from.category !== transitionGap.to.category) {
    questions.push({
      category: "transition",
      skill: "Adaptability",
      question: `You're moving from ${transitionGap.from.category} into ${transitionGap.to.category}. What makes you confident you can succeed in this new domain?`,
      why_asked: "Interviewers will directly probe your career pivot motivation and readiness.",
      preparation_tip: `Highlight the ${transitionGap.skills_analysis.shared_count} overlapping skills and any cross-domain exposure.`,
    });
  }

  return questions;
}

function _generateTechnicalQuestions(target, userSkills, gapAnalysis) {
  const grouped = target.skills_grouped || {};
  const techSkills = grouped.technical || [];
  const userLower = new Set(userSkills.map((s) => s.toLowerCase()));
  const questions = [];

  // Questions for technical skills the user HAS
  const matchedTech = techSkills.filter((s) => userLower.has(s.toLowerCase()));
  for (const skill of matchedTech.slice(0, 4)) {
    questions.push({
      category: "technical_depth",
      skill,
      question: `Walk me through how you've used ${skill} in a production environment. What challenges did you face?`,
      you_have_this: true,
      preparation_tip: `You have ${skill} — prepare a deep-dive example. Interviewers will probe beyond surface familiarity.`,
    });
  }

  // Questions for technical skills the user is MISSING
  const missingTech = techSkills.filter((s) => !userLower.has(s.toLowerCase()));
  for (const skill of missingTech.slice(0, 3)) {
    questions.push({
      category: "technical_gap",
      skill,
      question: `This role requires ${skill}. What's your experience with it, or how would you approach getting up to speed?`,
      you_have_this: false,
      preparation_tip: `You don't list ${skill}. Be honest, show awareness, and present a concrete learning plan. Mention adjacent skills that transfer.`,
    });
  }

  return questions;
}

function _generateBehaviouralQuestions(target, currentRole) {
  const questions = [];
  const current = currentRole ? getRoleBySlug(currentRole) : null;

  questions.push({
    category: "problem_solving",
    question: "Describe the most complex problem you've solved in the last year. How did you break it down?",
    why_asked: "Tests analytical thinking and structured problem-solving, universal to all roles.",
    framework: "STAR",
  });

  questions.push({
    category: "collaboration",
    question: "Tell me about a time you had to work with a difficult stakeholder. How did you handle it?",
    why_asked: "Evaluates interpersonal skills and conflict resolution.",
    framework: "STAR",
  });

  questions.push({
    category: "failure_resilience",
    question: "Tell me about a project that didn't go as planned. What happened and what did you learn?",
    why_asked: "Tests self-awareness, accountability, and growth mindset.",
    framework: "STAR",
  });

  questions.push({
    category: "motivation",
    question: `Why ${target.title}? What specifically draws you to this role and domain?`,
    why_asked: "Assesses genuine interest and career intentionality.",
    framework: "Direct answer with supporting evidence",
  });

  if (current && current.slug !== target.slug) {
    questions.push({
      category: "career_narrative",
      question: `Walk me through your career journey from ${current.title} to wanting to be a ${target.title}.`,
      why_asked: "Tests whether you have a coherent, intentional career narrative.",
      framework: "Chronological story arc: where you started, pivotal moments, why this role is the next logical step",
    });
  }

  return questions;
}

function _generateSTARPrep(target, userSkills) {
  const grouped = target.skills_grouped || {};
  const coreSkills = (grouped.core || []).slice(0, 3);
  const userLower = new Set(userSkills.map((s) => s.toLowerCase()));

  const stories = coreSkills.map((skill) => {
    const hasSkill = userLower.has(skill.toLowerCase());
    return {
      skill,
      you_have_this: hasSkill,
      situation: `Set the scene: What was the business context? What team/project? What was at stake?`,
      task: `What was your specific responsibility involving ${skill}?`,
      action: `What did you do? Be specific about tools, methods, and decisions. Mention ${skill} explicitly.`,
      result: `What was the quantified outcome? Revenue impact, efficiency gains, error reduction, etc.`,
      preparation_note: hasSkill
        ? `You have ${skill} — draft a concrete 2-minute story with real numbers.`
        : `You don't list ${skill} — prepare a transferable example from an adjacent skill, or describe self-directed learning.`,
    };
  });

  return {
    framework_summary: "Situation → Task → Action → Result. Each story should be 2 minutes, end with numbers.",
    recommended_story_count: "Prepare 5–6 STAR stories that collectively cover the role's core and behavioural competencies.",
    stories_to_prepare: stories,
    universal_stories: [
      { theme: "Leadership / Influence", note: "A time you led without formal authority or influenced a decision." },
      { theme: "Failure / Learning", note: "A genuine setback and what you changed as a result." },
      { theme: "Impact / Achievement", note: "Your proudest professional accomplishment with measurable results." },
    ],
  };
}

function _generateQuestionsToAsk(target, salary) {
  const questions = [
    {
      category: "role_clarity",
      question: "What does success look like in the first 90 days for this role?",
      rationale: "Shows you're already thinking about delivering value.",
    },
    {
      category: "team_dynamics",
      question: "Can you tell me about the team I'd be working with and how this role fits into the wider structure?",
      rationale: "Demonstrates interest in collaboration, reveals reporting lines.",
    },
    {
      category: "growth",
      question: "What career progression paths have previous people in this role taken?",
      rationale: "Shows long-term thinking, reveals internal mobility culture.",
    },
    {
      category: "challenges",
      question: `What are the biggest challenges the ${target.category} team is facing right now?`,
      rationale: "Positions you as a problem-solver, reveals real pain points.",
    },
    {
      category: "culture",
      question: "How does the team approach learning and professional development?",
      rationale: "Signals growth mindset without being prescriptive.",
    },
  ];

  if (target.seniority_level >= 5) {
    questions.push({
      category: "strategy",
      question: "Where do you see this function headed over the next 2–3 years?",
      rationale: "Senior roles require strategic alignment — this shows you think at that level.",
    });
  }

  return questions;
}

function _buildSalaryIntel(salary, currentRole) {
  if (!salary) return null;

  const current = currentRole ? getSalaryIntelligence(currentRole) : null;
  const currentMean = current?.salary?.mean || null;

  return {
    target_range: {
      min: salary.salary.min,
      max: salary.salary.max,
      mean: salary.salary.mean,
    },
    category_benchmark: {
      category_mean: salary.category_benchmark.category_mean,
      percentile: salary.category_benchmark.percentile_in_category,
    },
    negotiation_tips: [
      `The market range for this role is £${salary.salary.min.toLocaleString()}–£${salary.salary.max.toLocaleString()}, with a mean of £${salary.salary.mean.toLocaleString()}.`,
      `This role sits at the ${salary.category_benchmark.percentile_in_category}th percentile within ${salary.category_benchmark.category}.`,
      currentMean
        ? `Your current role averages £${currentMean.toLocaleString()} — this represents a ${salary.salary.mean > currentMean ? "+" : ""}${Math.round(((salary.salary.mean - currentMean) / currentMean) * 100)}% change.`
        : "Research your current market rate to calibrate your ask.",
      "Anchor high within the range and negotiate based on your unique skill overlap.",
      "Never disclose your current salary first — ask for the budgeted range.",
    ],
    recommended_ask: {
      conservative: Math.round(salary.salary.mean * 0.95),
      target: salary.salary.mean,
      ambitious: Math.round(salary.salary.mean * 1.1),
    },
  };
}

function _buildWeaknessStrategy(gapAnalysis, transitionGap, currentRole, target) {
  const strategies = [];

  // Address missing skills proactively
  const missingSkills = gapAnalysis?.analysis?.missing || [];
  if (missingSkills.length > 0) {
    const topMissing = missingSkills.slice(0, 3);
    strategies.push({
      weakness: `Missing ${topMissing.join(", ")}`,
      reframe: `"I haven't worked extensively with ${topMissing[0]} yet, but I've been ${topMissing.length === 1 ? "actively learning it" : "actively building these skills"} through [course/side project/self-study]. My experience with [adjacent skill] gives me a strong foundation to ramp up quickly."`,
      principle: "Acknowledge → Show action → Bridge with existing strength",
    });
  }

  // Address career pivot
  if (transitionGap && transitionGap.from.category !== transitionGap.to.category) {
    strategies.push({
      weakness: `Career pivot from ${transitionGap.from.category} to ${transitionGap.to.category}`,
      reframe: `"My background in ${transitionGap.from.category} gives me a unique perspective. I bring ${transitionGap.skills_analysis.shared_count} directly transferable skills and a fresh viewpoint that internal candidates may not have."`,
      principle: "Turn the pivot into a differentiator, not a liability",
    });
  }

  // Address seniority gap
  const current = currentRole ? getRoleBySlug(currentRole) : null;
  if (current && (target.seniority_level ?? 0) > (current.seniority_level ?? 0) + 1) {
    strategies.push({
      weakness: `Seniority step-up from ${current.seniority} to ${target.seniority}`,
      reframe: `"While my title has been ${current.title}, I've consistently operated above my level — [give example of leadership, strategic work, or expanded scope]."`,
      principle: "Demonstrate you're already performing at the target level",
    });
  }

  return strategies;
}

function _assessReadiness(gapAnalysis, transitionGap, yearsExp, target) {
  let score = 0;

  // Skills readiness (50 points)
  const readinessPct = gapAnalysis?.analysis?.readiness_pct ?? 0;
  score += Math.round(readinessPct * 0.5);

  // Experience alignment (25 points)
  if (yearsExp && target.experience_years) {
    const { min, max } = target.experience_years;
    if (yearsExp >= min && yearsExp <= max) score += 25;
    else if (yearsExp >= min - 1) score += 18;
    else if (yearsExp >= min - 2) score += 10;
    else score += 5;
  } else {
    score += 12;
  }

  // Domain alignment (25 points)
  if (!transitionGap || transitionGap.from.category === transitionGap.to.category) {
    score += 25;
  } else {
    const overlap = transitionGap.skills_analysis.overlap_pct;
    score += Math.round(overlap * 0.25);
  }

  score = Math.min(100, score);

  let label;
  if (score >= 80) label = "well_prepared";
  else if (score >= 60) label = "moderately_prepared";
  else if (score >= 40) label = "some_gaps";
  else label = "significant_preparation_needed";

  return { score, label };
}
