// ============================================================================
// test/test-career-pack.mjs
// HireEdge — Career Pack engine verification + full regression suite
// Run with: node test/test-career-pack.mjs
// ============================================================================

// ── Regression imports ─────────────────────────────────────────────────────
import { loadRoles } from "../lib/dataset/loadDataset.js";
import { getRoleBySlug } from "../lib/dataset/roleIndex.js";
import { findShortestPath } from "../lib/graph/careerPathEngine.js";
import { getSalaryIntelligence } from "../lib/intelligence/salaryEngine.js";
import { analyseSkillsGap } from "../lib/intelligence/skillsGapEngine.js";
import { buildRoadmap } from "../lib/tools/roadmapEngine.js";
import { explainTransitionGap } from "../lib/tools/gapExplainerEngine.js";
import { generateTalentProfile } from "../lib/tools/talentProfileEngine.js";
import { generateResumeBlueprint } from "../lib/tools/resumeEngine.js";
import { generateLinkedInOptimisation } from "../lib/tools/linkedinEngine.js";
import { generateInterviewPrep } from "../lib/tools/interviewEngine.js";
import { assessVisaEligibility } from "../lib/tools/visaEngine.js";

// ── Career Pack import ─────────────────────────────────────────────────────
import { buildCareerPack } from "../lib/career-pack/careerPackEngine.js";

let pass = 0;
let fail = 0;

