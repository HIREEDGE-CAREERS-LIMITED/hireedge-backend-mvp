// ============================================================================
// lib/tools/visaEngine.js
// HireEdge — AI Career Intelligence Platform
// UK visa eligibility assessment: Skilled Worker visa, Global Talent, Graduate,
// and High Potential Individual routes. Uses SOC 2020 codes, salary data,
// and seniority levels from the dataset.
//
// IMPORTANT: This provides indicative guidance only. Immigration rules change
// frequently. Always consult a licensed OISC/SRA immigration adviser.
// ============================================================================

import { getRoleBySlug } from "../dataset/roleIndex.js";
import { getSalaryIntelligence } from "../intelligence/salaryEngine.js";
import { getRoleProfile } from "../intelligence/roleIntelligenceEngine.js";
import { getNextMoves } from "../graph/careerPathEngine.js";

// ---------------------------------------------------------------------------
// UK visa threshold constants (2025–26)
// Source: UK Gov — Skilled Worker visa; points-based system
// These should be updated when thresholds change.
// ---------------------------------------------------------------------------
const THRESHOLDS = {
  SKILLED_WORKER_GENERAL_MIN: 38700,
  SKILLED_WORKER_GOING_RATE_DISCOUNT_NEW_ENTRANT: 0.7,
  NEW_ENTRANT_AGE_MAX: 26,
  NEW_ENTRANT_MAX_SALARY: 30960,
  SOC_ELIGIBLE_MAJOR_GROUPS: ["1", "2", "3"],
  SOC_ELIGIBLE_EXTENDED: ["4", "5", "6", "7"],
  GLOBAL_TALENT_SALARY_INDICATOR: 60000,
  HIGH_POTENTIAL_ELIGIBLE_SENIORITY: 5,
};

/**
 * Assess UK visa eligibility for a given role and user profile.
 *
 * @param {object} input
 * @param {string}   input.targetRole        - Role slug
 * @param {number}   [input.offeredSalary]   - Offered salary in GBP (optional; defaults to role mean)
 * @param {number}   [input.age]             - Applicant age (optional)
 * @param {boolean}  [input.hasUkDegree]     - Whether applicant has a UK degree (Graduate route)
 * @param {boolean}  [input.isNewEntrant]    - Force new-entrant assessment
 * @param {string[]} [input.skills]          - User skills (for Global Talent indicator)
 * @returns {object | null}
 */
export function assessVisaEligibility(input) {
  const { targetRole, offeredSalary, age, hasUkDegree, isNewEntrant, skills } = input;

  const role = getRoleBySlug(targetRole);
  if (!role) return null;

  const salary = getSalaryIntelligence(targetRole);
  const salaryToAssess = offeredSalary || salary?.salary?.mean || 0;
  const soc = role.uk_soc_2020 || null;
  const majorGroup = soc?.major_group || null;

  // ── 1. Skilled Worker visa ───────────────────────────────────────────────
  const skilledWorker = _assessSkilledWorker(role, salaryToAssess, soc, majorGroup, age, isNewEntrant);

  // ── 2. Global Talent visa ────────────────────────────────────────────────
  const globalTalent = _assessGlobalTalent(role, salaryToAssess, skills || []);

  // ── 3. Graduate visa ─────────────────────────────────────────────────────
  const graduate = _assessGraduate(hasUkDegree, role);

  // ── 4. High Potential Individual ─────────────────────────────────────────
  const hpi = _assessHPI(role);

  // ── 5. Overall recommendation ────────────────────────────────────────────
  const routes = [skilledWorker, globalTalent, graduate, hpi].filter((r) => r.eligible || r.potentially_eligible);
  const bestRoute = routes.sort((a, b) => (b.confidence_score || 0) - (a.confidence_score || 0))[0] || null;

  // ── 6. Salary gap analysis (what salary would make them eligible) ────────
  const salaryGap = _computeSalaryGap(salaryToAssess, THRESHOLDS.SKILLED_WORKER_GENERAL_MIN);

  // ── 7. Alternative roles with better visa prospects ──────────────────────
  const alternatives = _findVisaFriendlyAlternatives(targetRole);

  return {
    disclaimer: "This is indicative guidance only. UK immigration rules change frequently. Always consult a licensed OISC or SRA-regulated immigration adviser before making decisions.",
    target_role: {
      slug: role.slug,
      title: role.title,
      category: role.category,
      seniority: role.seniority,
      soc_code: soc?.code || null,
      soc_title: soc?.title || null,
      soc_major_group: majorGroup,
    },
    salary_assessed: salaryToAssess,
    routes: {
      skilled_worker: skilledWorker,
      global_talent: globalTalent,
      graduate: graduate,
      high_potential_individual: hpi,
    },
    recommended_route: bestRoute ? bestRoute.route : null,
    eligible_routes_count: routes.length,
    salary_gap: salaryGap,
    visa_friendly_alternatives: alternatives,
  };
}

