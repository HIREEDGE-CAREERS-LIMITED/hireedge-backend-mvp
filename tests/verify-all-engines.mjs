// ============================================================================
// test/verify-all-engines.mjs
// Quick smoke test — run with: node test/verify-all-engines.mjs
// ============================================================================

import { loadDataset, loadRoles } from "../lib/dataset/loadDataset.js";
import { getRoleBySlug, searchRoles, getCategories } from "../lib/dataset/roleIndex.js";
import { getNextEdges, getPreviousEdges, getNodeCount, getEdgeCount } from "../lib/dataset/graphIndex.js";
import { findShortestPath, findAllPaths, getNextMoves, getPreviousMoves } from "../lib/graph/careerPathEngine.js";
import { buildRoleGraph } from "../lib/graph/roleGraphEngine.js";
import { getGraphStats, getHubRoles, getDeadEndRoles, getEntryPointRoles, getCategoryBridges } from "../lib/graph/graphMetaEngine.js";
import { getRoleProfile, compareRoles, getCategoryIntelligence, searchRoleIntelligence, listCategories } from "../lib/intelligence/roleIntelligenceEngine.js";
import { getSalaryIntelligence, compareSalaries, getTopPayingRoles, getSalaryBySeniority } from "../lib/intelligence/salaryEngine.js";
import { analyseSkillsGap, analyseRoleTransitionGap, findRolesMatchingSkills } from "../lib/intelligence/skillsGapEngine.js";

let pass = 0;
let fail = 0;

