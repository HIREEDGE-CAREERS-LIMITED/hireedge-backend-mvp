// ============================================================================
// lib/tools/resumeEngine.js
// HireEdge — AI Career Intelligence Platform
// Generates ATS-optimised resume structure: keyword alignment, section
// recommendations, skills prioritisation, and role-targeted bullet guidance.
// Reuses: roleIntelligenceEngine, skillsGapEngine, salaryEngine.
// ============================================================================

import { getRoleBySlug } from "../dataset/roleIndex.js";
import { getRoleProfile } from "../intelligence/roleIntelligenceEngine.js";
import { analyseSkillsGap, analyseRoleTransitionGap } from "../intelligence/skillsGapEngine.js";
import { getSalaryIntelligence } from "../intelligence/salaryEngine.js";
import { getNextMoves, getPreviousMoves } from "../graph/careerPathEngine.js";

/**
 * Generate an ATS-optimised resume blueprint for a user targeting a specific role.
 *
 * @param {object} input
 * @param {string}   input.targetRole       - Slug of the role being applied for
 * @param {string[]} input.skills           - User's current skills
 * @param {string}   [input.currentRole]    - User's current role slug (optional)
 * @param {number}   [input.yearsExp]       - Years of experience (optional)
 * @param {string[]} [input.pastRoles]      - Slugs of previous roles held (optional)
 * @returns {object | null}
 */
export function generateResumeBlueprint(input) {
  const { targetRole, skills, currentRole, yearsExp, pastRoles } = input;

  const target = getRoleBySlug(targetRole);
  if (!target) return null;

  const userSkills = (skills || []).map((s) => s.trim()).filter(Boolean);
  const targetProfile = getRoleProfile(targetRole);
  const gapAnalysis = analyseSkillsGap(userSkills, targetRole);
  const salary = getSalaryIntelligence(targetRole);

  // ── 1. Keyword analysis ──────────────────────────────────────────────────
  const keywords = _buildKeywordStrategy(target, gapAnalysis, userSkills);

  // ── 2. Skills section optimisation ───────────────────────────────────────
  const skillsSection = _buildSkillsSection(target, userSkills, gapAnalysis);

  // ── 3. Professional summary guidance ─────────────────────────────────────
  const summaryGuidance = _buildSummaryGuidance(target, userSkills, yearsExp, currentRole);

  // ── 4. Experience section guidance ───────────────────────────────────────
  const experienceGuidance = _buildExperienceGuidance(target, currentRole, pastRoles);

  // ── 5. Transition narrative (if switching roles) ─────────────────────────
  let transitionNarrative = null;
  if (currentRole && currentRole !== targetRole) {
    const transitionGap = analyseRoleTransitionGap(currentRole, targetRole);
    transitionNarrative = _buildTransitionNarrative(transitionGap, currentRole, targetRole);
  }

  // ── 6. ATS compatibility score ───────────────────────────────────────────
  const atsScore = _computeAtsScore(gapAnalysis, keywords, userSkills);

  return {
    target_role: {
      slug: target.slug,
      title: target.title,
      category: target.category,
      seniority: target.seniority,
      industries: target.industries || [],
      salary_mean: salary?.salary?.mean || null,
    },
    ats_score: atsScore,
    keywords,
    skills_section: skillsSection,
    summary_guidance: summaryGuidance,
    experience_guidance: experienceGuidance,
    transition_narrative: transitionNarrative,
    formatting_rules: {
      recommended_length: target.seniority_level >= 5 ? "2 pages" : "1 page",
      font_guidance: "Clean sans-serif (Calibri, Arial, Helvetica), 10–12pt body",
      section_order: _recommendedSectionOrder(currentRole, targetRole, yearsExp),
      ats_tips: [
        "Use standard section headings: Summary, Experience, Skills, Education",
        "Avoid tables, columns, headers/footers, and images",
        "Save as .docx or plain .pdf — avoid designer PDF exports",
        "Mirror exact skill names from the job description",
        "Use reverse-chronological order for experience",
      ],
    },
  };
}

/**
 * Compare resume readiness across multiple target roles.
 *
 * @param {string[]} targetSlugs
 * @param {string[]} skills
 * @returns {object}
 */