/**
 * Compare visa eligibility across multiple roles.
 *
 * @param {string[]} roleSlugs
 * @param {{ age?: number, hasUkDegree?: boolean }} opts
 * @returns {object}
 */
export function compareVisaEligibility(roleSlugs, opts = {}) {
  const results = roleSlugs.map((slug) => {
    const assessment = assessVisaEligibility({
      targetRole: slug,
      age: opts.age,
      hasUkDegree: opts.hasUkDegree,
    });
    if (!assessment) return { slug, error: "Role not found" };

    return {
      slug,
      title: assessment.target_role.title,
      soc_code: assessment.target_role.soc_code,
      salary_assessed: assessment.salary_assessed,
      eligible_routes_count: assessment.eligible_routes_count,
      recommended_route: assessment.recommended_route,
      skilled_worker_eligible: assessment.routes.skilled_worker.eligible,
      salary_meets_threshold: assessment.salary_assessed >= THRESHOLDS.SKILLED_WORKER_GENERAL_MIN,
    };
  }).filter((r) => !r.error);

  results.sort((a, b) => b.eligible_routes_count - a.eligible_routes_count);

  return {
    disclaimer: "Indicative guidance only. Consult a licensed immigration adviser.",
    roles_assessed: results.length,
    results,
  };
}

// ===========================================================================
// Route assessments
// ===========================================================================

function _assessSkilledWorker(role, salary, soc, majorGroup, age, forceNewEntrant) {
  const result = {
    route: "skilled_worker",
    eligible: false,
    potentially_eligible: false,
    confidence_score: 0,
    requirements_met: [],
    requirements_not_met: [],
    notes: [],
  };

  // SOC code check
  if (!soc) {
    result.requirements_not_met.push("No SOC 2020 code mapped for this role");
    result.notes.push("Without a valid SOC code, sponsorship is unlikely. Check if an alternative job title maps to an eligible SOC code.");
    return result;
  }

  const isEligibleSOC = THRESHOLDS.SOC_ELIGIBLE_MAJOR_GROUPS.includes(majorGroup) ||
    THRESHOLDS.SOC_ELIGIBLE_EXTENDED.includes(majorGroup);

  if (isEligibleSOC) {
    result.requirements_met.push(`SOC ${soc.code} (${soc.title}) is in an eligible occupation group (Major Group ${majorGroup})`);
    result.confidence_score += 30;
  } else {
    result.requirements_not_met.push(`SOC Major Group ${majorGroup} may not be eligible for Skilled Worker sponsorship`);
  }

  // New entrant assessment
  const isNewEntrant = forceNewEntrant || (age && age <= THRESHOLDS.NEW_ENTRANT_AGE_MAX);
  const effectiveThreshold = isNewEntrant
    ? THRESHOLDS.NEW_ENTRANT_MAX_SALARY
    : THRESHOLDS.SKILLED_WORKER_GENERAL_MIN;

  // Salary check
  if (salary >= effectiveThreshold) {
    result.requirements_met.push(`Salary £${salary.toLocaleString()} meets ${isNewEntrant ? "new entrant" : "general"} threshold (£${effectiveThreshold.toLocaleString()})`);
    result.confidence_score += 40;
  } else {
    result.requirements_not_met.push(`Salary £${salary.toLocaleString()} is below ${isNewEntrant ? "new entrant" : "general"} threshold (£${effectiveThreshold.toLocaleString()})`);
    result.notes.push(`Salary shortfall: £${(effectiveThreshold - salary).toLocaleString()}. Negotiate a higher offer or consider roles with higher pay bands.`);
  }

  if (isNewEntrant) {
    result.notes.push("New entrant rate applied — available for under-26s, career switchers, or those in professional training.");
  }

  // Sponsorship requirement
  result.notes.push("Requires employer with a valid Sponsor Licence. Confirm sponsorship before accepting an offer.");

  // Overall eligibility
  result.eligible = result.requirements_not_met.length === 0 && isEligibleSOC;
  result.potentially_eligible = result.confidence_score >= 30;

  if (result.eligible) result.confidence_score = Math.min(result.confidence_score + 20, 90);

  return result;
}