function assert(label, condition) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}`); }
}

console.log("\n🔍 HIREEDGE — Engine Verification\n");

// ── Dataset ────────────────────────────────────────────────────────────────
console.log("── Dataset Layer ──");
const ds = loadDataset();
assert("loadDataset returns version", ds.version === "expanded-v1");
assert("loadDataset has 1228 roles", ds.total === 1228);

const roles = loadRoles();
assert("loadRoles returns array", Array.isArray(roles) && roles.length === 1228);

// ── Role Index ─────────────────────────────────────────────────────────────
console.log("\n── Role Index ──");
const da = getRoleBySlug("data-analyst");
assert("getRoleBySlug finds data-analyst", da?.title === "Data Analyst");
assert("getRoleBySlug returns undefined for junk", getRoleBySlug("xxx-fake") === undefined);

const search = searchRoles("data");
assert("searchRoles('data') returns results", search.length > 5);

const cats = getCategories();
assert("getCategories returns 27 categories", cats.length === 27);

// ── Graph Index ────────────────────────────────────────────────────────────
console.log("\n── Graph Index ──");
assert("getNodeCount > 1000", getNodeCount() > 1000);
assert("getEdgeCount > 0", getEdgeCount() > 0);

const nextDA = getNextEdges("data-analyst");
assert("data-analyst has next edges", nextDA.length > 0);

const prevSDA = getPreviousEdges("senior-data-analyst");
assert("senior-data-analyst has previous edges", prevSDA.length > 0);

// ── Career Path Engine ─────────────────────────────────────────────────────
console.log("\n── Career Path Engine ──");
const shortest = findShortestPath("data-analyst", "data-architect");
assert("shortest path data-analyst → data-architect exists", shortest !== null);
assert("shortest path has steps", shortest?.steps >= 1);

const allPaths = findAllPaths("data-analyst", "data-architect", { maxDepth: 4, maxResults: 5 });
assert("findAllPaths returns results", allPaths.length >= 1);

const nextMoves = getNextMoves("data-analyst", { sortBy: "salary" });
assert("getNextMoves returns career options", nextMoves.length > 0);

const prevMoves = getPreviousMoves("senior-data-analyst");
assert("getPreviousMoves returns feeder roles", prevMoves.length > 0);

// ── Role Graph Engine ──────────────────────────────────────────────────────
console.log("\n── Role Graph Engine ──");
const graph = buildRoleGraph("data-analyst", { depth: 2, includeAdjacent: true });
assert("buildRoleGraph returns nodes", graph.nodes.length > 0);
assert("buildRoleGraph returns edges", graph.edges.length > 0);
assert("center is data-analyst", graph.center === "data-analyst");

// ── Graph Meta Engine ──────────────────────────────────────────────────────
console.log("\n── Graph Meta Engine ──");
const stats = getGraphStats();
assert("getGraphStats returns total_roles", stats.total_roles === 1228);
assert("getGraphStats has categories", Object.keys(stats.categories).length > 10);

const hubs = getHubRoles({ limit: 5 });
assert("getHubRoles returns roles", hubs.length === 5);
assert("hub roles have total_connections", hubs[0].total_connections > 0);

const deadends = getDeadEndRoles({ limit: 5 });
assert("getDeadEndRoles returns roles", deadends.length > 0);

const entries = getEntryPointRoles({ limit: 5 });
assert("getEntryPointRoles returns roles", entries.length > 0);

const bridges = getCategoryBridges({ limit: 5 });
assert("getCategoryBridges returns cross-category edges", bridges.length > 0);

// ── Role Intelligence Engine ───────────────────────────────────────────────
console.log("\n── Role Intelligence Engine ──");
const profile = getRoleProfile("data-analyst");
assert("getRoleProfile returns full profile", profile?.slug === "data-analyst");
assert("profile has career_mobility", profile?.career_mobility?.next_roles_count > 0);

const comparison = compareRoles("data-analyst", "data-engineer");
assert("compareRoles returns comparison", comparison !== null);
assert("comparison has skills overlap", comparison?.skills_comparison?.overlap_pct >= 0);

const catIntel = getCategoryIntelligence("Data & AI");
assert("getCategoryIntelligence returns data", catIntel?.total_roles > 0);

const searchIntel = searchRoleIntelligence("engineer");
assert("searchRoleIntelligence returns results", searchIntel.length > 0);

const allCats = listCategories();
assert("listCategories matches getCategories", allCats.length === 27);

// ── Salary Engine ──────────────────────────────────────────────────────────
console.log("\n── Salary Engine ──");
const salaryDA = getSalaryIntelligence("data-analyst");
assert("getSalaryIntelligence returns data", salaryDA !== null);
assert("salary has category_benchmark", salaryDA?.category_benchmark?.percentile_in_category >= 0);
assert("salary has progression options", salaryDA?.progression?.length > 0);

const salaryCompare = compareSalaries(["data-analyst", "data-engineer", "data-scientist"]);
assert("compareSalaries returns summary", salaryCompare?.summary?.count === 3);

const topPaying = getTopPayingRoles({ category: "Data & AI", limit: 5 });
assert("getTopPayingRoles returns roles", topPaying.length > 0);

const bySen = getSalaryBySeniority("Data & AI");
assert("getSalaryBySeniority returns groups", Object.keys(bySen.seniority_salary).length > 0);

// ── Skills Gap Engine ──────────────────────────────────────────────────────
console.log("\n── Skills Gap Engine ──");
const gap = analyseSkillsGap(["SQL", "Python", "Excel"], "data-architect");
assert("analyseSkillsGap returns analysis", gap !== null);
assert("gap has readiness_pct", gap?.analysis?.readiness_pct >= 0);
assert("gap has prioritised learning path", gap?.prioritised_learning_path?.length > 0);

const transGap = analyseRoleTransitionGap("data-analyst", "data-architect");
assert("analyseRoleTransitionGap returns data", transGap !== null);
assert("transition gap has overlap_pct", transGap?.skills_analysis?.overlap_pct >= 0);

const matching = findRolesMatchingSkills(["SQL", "Python", "Machine Learning"], { limit: 10 });
assert("findRolesMatchingSkills returns roles", matching.length > 0);
assert("matching roles sorted by match_pct", matching[0].match_pct >= matching[matching.length - 1].match_pct);

// ── Summary ────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════");
console.log(`  TOTAL: ${pass + fail}  |  ✅ PASS: ${pass}  |  ❌ FAIL: ${fail}`);
console.log("══════════════════════════════════════\n");

process.exit(fail > 0 ? 1 : 0);