export function compareResumeReadiness(targetSlugs, skills) {
  const userSkills = (skills || []).map((s) => s.trim()).filter(Boolean);

  const results = targetSlugs.map((slug) => {
    const role = getRoleBySlug(slug);
    if (!role) return { slug, error: "Role not found" };

    const gap = analyseSkillsGap(userSkills, slug);
    const keywords = _buildKeywordStrategy(role, gap, userSkills);
    const atsScore = _computeAtsScore(gap, keywords, userSkills);

    return {
      slug,
      title: role.title,
      category: role.category,
      seniority: role.seniority,
      ats_score: atsScore,
      readiness_pct: gap?.analysis?.readiness_pct ?? 0,
      matched_keywords: keywords.matched.length,
      missing_keywords: keywords.missing_critical.length + keywords.missing_preferred.length,
      missing_critical: keywords.missing_critical,
    };
  }).filter((r) => !r.error);

  results.sort((a, b) => b.ats_score.score - a.ats_score.score);

  return {
    user_skills: userSkills,
    targets_analysed: results.length,
    results,
    best_fit: results[0] || null,
  };
}

// ===========================================================================
// Internal builders
// ===========================================================================

function _buildKeywordStrategy(target, gapAnalysis, userSkills) {
  const grouped = target.skills_grouped || {};
  const userLower = new Set(userSkills.map((s) => s.toLowerCase()));

  const allRequired = target.skills || [];
  const matched = allRequired.filter((s) => userLower.has(s.toLowerCase()));
  const missing = allRequired.filter((s) => !userLower.has(s.toLowerCase()));

  // Critical = core skills you're missing; Preferred = technical; Nice-to-have = soft
  const missingCritical = missing.filter((s) => (grouped.core || []).includes(s));
  const missingPreferred = missing.filter((s) => (grouped.technical || []).includes(s));
  const missingNice = missing.filter((s) => (grouped.soft || []).includes(s));

  // Role title and category as keywords
  const contextKeywords = [
    target.title,
    target.category,
    ...(target.industries || []).slice(0, 3),
  ];

  return {
    matched,
    missing_critical: missingCritical,
    missing_preferred: missingPreferred,
    missing_nice_to_have: missingNice,
    context_keywords: contextKeywords,
    keyword_density_advice: matched.length > 0
      ? `Include these ${matched.length} matched keywords prominently across your summary and experience sections.`
      : "You have no direct keyword matches — focus on transferable terminology and related tools.",
  };
}

function _buildSkillsSection(target, userSkills, gapAnalysis) {
  const grouped = target.skills_grouped || {};
  const userLower = new Set(userSkills.map((s) => s.toLowerCase()));

  const include = {
    core: (grouped.core || []).filter((s) => userLower.has(s.toLowerCase())),
    technical: (grouped.technical || []).filter((s) => userLower.has(s.toLowerCase())),
    soft: (grouped.soft || []).filter((s) => userLower.has(s.toLowerCase())),
  };

  // Bonus skills — user has them but target doesn't list them
  const targetLower = new Set((target.skills || []).map((s) => s.toLowerCase()));
  const bonus = userSkills.filter((s) => !targetLower.has(s.toLowerCase()));

  return {
    recommended_layout: "Group by category: Core Competencies | Technical Skills | Soft Skills",
    prioritised_skills: include,
    bonus_skills: bonus.slice(0, 8),
    bonus_note: bonus.length > 0
      ? `You have ${bonus.length} additional skill${bonus.length !== 1 ? "s" : ""} beyond the target role. Include the most relevant to show breadth.`
      : null,
    total_matched: include.core.length + include.technical.length + include.soft.length,
  };
}

function _buildSummaryGuidance(target, userSkills, yearsExp, currentRole) {
  const elements = [];

  if (yearsExp) {
    elements.push(`Lead with "${yearsExp}+ years of experience" to pass initial screening.`);
  }

  elements.push(`Reference the target domain: "${target.category}" and target title "${target.title}".`);

  const grouped = target.skills_grouped || {};
  const coreSkills = (grouped.core || []).slice(0, 3);
  if (coreSkills.length) {
    elements.push(`Mention core competencies upfront: ${coreSkills.join(", ")}.`);
  }

  if (target.industries?.length) {
    elements.push(`Reference industry context: ${target.industries.slice(0, 3).join(", ")}.`);
  }

  if (currentRole) {
    const current = getRoleBySlug(currentRole);
    if (current && current.category !== target.category) {
      elements.push(`Frame your career pivot positively — highlight transferable skills from ${current.category}.`);
    }
  }

  elements.push("Keep to 3–4 lines. Avoid first-person pronouns. Use present tense for current capabilities.");

  return {
    recommended_length: "3–4 lines",
    elements,
  };
}

