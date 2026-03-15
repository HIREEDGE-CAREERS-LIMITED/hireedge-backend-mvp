// ============================================================================
// lib/tools/linkedinEngine.js
// HireEdge — AI Career Intelligence Platform
// LinkedIn profile optimisation: headline variants, about section structure,
// skills ordering, keyword strategy, and visibility scoring.
// Reuses: roleIntelligenceEngine, skillsGapEngine, salaryEngine, careerPathEngine.
// ============================================================================

import { getRoleBySlug } from "../dataset/roleIndex.js";
import { getRoleProfile } from "../intelligence/roleIntelligenceEngine.js";
import { analyseSkillsGap } from "../intelligence/skillsGapEngine.js";
import { getSalaryIntelligence } from "../intelligence/salaryEngine.js";
import { getNextMoves } from "../graph/careerPathEngine.js";

/**
 * Generate a full LinkedIn profile optimisation plan.
 *
 * @param {object} input
 * @param {string}   input.currentRole  - Current role slug
 * @param {string[]} input.skills       - User's current skills
 * @param {number}   [input.yearsExp]   - Years of experience
 * @param {string}   [input.targetRole] - Aspirational role slug (optional)
 * @param {string}   [input.industry]   - Primary industry focus (optional)
 * @returns {object | null}
 */
export function generateLinkedInOptimisation(input) {
  const { currentRole, skills, yearsExp, targetRole, industry } = input;

  const role = getRoleBySlug(currentRole);
  if (!role) return null;

  const userSkills = (skills || []).map((s) => s.trim()).filter(Boolean);
  const profile = getRoleProfile(currentRole);
  const salary = getSalaryIntelligence(currentRole);
  const targetData = targetRole ? getRoleBySlug(targetRole) : null;

  // ── 1. Headline variants ─────────────────────────────────────────────────
  const headlines = _generateHeadlines(role, userSkills, yearsExp, targetData, industry);

  // ── 2. About section blueprint ───────────────────────────────────────────
  const aboutSection = _generateAboutBlueprint(role, userSkills, yearsExp, targetData, industry);

  // ── 3. Skills ordering ───────────────────────────────────────────────────
  const skillsStrategy = _buildSkillsStrategy(role, userSkills, targetData);

  // ── 4. Keyword strategy ──────────────────────────────────────────────────
  const keywordStrategy = _buildKeywordStrategy(role, userSkills, targetData);

  // ── 5. Experience section tips ───────────────────────────────────────────
  const experienceTips = _buildExperienceTips(role, targetData);

  // ── 6. Featured section recommendations ──────────────────────────────────
  const featuredSection = _buildFeaturedRecommendations(role, targetData);

  // ── 7. Profile strength score ────────────────────────────────────────────
  const strengthScore = _computeProfileStrength(userSkills, role, yearsExp, targetData);

  // ── 8. Career mobility context ───────────────────────────────────────────
  const nextMoves = getNextMoves(currentRole, { sortBy: "salary" }).slice(0, 4);
  const careerContext = {
    next_moves_count: profile?.career_mobility?.next_roles_count || 0,
    top_next_moves: nextMoves.map((m) => ({
      slug: m.slug,
      title: m.title,
      salary_growth_pct: m.salary_growth_pct,
    })),
    salary_percentile: salary?.category_benchmark?.percentile_in_category ?? null,
  };

  return {
    current_role: {
      slug: role.slug,
      title: role.title,
      category: role.category,
      seniority: role.seniority,
    },
    target_role: targetData
      ? { slug: targetData.slug, title: targetData.title, category: targetData.category }
      : null,
    strength_score: strengthScore,
    headlines,
    about_section: aboutSection,
    skills_strategy: skillsStrategy,
    keyword_strategy: keywordStrategy,
    experience_tips: experienceTips,
    featured_section: featuredSection,
    career_context: careerContext,
  };
}

// ===========================================================================
// Internal builders
// ===========================================================================

