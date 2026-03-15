// ============================================================================
// test/verify-tools-batch2.mjs
// Smoke test for Resume, LinkedIn, Interview, Visa engines + full regression
// Run with: node test/verify-tools-batch2.mjs
// ============================================================================

// ── Existing engine regression ─────────────────────────────────────────────
import { loadRoles } from "../lib/dataset/loadDataset.js";
import { getRoleBySlug } from "../lib/dataset/roleIndex.js";
import { findShortestPath } from "../lib/graph/careerPathEngine.js";
import { getSalaryIntelligence } from "../lib/intelligence/salaryEngine.js";
import { analyseRoleTransitionGap } from "../lib/intelligence/skillsGapEngine.js";
import { buildRoadmap } from "../lib/tools/roadmapEngine.js";
import { explainTransitionGap } from "../lib/tools/gapExplainerEngine.js";
import { generateTalentProfile } from "../lib/tools/talentProfileEngine.js";

// ── New engines ────────────────────────────────────────────────────────────
import { generateResumeBlueprint, compareResumeReadiness } from "../lib/tools/resumeEngine.js";
import { generateLinkedInOptimisation } from "../lib/tools/linkedinEngine.js";
import { generateInterviewPrep } from "../lib/tools/interviewEngine.js";
import { assessVisaEligibility, compareVisaEligibility } from "../lib/tools/visaEngine.js";

let pass = 0;
let fail = 0;