function _assessGlobalTalent(role, salary, skills) {
  const result = {
    route: "global_talent",
    eligible: false,
    potentially_eligible: false,
    confidence_score: 0,
    requirements_met: [],
    requirements_not_met: [],
    notes: [],
  };

  // Category alignment check
  const techCategories = ["Data & AI", "Engineering", "DevOps & Infrastructure", "Cybersecurity"];
  const isTech = techCategories.includes(role.category);

  if (isTech) {
    result.requirements_met.push(`${role.category} falls within Tech Nation / DSIT digital technology remit`);
    result.confidence_score += 25;
  } else {
    result.notes.push(`${role.category} is outside core tech routes but may qualify under other endorsing bodies (e.g. Arts Council, Royal Society, British Academy).`);
  }

  // Seniority indicator
  if ((role.seniority_level ?? 0) >= 5) {
    result.requirements_met.push(`${role.seniority} seniority suggests leader/expert track eligibility`);
    result.confidence_score += 20;
  }

  // Salary indicator
  if (salary >= THRESHOLDS.GLOBAL_TALENT_SALARY_INDICATOR) {
    result.requirements_met.push(`Salary £${salary.toLocaleString()} suggests senior-level positioning`);
    result.confidence_score += 15;
  }

  // Skills depth indicator
  if (skills.length >= 8) {
    result.requirements_met.push(`Broad skill set (${skills.length} skills) supports exceptional talent claim`);
    result.confidence_score += 10;
  }

  result.notes.push("Global Talent requires endorsement from a designated body. Prepare a portfolio of evidence: publications, patents, open-source contributions, or leadership roles.");
  result.notes.push("No job offer required — this visa grants the right to work flexibly.");

  result.potentially_eligible = result.confidence_score >= 35;
  result.eligible = result.confidence_score >= 60;

  return result;
}

function _assessGraduate(hasUkDegree, role) {
  const result = {
    route: "graduate",
    eligible: false,
    potentially_eligible: false,
    confidence_score: 0,
    requirements_met: [],
    requirements_not_met: [],
    notes: [],
  };

  if (hasUkDegree) {
    result.requirements_met.push("Holds a UK degree — meets the primary eligibility criterion");
    result.eligible = true;
    result.confidence_score = 75;
    result.notes.push("The Graduate route grants 2 years of unrestricted work (3 for PhD). No salary threshold. No sponsorship needed.");
    result.notes.push("Must apply before your Student visa expires.");
  } else if (hasUkDegree === false) {
    result.requirements_not_met.push("No UK degree — Graduate route requires completing a UK degree on a Student visa");
  } else {
    result.notes.push("If you recently completed a UK degree on a Student visa, you may be eligible for the 2-year Graduate route.");
    result.potentially_eligible = true;
    result.confidence_score = 20;
  }

  return result;
}

function _assessHPI(role) {
  const result = {
    route: "high_potential_individual",
    eligible: false,
    potentially_eligible: false,
    confidence_score: 0,
    requirements_met: [],
    requirements_not_met: [],
    notes: [],
  };

  result.notes.push("HPI route requires a degree from a top global university (listed by UK Gov). No job offer or sponsorship needed.");
  result.notes.push("Grants 2 years (bachelor's/master's) or 3 years (PhD) to live and work in the UK.");
  result.notes.push("Must have graduated within the last 5 years.");

  if ((role.seniority_level ?? 0) <= 3) {
    result.notes.push("This role's seniority level aligns with typical HPI applicants (early-to-mid career).");
    result.potentially_eligible = true;
    result.confidence_score = 30;
  } else {
    result.notes.push("At your seniority level, the Skilled Worker or Global Talent routes may be more appropriate.");
    result.potentially_eligible = true;
    result.confidence_score = 15;
  }

  return result;
}

// ===========================================================================
// Helpers
// ===========================================================================

function _computeSalaryGap(currentSalary, threshold) {
  if (currentSalary >= threshold) {
    return {
      meets_threshold: true,
      surplus: currentSalary - threshold,
      message: `Salary exceeds the Skilled Worker threshold by £${(currentSalary - threshold).toLocaleString()}.`,
    };
  }
  return {
    meets_threshold: false,
    shortfall: threshold - currentSalary,
    message: `Salary is £${(threshold - currentSalary).toLocaleString()} below the Skilled Worker general threshold (£${threshold.toLocaleString()}). Negotiate upwards or consider a higher-paying role.`,
  };
}

function _findVisaFriendlyAlternatives(currentSlug) {
  const nextMoves = getNextMoves(currentSlug, { sortBy: "salary" });

  return nextMoves
    .filter((m) => {
      const role = getRoleBySlug(m.slug);
      const mean = role?.salary_uk?.mean || 0;
      const soc = role?.uk_soc_2020?.major_group;
      return mean >= THRESHOLDS.SKILLED_WORKER_GENERAL_MIN &&
        soc &&
        [...THRESHOLDS.SOC_ELIGIBLE_MAJOR_GROUPS, ...THRESHOLDS.SOC_ELIGIBLE_EXTENDED].includes(soc);
    })
    .slice(0, 5)
    .map((m) => {
      const role = getRoleBySlug(m.slug);
      return {
        slug: m.slug,
        title: m.title,
        salary_mean: role?.salary_uk?.mean || null,
        soc_code: role?.uk_soc_2020?.code || null,
        salary_growth_pct: m.salary_growth_pct,
        meets_skilled_worker_threshold: true,
      };
    });
}
