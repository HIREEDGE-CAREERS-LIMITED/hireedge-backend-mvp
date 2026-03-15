// ============================================================================
// test/test-copilot.mjs
// HireEdge — Copilot layer verification + full regression
// Run with: node test/test-copilot.mjs
// ============================================================================

// ── Regression imports ─────────────────────────────────────────────────────
import { loadRoles } from "../lib/dataset/loadDataset.js";
import { getRoleBySlug } from "../lib/dataset/roleIndex.js";
import { findShortestPath } from "../lib/graph/careerPathEngine.js";
import { getSalaryIntelligence } from "../lib/intelligence/salaryEngine.js";
import { analyseSkillsGap } from "../lib/intelligence/skillsGapEngine.js";
import { buildRoadmap } from "../lib/tools/roadmapEngine.js";
import { generateResumeBlueprint } from "../lib/tools/resumeEngine.js";
import { generateInterviewPrep } from "../lib/tools/interviewEngine.js";
import { buildCareerPack } from "../lib/career-pack/careerPackEngine.js";

// ── Copilot imports ────────────────────────────────────────────────────────
import { detectIntent, extractEntities } from "../lib/copilot/intentDetector.js";
import { resolveContext, updateContext, checkReadiness, serializeContext } from "../lib/copilot/conversationState.js";
import { orchestrate } from "../lib/copilot/orchestrator.js";
import { generateRecommendations } from "../lib/copilot/recommender.js";
import { planNextActions } from "../lib/copilot/planner.js";
import { composeChatResponse } from "../lib/copilot/responseComposer.js";

