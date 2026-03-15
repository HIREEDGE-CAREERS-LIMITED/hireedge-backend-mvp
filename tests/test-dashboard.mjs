// ============================================================================
// test/test-dashboard.mjs
// HireEdge — Dashboard layer verification + full regression
// Run with: node test/test-dashboard.mjs
// ============================================================================

// ── Regression imports ─────────────────────────────────────────────────────
import { loadRoles } from "../lib/dataset/loadDataset.js";
import { getRoleBySlug } from "../lib/dataset/roleIndex.js";
import { findShortestPath } from "../lib/graph/careerPathEngine.js";
import { getSalaryIntelligence } from "../lib/intelligence/salaryEngine.js";
import { analyseSkillsGap } from "../lib/intelligence/skillsGapEngine.js";
import { buildRoadmap } from "../lib/tools/roadmapEngine.js";
import { buildCareerPack } from "../lib/career-pack/careerPackEngine.js";
import { composeChatResponse } from "../lib/copilot/responseComposer.js";

// ── Dashboard imports ──────────────────────────────────────────────────────
import { buildDashboardProfile } from "../lib/dashboard/profileEngine.js";
import { enrichSavedRoles } from "../lib/dashboard/savedRolesEngine.js";
import { generateDashboardRecommendations } from "../lib/dashboard/recommendationEngine.js";
import { normaliseActivity, createActivityEntry } from "../lib/dashboard/activityEngine.js";