function _generateHeadlines(role, userSkills, yearsExp, target, industry) {
  const grouped = role.skills_grouped || {};
  const coreSkills = (grouped.core || []).slice(0, 2);
  const techSkills = (grouped.technical || []).filter((s) =>
    userSkills.some((u) => u.toLowerCase() === s.toLowerCase())
  ).slice(0, 2);

  const expPrefix = yearsExp ? `${yearsExp}+ yrs` : "";
  const ind = industry || (role.industries || [])[0] || "";
  const indStr = ind ? ` in ${_capitalise(ind)}` : "";

  const variants = [];

  // Pattern 1: Title + Domain + Specialty
  variants.push({
    style: "authority",
    headline: `${role.title} | ${role.category}${coreSkills.length ? ` | ${coreSkills.join(" & ")}` : ""}`,
    rationale: "Positions you as an established specialist. Strong for inbound recruiter searches.",
  });

  // Pattern 2: Impact-led
  variants.push({
    style: "impact",
    headline: `${role.title}${indStr} — Driving results through ${techSkills.length ? techSkills.join(", ") : "data-driven insight"}`,
    rationale: "Leads with business value. Works well for client-facing or commercial roles.",
  });

  // Pattern 3: Experience + breadth
  if (expPrefix) {
    variants.push({
      style: "experienced",
      headline: `${role.title} | ${expPrefix} across ${(role.industries || []).slice(0, 3).join(", ") || role.category}`,
      rationale: "Emphasises depth of experience. Good for senior roles.",
    });
  }

  // Pattern 4: Aspirational (if targeting a new role)
  if (target) {
    variants.push({
      style: "aspirational",
      headline: `${role.title} → ${target.title} | ${coreSkills.length ? coreSkills.join(", ") + " | " : ""}Open to new opportunities`,
      rationale: "Signals career direction. Use only if actively seeking the target role.",
    });
  }

  // Pattern 5: Search-optimised (keyword-dense)
  const topKeywords = [...coreSkills, ...techSkills].slice(0, 4);
  if (topKeywords.length >= 2) {
    variants.push({
      style: "seo_optimised",
      headline: `${role.title} | ${topKeywords.join(" | ")}${indStr}`,
      rationale: "Maximum keyword density for LinkedIn search visibility. Best for competitive markets.",
    });
  }

  return variants;
}

function _generateAboutBlueprint(role, userSkills, yearsExp, target, industry) {
  const paragraphs = [];

  // Para 1: Hook
  paragraphs.push({
    label: "hook",
    guidance: `Open with a compelling one-liner. Example: "${role.title} with ${yearsExp || "several"} years of experience turning ${(role.skills_grouped?.core || ["complex challenges"])[0].toLowerCase()} into actionable outcomes${industry ? ` across ${_capitalise(industry)}` : ""}."`,
    length: "1–2 sentences",
  });

  // Para 2: Core expertise
  const grouped = role.skills_grouped || {};
  paragraphs.push({
    label: "expertise",
    guidance: `Detail your core competencies: ${(grouped.core || []).join(", ")}. Weave in technical tools: ${(grouped.technical || []).slice(0, 4).join(", ")}. Use specific numbers where possible.`,
    length: "3–4 sentences",
  });

  // Para 3: Impact / achievements
  paragraphs.push({
    label: "impact",
    guidance: "Share 2–3 quantified achievements. Pattern: 'Led/Built/Improved [what] resulting in [metric].' This section drives engagement.",
    length: "2–3 sentences",
  });

  // Para 4: Direction
  if (target) {
    paragraphs.push({
      label: "direction",
      guidance: `Signal your career trajectory toward ${target.title}. Mention skills you're actively developing: ${(target.skills_grouped?.core || []).slice(0, 3).join(", ") || "relevant skills"}.`,
      length: "1–2 sentences",
    });
  }

  // Para 5: CTA
  paragraphs.push({
    label: "call_to_action",
    guidance: "Close with what you're open to: collaborations, opportunities, conversations. Example: 'Open to connecting with teams working on [area].'",
    length: "1 sentence",
  });

  return {
    recommended_length: "1,500–2,000 characters",
    paragraphs,
    formatting_tips: [
      "Use line breaks between paragraphs — walls of text get skipped",
      "Front-load keywords in the first 3 lines (this is the preview fold)",
      "Avoid buzzwords without substance: 'passionate', 'synergy', 'results-oriented'",
      "Include 1–2 relevant hashtags at the end to boost discoverability",
    ],
  };
}

function _buildSkillsStrategy(role, userSkills, target) {
  const userLower = new Set(userSkills.map((s) => s.toLowerCase()));
  const grouped = role.skills_grouped || {};

  // Skills that match the current role
  const matchedCore = (grouped.core || []).filter((s) => userLower.has(s.toLowerCase()));
  const matchedTech = (grouped.technical || []).filter((s) => userLower.has(s.toLowerCase()));
  const matchedSoft = (grouped.soft || []).filter((s) => userLower.has(s.toLowerCase()));

  // Priority order for LinkedIn: core first, then technical, then soft
  const prioritised = [...matchedCore, ...matchedTech, ...matchedSoft];

  // If targeting a different role, interleave target-relevant skills
  let targetRelevant = [];
  if (target) {
    const targetSkills = target.skills || [];
    targetRelevant = targetSkills.filter((s) => userLower.has(s.toLowerCase()) && !prioritised.map((p) => p.toLowerCase()).includes(s.toLowerCase()));
  }

  return {
    top_3: prioritised.slice(0, 3),
    recommended_order: [...prioritised, ...targetRelevant].slice(0, 50),
    total_linkedin_slots: 50,
    used_slots: Math.min(prioritised.length + targetRelevant.length, 50),
    advice: "Pin your top 3 skills — LinkedIn prominently features these. Get endorsements for all three.",
    endorsement_priority: prioritised.slice(0, 5).map((s) => ({
      skill: s,
      note: "Request endorsements from colleagues who've seen this skill in action.",
    })),
  };
}