function assert(label, condition) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}`); }
}

console.log("\n🔍 HIREEDGE — Career Tools Batch 2 Verification\n");

// ══════════════════════════════════════════════════════════════════════════════
// REGRESSION
// ══════════════════════════════════════════════════════════════════════════════
console.log("── Regression: Core + Batch 1 engines ──");
assert("Dataset loads (1228)", loadRoles().length === 1228);
assert("roleIndex works", getRoleBySlug("data-analyst")?.title === "Data Analyst");
assert("careerPathEngine works", findShortestPath("data-analyst", "data-architect") !== null);
assert("salaryEngine works", getSalaryIntelligence("data-analyst") !== null);
assert("skillsGapEngine works", analyseRoleTransitionGap("data-analyst", "data-architect") !== null);
assert("roadmapEngine works", buildRoadmap("data-analyst", "data-architect")?.reachable === true);
assert("gapExplainerEngine works", explainTransitionGap("data-analyst", "data-architect") !== null);
assert("talentProfileEngine works", generateTalentProfile({ currentRole: "data-analyst", skills: ["SQL"] }) !== null);

// ══════════════════════════════════════════════════════════════════════════════
// RESUME ENGINE
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Resume Engine ──");

const resume1 = generateResumeBlueprint({
  targetRole: "data-architect",
  skills: ["SQL", "Python", "Excel", "Data Visualization"],
  currentRole: "data-analyst",
  yearsExp: 3,
});
assert("generateResumeBlueprint returns result", resume1 !== null);
assert("has target_role", resume1.target_role.slug === "data-architect");
assert("has ats_score", typeof resume1.ats_score.score === "number");
assert("ats_score has label", ["strong", "good", "needs_work", "weak"].includes(resume1.ats_score.label));
assert("has keywords.matched", Array.isArray(resume1.keywords.matched));
assert("has keywords.missing_critical", Array.isArray(resume1.keywords.missing_critical));
assert("has keywords.context_keywords", resume1.keywords.context_keywords.length > 0);
assert("has skills_section", resume1.skills_section.total_matched >= 0);
assert("has skills_section.prioritised_skills", resume1.skills_section.prioritised_skills !== undefined);
assert("has summary_guidance", resume1.summary_guidance.elements.length > 0);
assert("has experience_guidance", resume1.experience_guidance.guidance.length > 0);
assert("has bullet_templates", resume1.experience_guidance.bullet_templates.length > 0);
assert("has transition_narrative (cross-role)", resume1.transition_narrative !== null);
assert("transition has recommended_format", resume1.transition_narrative.recommended_format !== undefined);
assert("has formatting_rules", resume1.formatting_rules.ats_tips.length >= 3);
assert("has section_order", resume1.formatting_rules.section_order.length >= 4);

// Same-role resume (no transition narrative)
const resume2 = generateResumeBlueprint({
  targetRole: "data-analyst",
  skills: ["SQL", "Python", "Excel"],
});
assert("same-role resume works", resume2 !== null);
assert("same-role has no transition_narrative", resume2.transition_narrative === null);

// Compare readiness
const resumeCompare = compareResumeReadiness(
  ["data-architect", "analytics-manager", "data-scientist"],
  ["SQL", "Python", "Excel", "Statistics"]
);
assert("compareResumeReadiness returns results", resumeCompare.results.length === 3);
assert("results sorted by ats_score", resumeCompare.results[0].ats_score.score >= resumeCompare.results[2].ats_score.score);
assert("has best_fit", resumeCompare.best_fit !== null);

// Invalid target
assert("invalid target returns null", generateResumeBlueprint({ targetRole: "zzz", skills: ["SQL"] }) === null);

// ══════════════════════════════════════════════════════════════════════════════
// LINKEDIN ENGINE
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── LinkedIn Engine ──");

const linkedin1 = generateLinkedInOptimisation({
  currentRole: "data-analyst",
  skills: ["SQL", "Python", "Excel", "Statistics", "Data Visualization"],
  yearsExp: 4,
  targetRole: "data-architect",
  industry: "technology",
});
assert("generateLinkedInOptimisation returns result", linkedin1 !== null);
assert("has current_role", linkedin1.current_role.slug === "data-analyst");
assert("has target_role", linkedin1.target_role.slug === "data-architect");
assert("has strength_score", typeof linkedin1.strength_score.score === "number");
assert("strength_score has label", ["all_star", "strong", "intermediate", "needs_work"].includes(linkedin1.strength_score.label));
assert("has headlines (multiple)", linkedin1.headlines.length >= 3);
assert("headlines have style", linkedin1.headlines.every((h) => h.style && h.headline && h.rationale));
assert("has aspirational headline", linkedin1.headlines.some((h) => h.style === "aspirational"));
assert("has about_section", linkedin1.about_section.paragraphs.length >= 4);
assert("about has formatting_tips", linkedin1.about_section.formatting_tips.length >= 3);
assert("has skills_strategy", linkedin1.skills_strategy.top_3.length > 0);
assert("skills_strategy has endorsement_priority", linkedin1.skills_strategy.endorsement_priority.length > 0);
assert("has keyword_strategy", linkedin1.keyword_strategy.primary.length > 0);
assert("has keyword placement_guide", linkedin1.keyword_strategy.placement_guide.headline !== undefined);
assert("has experience_tips", linkedin1.experience_tips.length >= 3);
assert("has featured_section", linkedin1.featured_section.length >= 3);
assert("has career_context", typeof linkedin1.career_context.next_moves_count === "number");

// Without target
const linkedin2 = generateLinkedInOptimisation({
  currentRole: "data-analyst",
  skills: ["SQL", "Python"],
});
assert("LinkedIn without target works", linkedin2 !== null);
assert("no target = null target_role", linkedin2.target_role === null);
assert("no aspirational headline without target", !linkedin2.headlines.some((h) => h.style === "aspirational"));

// Invalid role
assert("invalid role returns null", generateLinkedInOptimisation({ currentRole: "zzz", skills: ["SQL"] }) === null);

// ══════════════════════════════════════════════════════════════════════════════
// INTERVIEW ENGINE
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Interview Engine ──");

const interview1 = generateInterviewPrep({
  targetRole: "data-architect",
  skills: ["SQL", "Python", "Excel", "Data Visualization"],
  currentRole: "data-analyst",
  yearsExp: 3,
});
assert("generateInterviewPrep returns result", interview1 !== null);
assert("has target_role", interview1.target_role.slug === "data-architect");
assert("has readiness", typeof interview1.readiness.score === "number");
assert("readiness has label", interview1.readiness.label !== undefined);
assert("has competency_questions", interview1.competency_questions.length >= 3);
assert("competency Qs have structure", interview1.competency_questions.every((q) => q.question && q.why_asked && q.preparation_tip));
assert("no transition Q (same category)", !interview1.competency_questions.some((q) => q.category === "transition"));

// Cross-category interview (should get transition question)
const interviewCross = generateInterviewPrep({
  targetRole: "product-manager",
  skills: ["SQL", "Data Visualization"],
  currentRole: "data-analyst",
});
assert("cross-category gets transition question", interviewCross?.competency_questions?.some((q) => q.category === "transition") ?? false);
assert("has technical_questions", interview1.technical_questions.length >= 3);
assert("tech Qs flag you_have_this", interview1.technical_questions.some((q) => q.you_have_this === true));
assert("tech Qs flag missing skills", interview1.technical_questions.some((q) => q.you_have_this === false));
assert("has behavioural_questions", interview1.behavioural_questions.length >= 4);
assert("behavioural Qs have framework", interview1.behavioural_questions.every((q) => q.framework));
assert("has career_narrative question", interview1.behavioural_questions.some((q) => q.category === "career_narrative"));
assert("has star_preparation", interview1.star_preparation.stories_to_prepare.length > 0);
assert("STAR stories have structure", interview1.star_preparation.stories_to_prepare.every((s) => s.situation && s.task && s.action && s.result));
assert("has universal_stories", interview1.star_preparation.universal_stories.length === 3);
assert("has questions_to_ask", interview1.questions_to_ask.length >= 5);
assert("has salary_negotiation", interview1.salary_negotiation !== null);
assert("salary has recommended_ask", interview1.salary_negotiation.recommended_ask.target > 0);
assert("salary has negotiation_tips", interview1.salary_negotiation.negotiation_tips.length >= 3);
assert("has weakness_strategy", interview1.weakness_strategy.length >= 1);
assert("weakness strategies have reframe", interview1.weakness_strategy.every((w) => w.reframe));

// Senior role (should get leadership questions)
const interviewSenior = generateInterviewPrep({
  targetRole: "analytics-manager",
  skills: ["SQL", "Python", "Data Visualization", "Team Management"],
  yearsExp: 8,
});
assert("senior role prep works", interviewSenior !== null);
assert("senior role gets leadership questions", interviewSenior.competency_questions.some((q) => q.category === "leadership"));

// Without current role (no transition Q)
const interview2 = generateInterviewPrep({
  targetRole: "data-analyst",
  skills: ["SQL", "Python"],
});
assert("interview without currentRole works", interview2 !== null);
assert("no transition question without currentRole", !interview2.competency_questions.some((q) => q.category === "transition"));

// Invalid target
assert("invalid target returns null", generateInterviewPrep({ targetRole: "zzz", skills: ["SQL"] }) === null);

// ══════════════════════════════════════════════════════════════════════════════
// VISA ENGINE
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Visa Engine ──");

const visa1 = assessVisaEligibility({
  targetRole: "data-architect",
  offeredSalary: 55000,
  age: 28,
  hasUkDegree: false,
  skills: ["SQL", "Python", "Data Warehousing", "Cloud Architecture", "ETL", "BigQuery", "Snowflake", "Data Modelling"],
});
assert("assessVisaEligibility returns result", visa1 !== null);
assert("has disclaimer", visa1.disclaimer.length > 0);
assert("has target_role", visa1.target_role.slug === "data-architect");
assert("has soc_code", visa1.target_role.soc_code !== null);
assert("has salary_assessed", visa1.salary_assessed === 55000);
assert("has skilled_worker route", visa1.routes.skilled_worker !== undefined);
assert("skilled_worker has eligible flag", typeof visa1.routes.skilled_worker.eligible === "boolean");
assert("skilled_worker has requirements_met", Array.isArray(visa1.routes.skilled_worker.requirements_met));
assert("skilled_worker has notes", visa1.routes.skilled_worker.notes.length > 0);
assert("has global_talent route", visa1.routes.global_talent !== undefined);
assert("has graduate route", visa1.routes.graduate !== undefined);
assert("graduate not eligible (no UK degree)", visa1.routes.graduate.eligible === false);
assert("has hpi route", visa1.routes.high_potential_individual !== undefined);
assert("has salary_gap", visa1.salary_gap !== undefined);
assert("has visa_friendly_alternatives", Array.isArray(visa1.visa_friendly_alternatives));
assert("has recommended_route", visa1.recommended_route !== null);
assert("has eligible_routes_count", typeof visa1.eligible_routes_count === "number");

// Graduate route eligible
const visaGrad = assessVisaEligibility({
  targetRole: "data-analyst",
  hasUkDegree: true,
});
assert("UK degree holder gets graduate eligible", visaGrad.routes.graduate.eligible === true);

// Low salary — below threshold
const visaLow = assessVisaEligibility({
  targetRole: "junior-data-analyst",
  offeredSalary: 25000,
});
assert("low salary assessment works", visaLow !== null);
assert("salary_gap shows shortfall", visaLow.salary_gap.meets_threshold === false);
assert("salary_gap has shortfall amount", visaLow.salary_gap.shortfall > 0);

// Compare visa eligibility
const visaCompare = compareVisaEligibility(
  ["data-architect", "data-analyst", "analytics-manager"],
  { age: 30 }
);
assert("compareVisaEligibility returns results", visaCompare.results.length === 3);
assert("visa compare has disclaimer", visaCompare.disclaimer.length > 0);
assert("visa compare sorted by eligible_routes", visaCompare.results[0].eligible_routes_count >= visaCompare.results[2].eligible_routes_count);

// Invalid role
assert("invalid role returns null", assessVisaEligibility({ targetRole: "zzz" }) === null);

// ══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n══════════════════════════════════════");
console.log(`  TOTAL: ${pass + fail}  |  ✅ PASS: ${pass}  |  ❌ FAIL: ${fail}`);
console.log("══════════════════════════════════════\n");

process.exit(fail > 0 ? 1 : 0);