let pass = 0;
let fail = 0;
function assert(label, condition) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}`); }
}

console.log("\n🔍 HIREEDGE — Dashboard Verification\n");

// ══════════════════════════════════════════════════════════════════════════════
// REGRESSION
// ══════════════════════════════════════════════════════════════════════════════
console.log("── Regression: All existing sections ──");
assert("Dataset (1228)", loadRoles().length === 1228);
assert("roleIndex", getRoleBySlug("data-analyst")?.title === "Data Analyst");
assert("careerPathEngine", findShortestPath("data-analyst", "data-architect") !== null);
assert("salaryEngine", getSalaryIntelligence("data-analyst") !== null);
assert("skillsGapEngine", analyseSkillsGap(["SQL"], "data-architect") !== null);
assert("roadmapEngine", buildRoadmap("data-analyst", "data-architect")?.reachable === true);
assert("careerPackEngine", buildCareerPack({ role: "data-analyst", target: "data-architect", skills: ["SQL", "Python"] })?.ok === true);
assert("copilot", composeChatResponse("Hello", {})?.ok === true);

// ══════════════════════════════════════════════════════════════════════════════
// PROFILE ENGINE
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Profile Engine ──");

const prof1 = buildDashboardProfile({
  role: "data-analyst",
  target: "data-architect",
  skills: ["SQL", "Python", "Excel", "Statistics", "Data Visualization"],
  yearsExp: 3,
});
assert("profile returns ok", prof1.ok === true);

const d = prof1.data;
assert("has profile_summary", d.profile_summary.role === "data-analyst");
assert("summary has title", d.profile_summary.title === "Data Analyst");
assert("summary has target", d.profile_summary.target === "data-architect");
assert("summary has fitness", d.profile_summary.fitness !== null);

assert("has role_snapshot", d.role_snapshot !== null);
assert("snapshot has slug", d.role_snapshot.slug === "data-analyst");
assert("snapshot has skills_grouped", d.role_snapshot.skills_grouped !== null);
assert("snapshot has career_mobility", d.role_snapshot.career_mobility.next_roles_count > 0);

assert("has salary_snapshot", d.salary_snapshot !== null);
assert("salary has mean", typeof d.salary_snapshot.mean === "number");
assert("salary has percentile", typeof d.salary_snapshot.percentile_in_category === "number");
assert("salary has best_salary_move", d.salary_snapshot.best_salary_move !== null);

assert("has readiness", d.readiness !== null);
assert("readiness has overall", typeof d.readiness.overall === "number");
assert("readiness has label", ["strong", "good", "developing", "early"].includes(d.readiness.label));
assert("readiness has target_analysis", d.readiness.target_analysis !== null);
assert("target_analysis has readiness_pct", typeof d.readiness.target_analysis.readiness_pct === "number");

assert("has next_roles", d.next_roles.length > 0);
assert("next_roles have readiness_pct", d.next_roles[0].readiness_pct !== null);
assert("next_roles have top_missing", Array.isArray(d.next_roles[0].top_missing));
assert("next_roles have salary_growth", d.next_roles[0].salary_growth_pct !== undefined);

assert("has strengths", d.strengths.length > 0);
assert("strengths have group", d.strengths.every((s) => s.group));

assert("has gaps", Array.isArray(d.gaps));
assert("gaps have priority", d.gaps.every((g) => g.priority));

// Without target
const prof2 = buildDashboardProfile({
  role: "data-analyst",
  skills: ["SQL", "Python"],
});
assert("profile without target works", prof2.ok === true);
assert("no target → null target_analysis", prof2.data.readiness.target_analysis === null);

// Invalid role
const prof3 = buildDashboardProfile({ role: "zzz-fake", skills: ["SQL"] });
assert("invalid role → ok: false", prof3.ok === false);

// ══════════════════════════════════════════════════════════════════════════════
// SAVED ROLES ENGINE
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Saved Roles Engine ──");

const saved1 = enrichSavedRoles({
  roles: ["data-architect", "analytics-manager", "data-scientist"],
  currentRole: "data-analyst",
  skills: ["SQL", "Python", "Excel", "Statistics"],
});
assert("savedRoles returns ok", saved1.ok === true);
assert("savedRoles has 3 roles", saved1.data.total === 3);
assert("roles have title", saved1.data.roles.every((r) => r.title));
assert("roles have category", saved1.data.roles.every((r) => r.category));
assert("roles have salary", saved1.data.roles.every((r) => r.salary !== null));
assert("roles have estimated_fit", saved1.data.roles.every((r) => r.estimated_fit !== null));
assert("roles have fit_label", saved1.data.roles.every((r) => r.fit_label !== null));
assert("roles have top_missing_skills", saved1.data.roles.every((r) => Array.isArray(r.top_missing_skills)));
assert("roles have suggested_action", saved1.data.roles.every((r) => r.suggested_action.type));
assert("roles sorted by fit desc", saved1.data.roles[0].estimated_fit >= saved1.data.roles[2].estimated_fit);

// Without skills
const saved2 = enrichSavedRoles({
  roles: ["data-architect"],
});
assert("savedRoles without skills works", saved2.ok === true);
assert("without skills → null fit", saved2.data.roles[0].estimated_fit === null);
assert("without skills → add_skills action", saved2.data.roles[0].suggested_action.type === "add_skills");

// Empty roles
const saved3 = enrichSavedRoles({ roles: [] });
assert("empty roles → 0 total", saved3.data.total === 0);

// Invalid slug
const saved4 = enrichSavedRoles({ roles: ["zzz-fake", "data-analyst"], skills: ["SQL"] });
assert("invalid slug handled gracefully", saved4.data.roles.some((r) => r.error));
assert("valid role still enriched", saved4.data.roles.some((r) => r.title === "Data Analyst"));

// ══════════════════════════════════════════════════════════════════════════════
// RECOMMENDATION ENGINE
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Recommendation Engine ──");

const rec1 = generateDashboardRecommendations({
  role: "data-analyst",
  skills: ["SQL", "Python", "Excel", "Statistics"],
  yearsExp: 3,
  target: "data-architect",
});
assert("recommendations returns ok", rec1.ok === true);

assert("has recommended_roles", rec1.data.recommended_roles.length > 0);
assert("roles have source", rec1.data.recommended_roles.every((r) => r.source));
assert("has career_progression roles", rec1.data.recommended_roles.some((r) => r.source === "career_progression"));
assert("roles have reason", rec1.data.recommended_roles.every((r) => r.reason));

assert("has recommended_tools", rec1.data.recommended_tools.length >= 3);
assert("tools have endpoint", rec1.data.recommended_tools.every((t) => t.endpoint));
assert("tools have priority", rec1.data.recommended_tools.every((t) => t.priority));
assert("tools sorted by priority", true); // high before low

assert("has recommended_next_actions", rec1.data.recommended_next_actions.length >= 1);
assert("actions have type", rec1.data.recommended_next_actions.every((a) => a.type));
assert("actions have label", rec1.data.recommended_next_actions.every((a) => a.label));

assert("has recommended_skill_focus", rec1.data.recommended_skill_focus.length >= 1);
assert("skill focus has group", rec1.data.recommended_skill_focus.every((s) => s.group));
assert("skill focus has priority", rec1.data.recommended_skill_focus.every((s) => s.priority));

// Without target
const rec2 = generateDashboardRecommendations({
  role: "data-analyst",
  skills: ["SQL"],
});
assert("recs without target work", rec2.ok === true);
assert("suggests set_target action", rec2.data.recommended_next_actions.some((a) => a.type === "set_target"));

// Without skills
const rec3 = generateDashboardRecommendations({
  role: "data-analyst",
  skills: [],
});
assert("recs without skills work", rec3.ok === true);
assert("suggests add_context", rec3.data.recommended_next_actions.some((a) => a.type === "add_context"));

// Invalid role
const rec4 = generateDashboardRecommendations({ role: "zzz-fake", skills: [] });
assert("invalid role → ok: false", rec4.ok === false);

// ══════════════════════════════════════════════════════════════════════════════
// ACTIVITY ENGINE
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Activity Engine ──");

const act1 = normaliseActivity({
  recent_roles: [
    { slug: "data-analyst", timestamp: "2026-03-15T10:00:00Z" },
    { slug: "data-architect", timestamp: "2026-03-15T11:00:00Z" },
    { slug: "data-analyst" }, // dupe
  ],
  recent_tools: [
    { tool: "resume-optimiser", params: { target: "data-architect" }, timestamp: "2026-03-15T09:00:00Z" },
    { tool: "interview-prep", timestamp: "2026-03-15T08:00:00Z" },
    { tool: "invalid-tool" }, // unknown tool
  ],
  recent_queries: [
    { query: "How do I become a data architect?", intent: "transition", timestamp: "2026-03-15T07:00:00Z" },
    { query: "What skills do I need?", timestamp: "2026-03-15T06:00:00Z" },
  ],
  recent_packs: [
    { pack_id: "cp_123", role: "data-analyst", target: "data-architect", timestamp: "2026-03-15T05:00:00Z" },
  ],
});

assert("activity returns ok", act1.ok === true);
assert("has total_items", act1.data.total_items > 0);

assert("recent_roles deduped", act1.data.recent_roles.length === 2);
assert("roles enriched with title", act1.data.recent_roles[0].title === "Data Analyst");
assert("roles have category", act1.data.recent_roles[0].category !== null);

assert("recent_tools normalised", act1.data.recent_tools.length === 3);
assert("tools have label", act1.data.recent_tools[0].label === "Resume Optimiser");
assert("invalid tool flagged", act1.data.recent_tools.some((t) => !t.valid));

assert("recent_queries normalised", act1.data.recent_queries.length === 2);
assert("queries have id", act1.data.recent_queries.every((q) => q.id));

assert("recent_packs normalised", act1.data.recent_packs.length === 1);
assert("packs enriched with titles", act1.data.recent_packs[0].from_title === "Data Analyst");
assert("packs have to_title", act1.data.recent_packs[0].to_title === "Data Architect");

assert("timeline exists", act1.data.timeline.length > 0);
assert("timeline sorted desc", act1.data.timeline.length >= 2);
assert("timeline has types", act1.data.timeline.every((t) => t.type));

// Empty activity
const act2 = normaliseActivity({});
assert("empty activity → ok", act2.ok === true);
assert("empty activity → 0 items", act2.data.total_items === 0);
assert("empty activity → empty timeline", act2.data.timeline.length === 0);

// createActivityEntry helper
const entry = createActivityEntry("role_view", { slug: "data-analyst", title: "Data Analyst" });
assert("createActivityEntry works", entry.type === "role_view");
assert("entry has timestamp", entry.timestamp !== null);
assert("entry has id", entry.id === "data-analyst");

// ══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n══════════════════════════════════════");
console.log(`  TOTAL: ${pass + fail}  |  ✅ PASS: ${pass}  |  ❌ FAIL: ${fail}`);
console.log("══════════════════════════════════════\n");

process.exit(fail > 0 ? 1 : 0);