function _buildExperienceGuidance(target, currentRole, pastRoles) {
  const grouped = target.skills_grouped || {};
  const guidance = [];

  guidance.push({
    principle: "quantify_impact",
    detail: "Every bullet should follow the pattern: Action verb + Task + Quantified result. Example: 'Reduced data pipeline latency by 40% through query optimisation.'",
  });

  guidance.push({
    principle: "mirror_terminology",
    detail: `Use exact terminology from the ${target.title} skill set: ${(target.skills || []).slice(0, 6).join(", ")}.`,
  });

  if (grouped.core?.length) {
    guidance.push({
      principle: "prioritise_core_skills",
      detail: `Lead experience bullets with demonstrations of: ${grouped.core.join(", ")}.`,
    });
  }

  if (currentRole) {
    const current = getRoleBySlug(currentRole);
    if (current) {
      guidance.push({
        principle: "highlight_transferable",
        detail: `From your ${current.title} role, emphasise work that overlaps with ${target.title} responsibilities.`,
      });
    }
  }

  guidance.push({
    principle: "recency_bias",
    detail: "ATS and recruiters weight recent experience heavily — put the most relevant bullets first in each role.",
  });

  // Bullet templates based on target skills
  const bulletTemplates = (target.skills || []).slice(0, 5).map((skill) => ({
    skill,
    template: `[Action verb] [project/task] using ${skill}, resulting in [quantified outcome].`,
  }));

  return {
    bullet_count_per_role: "4–6 bullets for recent roles, 2–3 for older roles",
    guidance,
    bullet_templates: bulletTemplates,
  };
}

function _buildTransitionNarrative(transitionGap, currentSlug, targetSlug) {
  if (!transitionGap) return null;

  const shared = transitionGap.skills_analysis.shared || [];
  const overlapPct = transitionGap.skills_analysis.overlap_pct;
  const current = getRoleBySlug(currentSlug);
  const target = getRoleBySlug(targetSlug);

  const narrative = [];

  if (overlapPct >= 60) {
    narrative.push(`Strong foundation: ${overlapPct}% skills overlap between ${current?.title || currentSlug} and ${target?.title || targetSlug}. Frame this as a natural progression.`);
  } else if (overlapPct >= 35) {
    narrative.push(`Moderate overlap (${overlapPct}%). Emphasise the ${shared.length} shared skills (${shared.slice(0, 4).join(", ")}) and frame new skills as recent additions.`);
  } else {
    narrative.push(`Low overlap (${overlapPct}%). This is a career pivot — use a functional or hybrid resume format to lead with skills over chronology.`);
  }

  if (transitionGap.transition_metadata) {
    const d = transitionGap.transition_metadata;
    narrative.push(`This transition is rated "${d.difficulty_label}" (${d.difficulty_score}/100). ${d.salary_growth_pct > 0 ? `It offers a ${d.salary_growth_pct}% salary uplift.` : ""}`);
  }

  const sameCategory = current?.category === target?.category;
  if (!sameCategory) {
    narrative.push(`Cross-domain move (${current?.category} → ${target?.category}). Dedicate a "Relevant Projects" section to bridge the gap.`);
  }

  return {
    overlap_pct: overlapPct,
    shared_skills: shared,
    recommended_format: overlapPct < 35 ? "functional_or_hybrid" : "reverse_chronological",
    narrative,
  };
}

function _recommendedSectionOrder(currentRole, targetRole, yearsExp) {
  const current = currentRole ? getRoleBySlug(currentRole) : null;
  const target = targetRole ? getRoleBySlug(targetRole) : null;
  const isCrossDomain = current && target && current.category !== target.category;
  const isJunior = (yearsExp || 0) < 3;

  if (isCrossDomain) {
    return ["Professional Summary", "Core Skills", "Relevant Projects", "Experience", "Education", "Certifications"];
  }
  if (isJunior) {
    return ["Professional Summary", "Skills", "Education", "Experience", "Projects"];
  }
  return ["Professional Summary", "Experience", "Skills", "Education", "Certifications"];
}

function _computeAtsScore(gapAnalysis, keywords, userSkills) {
  if (!gapAnalysis) return { score: 0, label: "unknown", breakdown: {} };

  const readiness = gapAnalysis.analysis.readiness_pct;
  const criticalMissing = keywords.missing_critical.length;
  const totalRequired = gapAnalysis.target.total_skills_required || 1;
  const keywordCoverage = Math.round((keywords.matched.length / totalRequired) * 100);

  // Weighted: 60% keyword match, 20% no critical gaps, 20% overall readiness
  const criticalPenalty = Math.min(criticalMissing * 12, 40);
  const score = Math.max(0, Math.min(100, Math.round(
    keywordCoverage * 0.6 +
    (100 - criticalPenalty) * 0.2 +
    readiness * 0.2
  )));

  let label;
  if (score >= 80) label = "strong";
  else if (score >= 60) label = "good";
  else if (score >= 40) label = "needs_work";
  else label = "weak";

  return {
    score,
    label,
    breakdown: {
      keyword_coverage_pct: keywordCoverage,
      critical_skills_missing: criticalMissing,
      overall_readiness_pct: readiness,
    },
  };
}
