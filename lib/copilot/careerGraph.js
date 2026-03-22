// ============================================================================
// lib/copilot/careerGraph.js
// HireEdge -- Career Graph Intelligence Layer
//
// Bridges the roles-enriched.json dataset into EDGEX chat.
// Called by api/copilot/chat.js to inject real data into every prompt.
//
// Exports:
//   buildCareerContext(fromSlug, toSlug) -> structured data object
//   findRoleByTitle(title)              -> role object or null
//   fuzzyMatchRole(text)               -> best slug match from free text
//   buildDataContext(message, context) -> full context string for system prompt
// ============================================================================

import { getRoleBySlug, getAllRoles } from "../dataset/roleIndex.js";

//  Fuzzy role title matching 
// Maps free-text like "sales manager" -> slug "sales-manager"

export function findRoleByTitle(title) {
  if (!title) return null;
  const normalised = title.toLowerCase().trim();

  const all = getAllRoles ? getAllRoles() : [];

  // Exact slug match
  const bySlug = getRoleBySlug(normalised.replace(/\s+/g, "-"));
  if (bySlug) return bySlug;

  // Title match
  const byTitle = all.find(r =>
    (r.title || "").toLowerCase() === normalised
  );
  if (byTitle) return byTitle;

  // Partial match -- longest overlap wins
  const scored = all
    .map(r => {
      const t = (r.title || "").toLowerCase();
      const score = t.includes(normalised) || normalised.includes(t) ? t.length : 0;
      return { role: r, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.role || null;
}

//  Derive transition metrics from dataset 

function deriveTransitionMetrics(fromRole, toRole) {
  if (!fromRole || !toRole) return null;

  // Skill overlap
  const fromSkills = new Set([
    ...(fromRole.skills_grouped?.core       || []),
    ...(fromRole.skills_grouped?.technical  || []),
  ].map(s => s.toLowerCase()));

  const toSkills = [
    ...(toRole.skills_grouped?.core       || []),
    ...(toRole.skills_grouped?.technical  || []),
  ].map(s => s.toLowerCase());

  const overlap = toSkills.filter(s => fromSkills.has(s));
  const missingSkills = toSkills.filter(s => !fromSkills.has(s));

  const skillMatchPct = toSkills.length > 0
    ? Math.round((overlap.length / toSkills.length) * 100)
    : 50;

  // Difficulty score (0-100): based on dataset difficulty_to_enter + seniority gap
  const SENIORITY_RANK = { junior: 1, mid: 2, senior: 3, lead: 4, head: 5, director: 6, vp: 7, c_suite: 8 };
  const fromRank = SENIORITY_RANK[fromRole.seniority] || 3;
  const toRank   = SENIORITY_RANK[toRole.seniority]   || 3;
  const seniorityDelta = Math.max(0, toRank - fromRank);

  const baseDifficulty = toRole.difficulty_to_enter || 50;
  const difficultyScore = Math.min(100, Math.round(
    baseDifficulty * 0.5 +
    (100 - skillMatchPct) * 0.35 +
    seniorityDelta * 5
  ));

  // Success probability
  const successProbability = Math.max(15, Math.min(90, Math.round(
    skillMatchPct * 0.5 +
    (100 - difficultyScore) * 0.35 +
    (fromRole.demand_score || 50) * 0.15
  )));

  // Time estimate (months)
  const baseTime = toRole.time_to_hire || 3;
  const gapMonths = Math.round(missingSkills.length * 0.8 + seniorityDelta * 2 + baseTime);
  const timeMin = Math.max(2, gapMonths - 2);
  const timeMax = gapMonths + 4;

  // Salary delta
  const fromSalary = fromRole.salary_uk?.mean || 0;
  const toSalary   = toRole.salary_uk?.mean   || 0;
  const salaryDelta = fromSalary > 0 && toSalary > 0
    ? Math.round(((toSalary - fromSalary) / fromSalary) * 100)
    : null;

  return {
    skillMatchPct,
    difficultyScore,
    successProbability,
    timeMin,
    timeMax,
    missingSkills:     missingSkills.slice(0, 6),
    overlappingSkills: overlap.slice(0, 4),
    fromSalaryMean:    fromSalary,
    toSalaryMean:      toSalary,
    salaryDeltaPct:    salaryDelta,
  };
}

//  Build career context for a transition 

export function buildCareerContext(fromTitle, toTitle) {
  const fromRole = findRoleByTitle(fromTitle);
  const toRole   = findRoleByTitle(toTitle);

  if (!fromRole && !toRole) return null;

  const metrics = deriveTransitionMetrics(fromRole, toRole);

  return {
    fromRole:   fromRole  || null,
    toRole:     toRole    || null,
    metrics,
    // Next roles from dataset
    nextRoles:  toRole?.career_paths?.next_roles?.slice(0, 3) || [],
    altPaths:   fromRole?.career_paths?.next_roles?.filter(r => r !== toRole?.title).slice(0, 3) || [],
  };
}

//  Build data context string for system prompt injection 

export function buildDataContext(message, context) {
  const fromTitle = context?.role   || extractFromMessage(message, "from");
  const toTitle   = context?.target || extractFromMessage(message, "to");

  if (!fromTitle && !toTitle) return "";

  const data = buildCareerContext(fromTitle, toTitle);
  if (!data) return "";

  const lines = ["[CAREER GRAPH DATA -- use this in your response, do not say you are using a dataset]"];

  if (data.fromRole) {
    lines.push(
      "FROM ROLE: " + data.fromRole.title,
      "  Category: " + (data.fromRole.category || "unknown"),
      "  Seniority: " + (data.fromRole.seniority || "unknown"),
      "  UK Salary: GBP " + (data.fromRole.salary_uk?.mean?.toLocaleString("en-GB") || "unknown") + " mean",
      "  Core skills: " + (data.fromRole.skills_grouped?.core?.join(", ") || "none"),
      "  Technical skills: " + (data.fromRole.skills_grouped?.technical?.slice(0, 5).join(", ") || "none")
    );
  }

  if (data.toRole) {
    lines.push(
      "TO ROLE: " + data.toRole.title,
      "  Category: " + (data.toRole.category || "unknown"),
      "  Seniority: " + (data.toRole.seniority || "unknown"),
      "  UK Salary: GBP " + (data.toRole.salary_uk?.mean?.toLocaleString("en-GB") || "unknown") + " mean",
      "  Demand score: " + (data.toRole.demand_score || "unknown") + "/100",
      "  Required core skills: " + (data.toRole.skills_grouped?.core?.join(", ") || "none"),
      "  Required technical skills: " + (data.toRole.skills_grouped?.technical?.slice(0, 6).join(", ") || "none"),
      "  Next career steps from this role: " + (data.toRole.career_paths?.next_roles?.slice(0, 3).join(", ") || "none")
    );
  }

  if (data.metrics) {
    const m = data.metrics;
    lines.push(
      "TRANSITION METRICS (calculated from dataset):",
      "  Skill match: " + m.skillMatchPct + "%",
      "  Difficulty score: " + m.difficultyScore + "/100",
      "  Success probability: " + m.successProbability + "%",
      "  Estimated time: " + m.timeMin + "-" + m.timeMax + " months",
      "  Skills to acquire: " + (m.missingSkills.join(", ") || "none"),
      "  Transferable skills: " + (m.overlappingSkills.join(", ") || "none"),
      m.salaryDeltaPct !== null
        ? "  Salary impact: " + (m.salaryDeltaPct >= 0 ? "+" : "") + m.salaryDeltaPct + "% (GBP " + m.fromSalaryMean?.toLocaleString("en-GB") + " -> GBP " + m.toSalaryMean?.toLocaleString("en-GB") + ")"
        : "  Salary data: not available"
    );
  }

  if (data.altPaths?.length > 0) {
    lines.push("ALTERNATIVE PATHS from current role: " + data.altPaths.join(", "));
  }

  return lines.join("\n");
}

//  Extract role mentions from free text 

function extractFromMessage(message, direction) {
  if (!message) return null;
  if (direction === "from") {
    const m = message.match(/from (?:a |an )?([A-Za-z ]+?) (?:to|into|->)/i);
    return m?.[1]?.trim() || null;
  }
  if (direction === "to") {
    const m = message.match(/(?:to|into|become a?n? ?|->)\s*([A-Za-z ]+?)(?:\?|$|,|\.| in | at )/i);
    return m?.[1]?.trim() || null;
  }
  return null;
}