function assert(label, condition) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}`); }
}

console.log("\n🔍 HIREEDGE — Career Pack Verification\n");

// ══════════════════════════════════════════════════════════════════════════════
// REGRESSION: All existing engines
// ══════════════════════════════════════════════════════════════════════════════
console.log("── Regression: Core engines ──");
assert("Dataset loads (1228)", loadRoles().length === 1228);
assert("roleIndex", getRoleBySlug("data-analyst")?.title === "Data Analyst");
assert("careerPathEngine", findShortestPath("data-analyst", "data-architect") !== null);
assert("salaryEngine", getSalaryIntelligence("data-analyst") !== null);
assert("skillsGapEngine", analyseSkillsGap(["SQL"], "data-architect") !== null);

console.log("\n── Regression: Tool engines ──");
assert("roadmapEngine", buildRoadmap("data-analyst", "data-architect")?.reachable === true);
assert("gapExplainerEngine", explainTransitionGap("data-analyst", "data-architect") !== null);
assert("talentProfileEngine", generateTalentProfile({ currentRole: "data-analyst", skills: ["SQL"] }) !== null);
assert("resumeEngine", generateResumeBlueprint({ targetRole: "data-architect", skills: ["SQL"] }) !== null);
assert("linkedinEngine", generateLinkedInOptimisation({ currentRole: "data-analyst", skills: ["SQL"] }) !== null);
assert("interviewEngine", generateInterviewPrep({ targetRole: "data-architect", skills: ["SQL"] }) !== null);
assert("visaEngine", assessVisaEligibility({ targetRole: "data-architect" }) !== null);

// ══════════════════════════════════════════════════════════════════════════════
// CAREER PACK ENGINE — Full pack
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Career Pack: Full build ──");

const pack = buildCareerPack({
  role: "data-analyst",
  target: "data-architect",
  skills: ["SQL", "Python", "Excel", "Statistics", "Data Visualization"],
  yearsExp: 3,
});

assert("buildCareerPack returns ok: true", pack.ok === true);
assert("has pack_id", typeof pack.pack_id === "string" && pack.pack_id.startsWith("cp_"));
assert("has generated_at (ISO)", pack.generated_at && !isNaN(Date.parse(pack.generated_at)));
assert("has input echo", pack.input.role === "data-analyst" && pack.input.target === "data-architect");
assert("input has skills array", pack.input.skills.length === 5);
assert("input has years_exp", pack.input.years_exp === 3);

// ── Summary ────────────────────────────────────────────────────────────────
console.log("\n── Career Pack: Summary ──");
const s = pack.summary;
assert("summary.from", s.from.slug === "data-analyst");
assert("summary.to", s.to.slug === "data-architect");
assert("summary.overall_readiness is number", typeof s.overall_readiness === "number" && s.overall_readiness >= 0 && s.overall_readiness <= 100);
assert("summary.roadmap.reachable", s.roadmap.reachable === true);
assert("summary.roadmap.total_steps", typeof s.roadmap.total_steps === "number");
assert("summary.roadmap.estimated_years", typeof s.roadmap.estimated_years === "number");
assert("summary.skills.readiness_pct", typeof s.skills.readiness_pct === "number");
assert("summary.skills.missing_count", typeof s.skills.missing_count === "number");
assert("summary.resume.ats_score", typeof s.resume.ats_score === "number");
assert("summary.resume.ats_label", ["strong", "good", "needs_work", "weak"].includes(s.resume.ats_label));
assert("summary.interview.readiness_score", typeof s.interview.readiness_score === "number");
assert("summary.salary.current_mean", typeof s.salary.current_mean === "number");
assert("summary.salary.target_mean", typeof s.salary.target_mean === "number");
assert("summary.salary.growth", typeof s.salary.growth === "number");
assert("summary.salary.growth_pct", typeof s.salary.growth_pct === "number");
assert("summary.visa.eligible_routes", typeof s.visa.eligible_routes === "number");

// ── Data sections ──────────────────────────────────────────────────────────
console.log("\n── Career Pack: Data sections ──");
const d = pack.data;

// Roadmap
assert("data.roadmap exists", d.roadmap !== null);
assert("roadmap.reachable", d.roadmap.reachable === true);
assert("roadmap.steps is array", Array.isArray(d.roadmap.steps) && d.roadmap.steps.length >= 2);
assert("roadmap.summary.total_steps", d.roadmap.summary.total_steps >= 1);

// Skills gap
assert("data.skills_gap exists", d.skills_gap !== null);
assert("skills_gap.analysis.readiness_pct", typeof d.skills_gap.analysis.readiness_pct === "number");
assert("skills_gap.analysis.matched", Array.isArray(d.skills_gap.analysis.matched));
assert("skills_gap.analysis.missing", Array.isArray(d.skills_gap.analysis.missing));
assert("skills_gap.prioritised_learning_path", Array.isArray(d.skills_gap.prioritised_learning_path));

// Resume blueprint
assert("data.resume_blueprint exists", d.resume_blueprint !== null);
assert("resume.ats_score", typeof d.resume_blueprint.ats_score.score === "number");
assert("resume.keywords", d.resume_blueprint.keywords.matched.length >= 0);
assert("resume.skills_section", d.resume_blueprint.skills_section !== undefined);
assert("resume.summary_guidance", d.resume_blueprint.summary_guidance.elements.length > 0);
assert("resume.experience_guidance", d.resume_blueprint.experience_guidance.guidance.length > 0);
assert("resume.formatting_rules", d.resume_blueprint.formatting_rules.ats_tips.length > 0);

// LinkedIn optimisation
assert("data.linkedin_optimisation exists", d.linkedin_optimisation !== null);
assert("linkedin.headlines", d.linkedin_optimisation.headlines.length >= 3);
assert("linkedin.about_section", d.linkedin_optimisation.about_section.paragraphs.length > 0);
assert("linkedin.skills_strategy", d.linkedin_optimisation.skills_strategy.top_3.length > 0);
assert("linkedin.strength_score", typeof d.linkedin_optimisation.strength_score.score === "number");

// Interview prep
assert("data.interview_prep exists", d.interview_prep !== null);
assert("interview.readiness", typeof d.interview_prep.readiness.score === "number");
assert("interview.competency_questions", d.interview_prep.competency_questions.length >= 3);
assert("interview.technical_questions", d.interview_prep.technical_questions.length >= 1);
assert("interview.behavioural_questions", d.interview_prep.behavioural_questions.length >= 4);
assert("interview.star_preparation", d.interview_prep.star_preparation.stories_to_prepare.length > 0);
assert("interview.questions_to_ask", d.interview_prep.questions_to_ask.length >= 5);
assert("interview.salary_negotiation", d.interview_prep.salary_negotiation !== null);
assert("interview.weakness_strategy", d.interview_prep.weakness_strategy.length >= 1);

// Salary insight
assert("data.salary_insight exists", d.salary_insight !== null);
assert("salary.current_role.mean", typeof d.salary_insight.current_role.mean === "number");
assert("salary.target_role.mean", typeof d.salary_insight.target_role.mean === "number");
assert("salary.comparison", d.salary_insight.comparison !== null);

// Visa assessment
assert("data.visa_assessment exists", d.visa_assessment !== null);
assert("visa.disclaimer", d.visa_assessment.disclaimer.length > 0);
assert("visa.routes.skilled_worker", d.visa_assessment.routes.skilled_worker !== undefined);
assert("visa.routes.global_talent", d.visa_assessment.routes.global_talent !== undefined);
assert("visa.salary_gap", d.visa_assessment.salary_gap !== undefined);

// ══════════════════════════════════════════════════════════════════════════════
// CAREER PACK — Edge cases
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Career Pack: Edge cases ──");

// Missing role
const packNoRole = buildCareerPack({ role: "", target: "data-architect", skills: ["SQL"] });
assert("missing role → ok: false", packNoRole.ok === false);
assert("missing role → has errors", packNoRole.errors.length > 0);

// Missing target
const packNoTarget = buildCareerPack({ role: "data-analyst", target: "", skills: ["SQL"] });
assert("missing target → ok: false", packNoTarget.ok === false);

// Missing skills
const packNoSkills = buildCareerPack({ role: "data-analyst", target: "data-architect", skills: [] });
assert("empty skills → ok: false", packNoSkills.ok === false);

// Invalid role slug
const packBadRole = buildCareerPack({ role: "zzz-fake", target: "data-architect", skills: ["SQL"] });
assert("invalid role slug → ok: false", packBadRole.ok === false);
assert("invalid role slug → error mentions slug", packBadRole.errors.some((e) => e.includes("zzz-fake")));

// Invalid target slug
const packBadTarget = buildCareerPack({ role: "data-analyst", target: "zzz-fake", skills: ["SQL"] });
assert("invalid target slug → ok: false", packBadTarget.ok === false);

// Without yearsExp (should still work)
const packNoExp = buildCareerPack({
  role: "data-analyst",
  target: "data-architect",
  skills: ["SQL", "Python"],
});
assert("pack without yearsExp works", packNoExp.ok === true);
assert("years_exp is null when omitted", packNoExp.input.years_exp === null);

// Same role as target (edge case)
const packSameRole = buildCareerPack({
  role: "data-analyst",
  target: "data-analyst",
  skills: ["SQL", "Python", "Excel"],
  yearsExp: 3,
});
assert("same role → target still builds", packSameRole.ok === true);

// ══════════════════════════════════════════════════════════════════════════════
// CAREER PACK — Cross-category
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Career Pack: Cross-category ──");

const packCross = buildCareerPack({
  role: "data-analyst",
  target: "product-manager",
  skills: ["SQL", "Data Visualization", "Stakeholder Management"],
  yearsExp: 4,
});
assert("cross-category pack builds ok", packCross.ok === true);
assert("cross-category has roadmap", packCross.data.roadmap !== null);
assert("cross-category has skills_gap", packCross.data.skills_gap !== null);
assert("cross-category summary shows different categories", packCross.summary.from.category !== packCross.summary.to.category);

// ══════════════════════════════════════════════════════════════════════════════
// PACK SERIALISATION (export readiness)
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Career Pack: Export serialisation ──");

const json = JSON.stringify(pack);
assert("pack serialises to JSON", typeof json === "string");
assert("serialised JSON is parseable", JSON.parse(json).ok === true);
assert("serialised size > 5KB (rich pack)", Buffer.byteLength(json, "utf-8") > 5000);

const parsed = JSON.parse(json);
assert("round-trip preserves pack_id", parsed.pack_id === pack.pack_id);
assert("round-trip preserves summary", parsed.summary.overall_readiness === pack.summary.overall_readiness);
assert("round-trip preserves all 7 data sections", Object.keys(parsed.data).length === 7);

// ══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n══════════════════════════════════════");
console.log(`  TOTAL: ${pass + fail}  |  ✅ PASS: ${pass}  |  ❌ FAIL: ${fail}`);
console.log("══════════════════════════════════════\n");

process.exit(fail > 0 ? 1 : 0);