function _buildKeywordStrategy(role, userSkills, target) {
  const primaryKeywords = [
    role.title,
    ...(role.skills_grouped?.core || []),
    ...(role.skills_grouped?.technical || []).slice(0, 5),
    role.category,
  ];

  const industryKeywords = (role.industries || []).map(_capitalise);

  const targetKeywords = target
    ? [target.title, ...(target.skills_grouped?.core || []).filter((s) => !primaryKeywords.includes(s))]
    : [];

  return {
    primary: [...new Set(primaryKeywords)],
    industry: industryKeywords,
    aspirational: targetKeywords,
    placement_guide: {
      headline: "Include 2–3 primary keywords",
      about: "Naturally weave primary + industry keywords into paragraphs 1 and 2",
      experience: "Mirror primary keywords in bullet points",
      skills: "Add all primary keywords as skills",
    },
  };
}

function _buildExperienceTips(role, target) {
  const tips = [
    {
      area: "current_role_bullets",
      advice: `Write 4–6 achievement bullets. Lead each with a strong verb. Include skills from: ${(role.skills || []).slice(0, 5).join(", ")}.`,
    },
    {
      area: "media_attachments",
      advice: "Attach presentations, reports, dashboards, or published articles to each role. Visual proof outperforms text.",
    },
    {
      area: "titles_and_descriptions",
      advice: "Match your title to standard industry terminology. If your company uses a non-standard title, add the standard equivalent in parentheses.",
    },
  ];

  if (target && target.category !== role.category) {
    tips.push({
      area: "bridge_roles",
      advice: `For your career pivot toward ${target.title}, highlight any cross-functional work or projects relevant to ${target.category}.`,
    });
  }

  return tips;
}

function _buildFeaturedRecommendations(role, target) {
  const recommendations = [
    {
      type: "portfolio_piece",
      advice: `Showcase a project demonstrating ${(role.skills_grouped?.core || ["your core competency"])[0]}. Link to a live demo, slide deck, or case study.`,
    },
    {
      type: "thought_leadership",
      advice: `Write or share a LinkedIn post about trends in ${role.category}. Original content dramatically boosts profile visibility.`,
    },
    {
      type: "certification",
      advice: "Feature any relevant certifications. LinkedIn gives these prominent placement in search results.",
    },
  ];

  if (target) {
    recommendations.push({
      type: "transition_signal",
      advice: `Share content related to ${target.category} to signal your career direction to recruiters and the algorithm.`,
    });
  }

  return recommendations;
}

function _computeProfileStrength(userSkills, role, yearsExp, target) {
  let score = 0;
  const breakdown = {};

  // Skills coverage (40 points)
  const roleSkills = (role.skills || []).map((s) => s.toLowerCase());
  const userLower = new Set(userSkills.map((s) => s.toLowerCase()));
  const matched = roleSkills.filter((s) => userLower.has(s)).length;
  const skillScore = Math.round((matched / Math.max(roleSkills.length, 1)) * 40);
  score += skillScore;
  breakdown.skills_coverage = skillScore;

  // Experience depth (20 points)
  const expMin = role.experience_years?.min || 0;
  const expScore = yearsExp ? Math.min(20, Math.round((yearsExp / Math.max(expMin, 1)) * 15)) : 5;
  score += expScore;
  breakdown.experience_depth = expScore;

  // Skill volume (15 points)
  const volScore = Math.min(15, Math.round(userSkills.length * 1.5));
  score += volScore;
  breakdown.skill_volume = volScore;

  // Core skill presence (15 points)
  const coreSkills = (role.skills_grouped?.core || []).map((s) => s.toLowerCase());
  const coreMatched = coreSkills.filter((s) => userLower.has(s)).length;
  const coreScore = Math.round((coreMatched / Math.max(coreSkills.length, 1)) * 15);
  score += coreScore;
  breakdown.core_skill_presence = coreScore;

  // Target alignment bonus (10 points)
  if (target) {
    const targetGap = analyseSkillsGap(userSkills, target.slug);
    const targetScore = targetGap ? Math.round((targetGap.analysis.readiness_pct / 100) * 10) : 0;
    score += targetScore;
    breakdown.target_alignment = targetScore;
  } else {
    score += 5;
    breakdown.target_alignment = 5;
  }

  score = Math.min(100, score);

  let label;
  if (score >= 80) label = "all_star";
  else if (score >= 60) label = "strong";
  else if (score >= 40) label = "intermediate";
  else label = "needs_work";

  return { score, label, breakdown };
}

function _capitalise(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}
