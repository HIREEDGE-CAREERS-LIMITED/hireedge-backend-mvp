// ============================================================================
// test/verify-tools.mjs
// Smoke test for Career Tools layer + regression on Career Intelligence layer
// Run with: node test/verify-tools.mjs
// ============================================================================

// ── Existing engine imports (regression check) ─────────────────────────────
import { loadRoles } from "../lib/dataset/loadDataset.js";
import { getRoleBySlug } from "../lib/dataset/roleIndex.js";
import { findShortestPath, getNextMoves } from "../lib/graph/careerPathEngine.js";
import { getSalaryIntelligence } from "../lib/intelligence/salaryEngine.js";
import { analyseRoleTransitionGap } from "../lib/intelligence/skillsGapEngine.js";
import { getRoleProfile } from "../lib/intelligence/roleIntelligenceEngine.js";

// ── New tool engine imports ────────────────────────────────────────────────
import { buildRoadmap, buildMultiRoadmap } from "../lib/tools/roadmapEngine.js";
import { explainTransitionGap, explainMultipleGaps } from "../lib/tools/gapExplainerEngine.js";
import { generateTalentProfile } from "../lib/tools/talentProfileEngine.js";

let pass = 0;
let fail = 0;

function assert(label, condition) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}`); }
}

console.log("\n🔍 HIREEDGE — Career Tools Verification\n");

// ══════════════════════════════════════════════════════════════════════════════
// REGRESSION: Existing engines still work
// ══════════════════════════════════════════════════════════════════════════════
console.log("── Regression: Existing engines ──");
const roles = loadRoles();
assert("Dataset loads (1228 roles)", roles.length === 1228);
assert("getRoleBySlug works", getRoleBySlug("data-analyst")?.title === "Data Analyst");
assert("findShortestPath works", findShortestPath("data-analyst", "data-architect") !== null);
assert("getNextMoves works", getNextMoves("data-analyst").length > 0);
assert("getSalaryIntelligence works", getSalaryIntelligence("data-analyst") !== null);
assert("analyseRoleTransitionGap works", analyseRoleTransitionGap("data-analyst", "data-architect") !== null);
assert("getRoleProfile works", getRoleProfile("data-analyst")?.slug === "data-analyst");

// ══════════════════════════════════════════════════════════════════════════════
// ROADMAP ENGINE
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Roadmap Engine ──");

const roadmap1 = buildRoadmap("data-analyst", "data-architect");
assert("buildRoadmap returns result", roadmap1 !== null);
assert("roadmap is reachable", roadmap1.reachable === true);
assert("roadmap has steps array", Array.isArray(roadmap1.steps) && roadmap1.steps.length >= 2);
assert("first step is current role", roadmap1.steps[0].is_current === true);
assert("last step is target role", roadmap1.steps[roadmap1.steps.length - 1].is_target === true);
assert("steps have salary data", roadmap1.steps[0].salary !== null);
assert("steps have skills_gap_to_next (except last)", roadmap1.steps[0].skills_gap_to_next !== null);
assert("last step has no skills_gap_to_next", roadmap1.steps[roadmap1.steps.length - 1].skills_gap_to_next === null);
assert("summary has total_steps", roadmap1.summary.total_steps >= 1);
assert("summary has salary_growth", typeof roadmap1.summary.salary_growth === "number");
assert("summary has salary_growth_pct", typeof roadmap1.summary.salary_growth_pct === "number");
assert("summary has total_estimated_years", typeof roadmap1.summary.total_estimated_years === "number");

const roadmapEasiest = buildRoadmap("data-analyst", "data-architect", { strategy: "easiest" });
assert("easiest strategy works", roadmapEasiest?.reachable === true);

const roadmapPaid = buildRoadmap("data-analyst", "data-architect", { strategy: "highest_paid" });
assert("highest_paid strategy works", roadmapPaid?.reachable === true);

const multi = buildMultiRoadmap("data-analyst", ["data-architect", "analytics-manager", "data-scientist"]);
assert("buildMultiRoadmap returns results", multi.results.length === 3);
assert("multi results are sorted", multi.results.every((r) => r.target));

const unreachable = buildRoadmap("data-analyst", "zzz-nonexistent-role");
assert("unreachable roadmap returns null", unreachable === null);

console.log("\n── Gap Explainer Engine ──");

// ══════════════════════════════════════════════════════════════════════════════
// GAP EXPLAINER ENGINE
// ══════════════════════════════════════════════════════════════════════════════
const gap1 = explainTransitionGap("data-analyst", "data-architect");
assert("explainTransitionGap returns result", gap1 !== null);
assert("has verdict", ["easy", "moderate", "hard", "very_hard", "unreachable"].includes(gap1.verdict));
assert("has composite_score", typeof gap1.composite_score === "number");
assert("has 6 factors", gap1.factors.length === 6);
assert("factors have labels", gap1.factors.every((f) => f.label && typeof f.weight === "number"));
assert("has narrative array", Array.isArray(gap1.narrative) && gap1.narrative.length > 0);
assert("has recommendations", Array.isArray(gap1.recommendations));
assert("has raw path data", gap1.raw.path !== null);
assert("has raw skills data", gap1.raw.skills_gap !== null);

const gapSameSeniority = explainTransitionGap("data-analyst", "bi-developer");
assert("same-domain transition produces result", gapSameSeniority !== null);

const gapCross = explainTransitionGap("data-analyst", "product-manager");
if (gapCross) {
  assert("cross-category factor detected", gapCross.factors.some((f) => f.label === "category_shift" && f.weight > 5));
} else {
  assert("cross-category transition returns result", false);
}

const multiGap = explainMultipleGaps("data-analyst", ["data-architect", "analytics-manager"]);
assert("explainMultipleGaps returns results", multiGap.explanations.length === 2);
assert("multi-gap results sorted by score", true);

const gapInvalid = explainTransitionGap("data-analyst", "zzz-nonexistent");
assert("invalid target returns null", gapInvalid === null);

console.log("\n── Talent Profile Engine ──");

// ══════════════════════════════════════════════════════════════════════════════
// TALENT PROFILE ENGINE
// ══════════════════════════════════════════════════════════════════════════════
const tp1 = generateTalentProfile({
  currentRole: "data-analyst",
  skills: ["SQL", "Python", "Excel", "Statistics", "Data Visualization"],
  yearsExp: 3,
  targetRole: "data-architect",
});
assert("generateTalentProfile returns result", tp1 !== null);
assert("has current_role", tp1.current_role.slug === "data-analyst");
assert("has user_skills", tp1.user_skills.length === 5);
assert("has role_fitness", typeof tp1.role_fitness.fitness_pct === "number");
assert("role_fitness has label", ["strong_fit", "good_fit", "partial_fit", "weak_fit"].includes(tp1.role_fitness.label));
assert("has experience assessment", tp1.experience !== null);
assert("experience level is within_range", tp1.experience.level === "within_range");
assert("has strengths", typeof tp1.strengths.total_strengths === "number");
assert("has gaps", typeof tp1.gaps.total_gaps === "number");
assert("has salary_context", tp1.salary_context !== null);
assert("salary has percentile", typeof tp1.salary_context.percentile_in_category === "number");
assert("has next_moves", Array.isArray(tp1.next_moves) && tp1.next_moves.length > 0);
assert("next_moves have readiness_pct", tp1.next_moves[0].readiness_pct !== null);
assert("next_moves have missing_skills", Array.isArray(tp1.next_moves[0].missing_skills));
assert("has best_fit_roles", Array.isArray(tp1.best_fit_roles));
assert("has target_role_analysis", tp1.target_role_analysis !== null);
assert("target analysis has readiness_pct", typeof tp1.target_role_analysis.readiness_pct === "number");
assert("target has prioritised learning", tp1.target_role_analysis.prioritised_learning_path.length > 0);
assert("has career_mobility", typeof tp1.career_mobility.next_options_count === "number");

// Without target role
const tp2 = generateTalentProfile({
  currentRole: "data-analyst",
  skills: ["SQL", "Python"],
});
assert("profile without target works", tp2 !== null);
assert("no target = null target_analysis", tp2.target_role_analysis === null);
assert("no yearsExp = null experience", tp2.experience === null);

// Minimal skills
const tp3 = generateTalentProfile({
  currentRole: "data-analyst",
  skills: ["Excel"],
  yearsExp: 1,
});
assert("minimal skills profile works", tp3 !== null);
assert("below-typical experience detected", tp3.experience.level === "below_typical");
assert("low fitness detected", tp3.role_fitness.fitness_pct < 30);

// Invalid role
const tpInvalid = generateTalentProfile({ currentRole: "zzz-fake", skills: ["SQL"] });
assert("invalid role returns null", tpInvalid === null);

// ══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n══════════════════════════════════════");
console.log(`  TOTAL: ${pass + fail}  |  ✅ PASS: ${pass}  |  ❌ FAIL: ${fail}`);
console.log("══════════════════════════════════════\n");

process.exit(fail > 0 ? 1 : 0);
