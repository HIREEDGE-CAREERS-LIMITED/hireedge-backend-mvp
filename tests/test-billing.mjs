// ============================================================================
// test/test-billing.mjs
// HireEdge — Billing & Access Control verification + full regression
// Run with: node test/test-billing.mjs
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
import { buildDashboardProfile } from "../lib/dashboard/profileEngine.js";

// ── Billing imports ────────────────────────────────────────────────────────
import { PLANS, getPlan, listPlanIds, isFreeTool } from "../lib/billing/planLimits.js";
import { checkAccess, resolveUser } from "../lib/billing/accessControl.js";
import { trackUsage, getUsage, getUsageSummary, resetUsage, seedUsage } from "../lib/billing/usageTracker.js";
import { STRIPE_PRODUCTS, getCheckoutConfig, listProducts } from "../lib/billing/stripeProducts.js";
import { enforceBilling } from "../lib/billing/billingMiddleware.js";

let pass = 0;
let fail = 0;
function assert(label, condition) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}`); }
}

console.log("\n🔍 HIREEDGE — Billing & Access Control Verification\n");

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
assert("dashboard", buildDashboardProfile({ role: "data-analyst", skills: ["SQL"] })?.ok === true);

// ══════════════════════════════════════════════════════════════════════════════
// PLAN LIMITS
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Plan Limits ──");

assert("4 plans defined", listPlanIds().length === 4);
assert("plans: free, career_pack, pro, elite", listPlanIds().includes("free") && listPlanIds().includes("elite"));

const freePlan = getPlan("free");
assert("free plan has 10 copilot msgs/day", freePlan.copilot_messages_per_day === 10);
assert("free plan has 15 tools/day", freePlan.tools_per_day === 15);
assert("free plan no career_pack_access", freePlan.career_pack_access === false);
assert("free plan not unlimited", freePlan.unlimited === false);

const proPlan = getPlan("pro");
assert("pro has career_pack_access", proPlan.career_pack_access === true);
assert("pro has 100 copilot msgs/day", proPlan.copilot_messages_per_day === 100);
assert("pro includes resume-optimiser", proPlan.allowed_tools.has("resume-optimiser"));
assert("pro includes interview-prep", proPlan.allowed_tools.has("interview-prep"));

const elitePlan = getPlan("elite");
assert("elite is unlimited", elitePlan.unlimited === true);
assert("elite copilot = Infinity", elitePlan.copilot_messages_per_day === Infinity);

assert("unknown plan defaults to free", getPlan("zzz").id === "free");

assert("talent-profile is free tool", isFreeTool("talent-profile"));
assert("resume-optimiser is NOT free tool", !isFreeTool("resume-optimiser"));
assert("career-gap-explainer is free tool", isFreeTool("career-gap-explainer"));

// ══════════════════════════════════════════════════════════════════════════════
// ACCESS CONTROL
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Access Control ──");
resetUsage("test-user-free");
resetUsage("test-user-pro");
resetUsage("test-user-elite");
resetUsage("test-user-cp");

// Free user — free tools allowed
const freeUserFree = checkAccess({ id: "test-user-free", plan: "free" }, "talent-profile");
assert("free user → free tool: allowed", freeUserFree.allowed === true);

// Free user — premium tool blocked
const freeUserPremium = checkAccess({ id: "test-user-free", plan: "free" }, "resume-optimiser");
assert("free user → premium tool: blocked", freeUserPremium.allowed === false);
assert("blocked reason: tool_not_in_plan", freeUserPremium.reason === "tool_not_in_plan");
assert("suggests upgrade to pro", freeUserPremium.upgrade_to === "pro");

// Free user — career pack blocked
const freeUserPack = checkAccess({ id: "test-user-free", plan: "free" }, "career-pack-build");
assert("free user → career pack: blocked", freeUserPack.allowed === false);
assert("blocked reason: career_pack_required", freeUserPack.reason === "career_pack_required");

// Career Pack user — career pack allowed
const cpUserPack = checkAccess({ id: "test-user-cp", plan: "career_pack" }, "career-pack-build");
assert("career_pack user → career pack: allowed", cpUserPack.allowed === true);

// Career Pack user — premium tool still blocked
const cpUserPremium = checkAccess({ id: "test-user-cp", plan: "career_pack" }, "resume-optimiser");
assert("career_pack user → resume-optimiser: blocked", cpUserPremium.allowed === false);

// Pro user — all tools allowed
const proUserPremium = checkAccess({ id: "test-user-pro", plan: "pro" }, "resume-optimiser");
assert("pro user → premium tool: allowed", proUserPremium.allowed === true);

const proUserPack = checkAccess({ id: "test-user-pro", plan: "pro" }, "career-pack-build");
assert("pro user → career pack: allowed", proUserPack.allowed === true);

// Elite — everything allowed
const eliteUser = checkAccess({ id: "test-user-elite", plan: "elite" }, "resume-optimiser");
assert("elite user → always allowed", eliteUser.allowed === true);

// Copilot daily limit
seedUsage("test-limit-user", { "copilot-chat": 10 });
const limitHit = checkAccess({ id: "test-limit-user", plan: "free" }, "copilot-chat");
assert("copilot limit (10/10) → blocked", limitHit.allowed === false);
assert("blocked reason: daily_limit_reached", limitHit.reason === "daily_limit_reached");

// Copilot under limit
resetUsage("test-limit-user2");
const underLimit = checkAccess({ id: "test-limit-user2", plan: "free" }, "copilot-chat");
assert("copilot under limit → allowed", underLimit.allowed === true);

// Tool daily limit
seedUsage("test-tool-limit", { "tools": 15 });
const toolLimitHit = checkAccess({ id: "test-tool-limit", plan: "free" }, "talent-profile");
assert("tool limit (15/15) → blocked", toolLimitHit.allowed === false);

// resolveUser
const mockReq = { query: { plan: "pro", userId: "u123" }, headers: {}, body: {} };
const resolved = resolveUser(mockReq);
assert("resolveUser from query", resolved.plan === "pro" && resolved.id === "u123");

const mockReqHeader = { query: {}, headers: { "x-hireedge-plan": "elite", "x-hireedge-user-id": "h456" }, body: {} };
const resolvedH = resolveUser(mockReqHeader);
assert("resolveUser from headers (priority)", resolvedH.plan === "elite" && resolvedH.id === "h456");

const mockReqDefault = { query: {}, headers: {}, body: {} };
const resolvedD = resolveUser(mockReqDefault);
assert("resolveUser defaults to free/anonymous", resolvedD.plan === "free" && resolvedD.id === "anonymous");

// ══════════════════════════════════════════════════════════════════════════════
// USAGE TRACKER
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Usage Tracker ──");

resetUsage("tracker-test");

const t1 = trackUsage("tracker-test", "copilot-chat");
assert("trackUsage returns count=1", t1.today === 1);
assert("trackUsage returns tool", t1.tool === "copilot-chat");
assert("trackUsage has timestamp", t1.timestamp !== undefined);

const t2 = trackUsage("tracker-test", "copilot-chat");
assert("second call returns count=2", t2.today === 2);

trackUsage("tracker-test", "resume-optimiser");
trackUsage("tracker-test", "tools");

const usage = getUsage("tracker-test", "copilot-chat");
assert("getUsage returns 2", usage.today === 2);

const summary = getUsageSummary("tracker-test");
assert("getUsageSummary has tools", Object.keys(summary.tools).length >= 2);
assert("getUsageSummary total >= 3", summary.total >= 3);

resetUsage("tracker-test");
assert("resetUsage clears data", getUsage("tracker-test", "copilot-chat").today === 0);

seedUsage("seed-test", { "copilot-chat": 7, "tools": 12 });
assert("seedUsage works", getUsage("seed-test", "copilot-chat").today === 7);
assert("seedUsage tools count", getUsage("seed-test", "tools").today === 12);

// ══════════════════════════════════════════════════════════════════════════════
// STRIPE PRODUCTS
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Stripe Products ──");

assert("3 products defined", Object.keys(STRIPE_PRODUCTS).length === 3);
assert("career_pack product exists", STRIPE_PRODUCTS.career_pack !== undefined);
assert("career_pro product exists", STRIPE_PRODUCTS.career_pro !== undefined);
assert("career_elite product exists", STRIPE_PRODUCTS.career_elite !== undefined);

const checkout = getCheckoutConfig("career_pro", "monthly");
assert("getCheckoutConfig returns config", checkout !== null);
assert("checkout has stripe_price_id", checkout.stripe_price_id !== undefined);
assert("checkout has display_price", checkout.display_price === "£14.99");
assert("checkout has features", checkout.features.length >= 3);
assert("checkout plan_id maps correctly", checkout.plan_id === "pro");

const checkoutYearly = getCheckoutConfig("career_pro", "yearly");
assert("yearly pricing works", checkoutYearly.display_price === "£119.88");

const checkoutCP = getCheckoutConfig("career_pack", "one_time");
assert("career_pack is one_time", checkoutCP.type === "one_time");
assert("career_pack price", checkoutCP.display_price === "£19.99");

assert("invalid product returns null", getCheckoutConfig("zzz") === null);

const products = listProducts();
assert("listProducts returns 3", products.length === 3);
assert("products have prices", products.every((p) => p.prices.length >= 1));

// ══════════════════════════════════════════════════════════════════════════════
// BILLING MIDDLEWARE (simulated handler)
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Billing Middleware ──");

resetUsage("mw-free");
resetUsage("mw-pro");

// Simulate a free user hitting a premium tool
let mwStatus = null;
let mwBody = null;
const mockRes = {
  status(code) { mwStatus = code; return this; },
  json(body) { mwBody = body; return this; },
};

const blocked = enforceBilling(
  { query: { plan: "free", userId: "mw-free" }, headers: {}, body: {} },
  mockRes,
  "resume-optimiser"
);
assert("middleware blocks free → premium", blocked === true);
assert("middleware sends 403", mwStatus === 403);
assert("middleware body has reason", mwBody.reason === "tool_not_in_plan");
assert("middleware body has upgrade_to", mwBody.upgrade_to === "pro");

// Simulate a pro user hitting a premium tool
mwStatus = null;
mwBody = null;
const allowed = enforceBilling(
  { query: { plan: "pro", userId: "mw-pro" }, headers: {}, body: {} },
  mockRes,
  "resume-optimiser"
);
assert("middleware allows pro → premium", allowed === false);
assert("middleware does NOT send response", mwStatus === null);

// Verify usage was tracked
const mwUsage = getUsage("mw-pro", "resume-optimiser");
assert("middleware tracked usage", mwUsage.today === 1);
const mwToolUsage = getUsage("mw-pro", "tools");
assert("middleware tracked aggregate tools", mwToolUsage.today === 1);

// Free user on free tool — allowed
mwStatus = null;
const freeAllowed = enforceBilling(
  { query: { plan: "free", userId: "mw-free" }, headers: {}, body: {} },
  mockRes,
  "talent-profile"
);
assert("middleware allows free → free tool", freeAllowed === false);

// Career pack blocked for free
mwStatus = null;
mwBody = null;
enforceBilling(
  { query: { plan: "free", userId: "mw-free" }, headers: {}, body: {} },
  mockRes,
  "career-pack-build"
);
assert("middleware blocks free → career pack", mwStatus === 403);
assert("career pack block reason", mwBody.reason === "career_pack_required");

// ══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n══════════════════════════════════════");
console.log(`  TOTAL: ${pass + fail}  |  ✅ PASS: ${pass}  |  ❌ FAIL: ${fail}`);
console.log("══════════════════════════════════════\n");

process.exit(fail > 0 ? 1 : 0);