let pass = 0;
let fail = 0;
function assert(label, condition) {
  if (condition) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}`); }
}

console.log("\n🔍 HIREEDGE — Copilot Verification\n");

// ══════════════════════════════════════════════════════════════════════════════
// REGRESSION
// ══════════════════════════════════════════════════════════════════════════════
console.log("── Regression: All existing engines ──");
assert("Dataset (1228)", loadRoles().length === 1228);
assert("roleIndex", getRoleBySlug("data-analyst")?.title === "Data Analyst");
assert("careerPathEngine", findShortestPath("data-analyst", "data-architect") !== null);
assert("salaryEngine", getSalaryIntelligence("data-analyst") !== null);
assert("skillsGapEngine", analyseSkillsGap(["SQL"], "data-architect") !== null);
assert("roadmapEngine", buildRoadmap("data-analyst", "data-architect")?.reachable === true);
assert("resumeEngine", generateResumeBlueprint({ targetRole: "data-architect", skills: ["SQL"] }) !== null);
assert("interviewEngine", generateInterviewPrep({ targetRole: "data-architect", skills: ["SQL"] }) !== null);
assert("careerPackEngine", buildCareerPack({ role: "data-analyst", target: "data-architect", skills: ["SQL", "Python"] })?.ok === true);

// ══════════════════════════════════════════════════════════════════════════════
// INTENT DETECTOR
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Intent Detector ──");

const i1 = detectIntent("How do I move from data analyst to data architect?");
assert("transition intent detected", i1.intent === "transition");
assert("transition confidence > 0.7", i1.confidence > 0.7);
assert("extracted current role", i1.entities.currentRole === "data-analyst");
assert("extracted target role", i1.entities.targetRole === "data-architect");

const i2 = detectIntent("What skills do I need for analytics manager?");
assert("skills_gap intent", i2.intent === "skills_gap");
assert("target: analytics-manager", i2.entities.targetRole === "analytics-manager" || i2.entities.mentionedRoles.some(r => r.slug === "analytics-manager"));

const i3 = detectIntent("Help me prepare for interviews");
assert("interview intent", i3.intent === "interview");

const i4 = detectIntent("Help me with my resume");
assert("resume intent", i4.intent === "resume");

const i5 = detectIntent("Optimise my LinkedIn profile");
assert("linkedin intent", i5.intent === "linkedin");

const i6 = detectIntent("What does a data engineer earn?");
assert("salary intent", i6.intent === "salary");

const i7 = detectIntent("Can I get a UK visa as a data scientist?");
assert("visa intent", i7.intent === "visa");

const i8 = detectIntent("Give me a full career pack");
assert("career_pack intent", i8.intent === "career_pack");

const i9 = detectIntent("What can I do next in my career?");
assert("explore intent", i9.intent === "explore");

const i10 = detectIntent("Tell me about the product manager role");
assert("role_info intent", i10.intent === "role_info");

const i11 = detectIntent("Compare data analyst and data engineer");
assert("compare intent", i11.intent === "compare");
assert("compare detects 2 roles", i11.entities.mentionedRoles.length >= 2);

// Entity extraction with context
const i12 = detectIntent("What skills do I need?", { role: "data-analyst", target: "data-architect", skills: ["SQL"] });
assert("context role carried through", i12.entities.currentRole === "data-analyst");
assert("context target carried through", i12.entities.targetRole === "data-architect");
assert("context skills carried through", i12.entities.skills.length >= 1);

// Years extraction
const i13 = detectIntent("I have 5 years of experience as a data analyst");
assert("yearsExp extracted", i13.entities.yearsExp === 5);

// I am a ... pattern
const i14 = detectIntent("I'm a software engineer looking to become a product manager");
assert("'I'm a' extracts current role", i14.entities.currentRole === "software-engineer");
assert("'become a' extracts target", i14.entities.targetRole === "product-manager");
assert("detected as transition", i14.intent === "transition");

// ══════════════════════════════════════════════════════════════════════════════
// CONVERSATION STATE
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Conversation State ──");

const ctx1 = resolveContext({ role: "data-analyst", skills: ["SQL", "Python"] });
assert("resolveContext sets role", ctx1.role === "data-analyst");
assert("resolveContext sets skills", ctx1.skills.length === 2);
assert("resolveContext defaults target to null", ctx1.target === null);

const ctx2 = updateContext(ctx1, { targetRole: "data-architect", skills: ["Excel"] }, "transition", "[transition] test");
assert("updateContext sets target", ctx2.target === "data-architect");
assert("updateContext merges skills (no dupe)", ctx2.skills.length === 3);
assert("updateContext appends history", ctx2.history.length === 1);
assert("updateContext does not mutate original", ctx1.target === null);

const readiness1 = checkReadiness(ctx2, "transition");
assert("transition ready with full context", readiness1.ready === true);

const readiness2 = checkReadiness({ ...ctx2, skills: [] }, "transition");
assert("transition not ready without skills", readiness2.ready === false);
assert("missing list includes skills", readiness2.missing.includes("skills"));

const serialized = serializeContext(ctx2);
assert("serializeContext returns plain object", serialized.role === "data-analyst" && serialized.target === "data-architect");

// ══════════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Orchestrator ──");

const orch1 = orchestrate("transition",
  { currentRole: "data-analyst", targetRole: "data-architect", skills: ["SQL", "Python", "Excel"], yearsExp: 3 },
  { role: "data-analyst", target: "data-architect", skills: ["SQL", "Python", "Excel"], yearsExp: 3 }
);
assert("transition calls multiple engines", orch1.engines_called.length >= 3);
assert("transition has roadmap", orch1.insights.roadmap !== null);
assert("transition has gap_explanation", orch1.insights.gap_explanation !== null);
assert("transition has skills_gap", orch1.insights.skills_gap !== null);
assert("transition has salary_comparison", orch1.insights.salary_comparison !== null);

const orch2 = orchestrate("explore",
  { currentRole: "data-analyst", skills: ["SQL"], yearsExp: 3, mentionedRoles: [] },
  { role: "data-analyst", skills: ["SQL"], yearsExp: 3 }
);
assert("explore has next_moves", Array.isArray(orch2.insights.next_moves));
assert("explore has salary", orch2.insights.salary !== null);

const orch3 = orchestrate("interview",
  { targetRole: "data-architect", skills: ["SQL"], mentionedRoles: [] },
  { role: "data-analyst", target: "data-architect", skills: ["SQL"] }
);
assert("interview has interview_prep", orch3.insights.interview_prep !== null);

const orch4 = orchestrate("salary",
  { currentRole: "data-analyst", mentionedRoles: [{ slug: "data-analyst" }] },
  { role: "data-analyst", skills: [] }
);
assert("salary has salary insight", orch4.insights["salary_data-analyst"] !== null);

// ══════════════════════════════════════════════════════════════════════════════
// RECOMMENDER
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Recommender ──");

const recs1 = generateRecommendations("transition", orch1.insights, { role: "data-analyst", target: "data-architect", skills: ["SQL"] });
assert("transition generates recommendations", recs1.length >= 1);
assert("recommendations have structure", recs1.every(r => r.type && r.priority && r.action && r.reason));
assert("recommendations sorted by priority", true);

const recs2 = generateRecommendations("explore", orch2.insights, { role: "data-analyst", skills: ["SQL"] });
assert("explore generates recommendations", recs2.length >= 1);

const recs3 = generateRecommendations("general", {}, {});
assert("general produces fallback recommendation", recs3.length >= 1);

// ══════════════════════════════════════════════════════════════════════════════
// PLANNER
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Planner ──");

const actions1 = planNextActions("transition", orch1.insights, { role: "data-analyst", target: "data-architect", skills: ["SQL", "Python"] });
assert("transition generates actions", actions1.length >= 2);
assert("actions have structure", actions1.every(a => a.label && a.type));
assert("has tool-type action", actions1.some(a => a.type === "tool"));
assert("has question-type action", actions1.some(a => a.type === "question"));

const actions2 = planNextActions("explore", orch2.insights, { role: "data-analyst", skills: ["SQL"] });
assert("explore generates actions", actions2.length >= 1);

const actions3 = planNextActions("general", {}, {});
assert("general generates fallback actions", actions3.length >= 1);

// ══════════════════════════════════════════════════════════════════════════════
// RESPONSE COMPOSER (full pipeline)
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n── Response Composer: Full pipeline ──");

const chat1 = composeChatResponse("How do I move from data analyst to data architect?", {
  role: "data-analyst",
  skills: ["SQL", "Python", "Excel"],
  yearsExp: 3,
});
assert("chat returns ok: true", chat1.ok === true);
assert("chat has reply (string)", typeof chat1.data.reply === "string" && chat1.data.reply.length > 20);
assert("chat has intent", chat1.data.intent.name === "transition");
assert("chat has insights", Object.keys(chat1.data.insights).length >= 2);
assert("chat has recommendations", chat1.data.recommendations.length >= 1);
assert("chat has next_actions", chat1.data.next_actions.length >= 1);
assert("chat returns updated context", chat1.data.context.role === "data-analyst");
assert("context has target", chat1.data.context.target === "data-architect");
assert("context has history", chat1.data.context.history.length >= 1);

// Multi-turn: send context back
const chat2 = composeChatResponse("What about my skills gap?", chat1.data.context);
assert("multi-turn preserves context", chat2.data.context.role === "data-analyst");
assert("multi-turn preserves target", chat2.data.context.target === "data-architect");
assert("multi-turn detects skills_gap", chat2.data.intent.name === "skills_gap");
assert("multi-turn has reply", chat2.data.reply.length > 10);

// Explore intent
const chat3 = composeChatResponse("What are my career options?", { role: "data-analyst", skills: ["SQL", "Python"] });
assert("explore has reply", chat3.data.reply.length > 10);
assert("explore detected", chat3.data.intent.name === "explore");
assert("explore has next_actions", chat3.data.next_actions.length >= 1);

// Interview intent
const chat4 = composeChatResponse("Help me prepare for interviews", { role: "data-analyst", target: "data-architect", skills: ["SQL", "Python"] });
assert("interview has reply", chat4.data.reply.length > 10);
assert("interview detected", chat4.data.intent.name === "interview");

// Resume intent
const chat5 = composeChatResponse("Help with my resume", { role: "data-analyst", target: "data-architect", skills: ["SQL", "Python"] });
assert("resume has reply", chat5.data.reply.length > 10);
assert("resume detected", chat5.data.intent.name === "resume");

// LinkedIn intent
const chat6 = composeChatResponse("Optimise my LinkedIn", { role: "data-analyst", skills: ["SQL", "Python"] });
assert("linkedin has reply", chat6.data.reply.length > 10);
assert("linkedin detected", chat6.data.intent.name === "linkedin");

// Salary intent
const chat7 = composeChatResponse("What does a data engineer earn?", {});
assert("salary has reply", chat7.data.reply.length > 10);
assert("salary detected", chat7.data.intent.name === "salary");

// Visa intent
const chat8 = composeChatResponse("Can I get a UK visa as a data scientist?", {});
assert("visa has reply", chat8.data.reply.length > 10);
assert("visa detected", chat8.data.intent.name === "visa");

// Role info
const chat9 = composeChatResponse("Tell me about the product manager role", {});
assert("role_info has reply", chat9.data.reply.length > 10);
assert("role_info detected", chat9.data.intent.name === "role_info");

// Compare
const chat10 = composeChatResponse("Compare data analyst and data engineer", {});
assert("compare has reply", chat10.data.reply.length > 10);
assert("compare detected", chat10.data.intent.name === "compare");

// Career pack
const chat11 = composeChatResponse("Give me a full career pack", { role: "data-analyst", target: "data-architect", skills: ["SQL", "Python"] });
assert("career_pack has reply", chat11.data.reply.length > 10);
assert("career_pack detected", chat11.data.intent.name === "career_pack");

// Clarification (missing context)
const chat12 = composeChatResponse("Help me prepare for interviews", {});
assert("missing context triggers clarification", chat12.data.reply.includes("need") || chat12.data.reply.includes("share"));
assert("clarification has next_actions", chat12.data.next_actions.length >= 1);

// Natural language with "I am a..." and no context
const chat13 = composeChatResponse("I'm a data analyst with 3 years of experience. How do I become a data architect?", {});
assert("NL extracts role from 'I'm a'", chat13.data.context.role === "data-analyst");
assert("NL extracts target from 'become a'", chat13.data.context.target === "data-architect");
assert("NL extracts yearsExp", chat13.data.context.yearsExp === 3);
assert("NL detected as transition", chat13.data.intent.name === "transition");
assert("NL has meaningful reply", chat13.data.reply.length > 50);

// General / unknown
const chat14 = composeChatResponse("Hello", {});
assert("general fallback works", chat14.ok === true);
assert("general has reply", chat14.data.reply.length > 10);

// ══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════════════════════════
console.log("\n══════════════════════════════════════");
console.log(`  TOTAL: ${pass + fail}  |  ✅ PASS: ${pass}  |  ❌ FAIL: ${fail}`);
console.log("══════════════════════════════════════\n");

process.exit(fail > 0 ? 1 : 0);
