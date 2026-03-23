// ============================================================================
// api/copilot/chat.js
// HireEdge Backend -- EDGEX Career Intelligence Engine (v3)
//
// SELF-CONTAINED -- no external lib/copilot/careerGraph.js dependency.
// Career graph logic is inlined so this is a single-file deploy.
//
// Uses: lib/dataset/roleIndex.js (already exists on backend)
// ============================================================================

import OpenAI from "openai";
import { getRoleBySlug } from "../../lib/dataset/roleIndex.js";

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM = `You are EDGEX -- HireEdge's Career Intelligence Engine.

You are a McKinsey-level career strategist with access to a live career knowledge graph covering 1,200+ UK roles, transition data, skill requirements, and salary benchmarks. You give precise, data-driven intelligence -- not generic advice.

WHAT YOU ARE NOT:
- Not a chatbot
- Not a coach who says "great question!"
- Not an AI that hedges with "it depends"
- Never start a sentence with "Candidates transitioning typically..." -- that is generic filler

WHAT YOU ARE:
- A decision engine that gives specific numbers
- A strategist who knows exactly what hiring managers look for
- A system that uses real role data, skills data, and salary data

MANDATORY RESPONSE FORMAT for transition / career / gap questions:

**TRANSITION SNAPSHOT**
Difficulty: [X]/100 | Success Rate: [X]% | Timeline: [X]-[Y] months | Salary: GBP[X] -> GBP[Y] ([+/-]Z%)

**SKILL GAP BREAKDOWN**
Critical (0-4 weeks to signal): [list skills]
High (1-3 months): [list skills]
Transferable from current role: [list skills]

**MARKET EXPECTATION (UK)**
[What hiring managers screen for in the first 30 seconds. What this profile signals right now vs what it needs to signal. Name the specific signals.]

**STRATEGIC POSITIONING**
[The exact repositioning narrative. What to lead with on CV, LinkedIn, and in interviews. What to de-emphasise. One paragraph, no bullet points.]

**NEXT BEST ACTION**
[Single most important thing to do this week. Specific. Completable. With time estimate.]

RULES:
1. ALWAYS use the metrics from [CAREER GRAPH DATA] when provided. Do not invent numbers.
2. For salary: always use GBP and real UK figures.
3. Section headers must be bold (**LIKE THIS**).
4. For simple factual questions (what does X role do, what salary does Y earn), answer directly without the full structure.
5. Never repeat yourself across sections.
6. UK English spelling throughout.
7. No filler. No hedging. No "it's important to note...".
8. If context (current role, target) is already known, use it -- do not ask for it again.
9. When conversation has depth, add ONE Career Pack nudge: "Career Pack turns this into a full 30/60/90 transition report with CV, LinkedIn, and interview strategy."

NEXT ACTIONS FORMAT (mandatory at end of every response):
[ACTIONS]
[{"type":"question","label":"Label max 5 words","prompt":"Full follow-up question"},{"type":"tool","label":"Open Gap Explainer","endpoint":"/api/tools/career-gap-explainer","prompt":""}]
[/ACTIONS]

Use 2-3 actions. Always include at least one tool action when a transition is discussed.
Valid endpoints: /api/tools/career-gap-explainer | /api/tools/career-roadmap | /api/tools/visa-intelligence | /api/tools/interview-prep | /api/tools/resume-optimiser | /api/tools/linkedin-optimiser`;

// ============================================================================
// Career graph -- inlined (no external dependency)
// ============================================================================

const SENIORITY_RANK = {
  junior: 1, mid: 2, senior: 3, lead: 4,
  head: 5, director: 6, vp: 7, c_suite: 8
};

function slugify(title) {
  return (title || "").toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function findRole(title) {
  if (!title) return null;
  try {
    const bySlug = getRoleBySlug(slugify(title));
    if (bySlug) return bySlug;
    // Also try common variations
    const variations = [
      slugify(title),
      slugify(title.replace(" Manager", "-manager")),
      slugify(title.replace("Manager", "manager")),
    ];
    for (const slug of variations) {
      const r = getRoleBySlug(slug);
      if (r) return r;
    }
    return null;
  } catch {
    return null;
  }
}

function buildCareerGraphData(fromTitle, toTitle) {
  const fromRole = findRole(fromTitle);
  const toRole   = findRole(toTitle);

  if (!fromRole && !toRole) return "";

  const lines = ["[CAREER GRAPH DATA -- use these exact numbers in your response]"];

  if (fromRole) {
    const skills = [
      ...(fromRole.skills_grouped?.core      || []),
      ...(fromRole.skills_grouped?.technical || []),
    ];
    lines.push(
      "FROM ROLE: " + fromRole.title,
      "  Seniority: " + (fromRole.seniority || "mid"),
      "  UK salary mean: GBP" + (fromRole.salary_uk?.mean?.toLocaleString("en-GB") || "unknown"),
      "  Skills: " + skills.slice(0, 8).join(", ")
    );
  }

  if (toRole) {
    const toSkills = [
      ...(toRole.skills_grouped?.core      || []),
      ...(toRole.skills_grouped?.technical || []),
    ];
    lines.push(
      "TO ROLE: " + toRole.title,
      "  Seniority: " + (toRole.seniority || "mid"),
      "  UK salary mean: GBP" + (toRole.salary_uk?.mean?.toLocaleString("en-GB") || "unknown"),
      "  Demand score: " + (toRole.demand_score || 50) + "/100",
      "  Required skills: " + toSkills.slice(0, 8).join(", "),
      "  Next career steps: " + (toRole.career_paths?.next_roles?.slice(0, 3).join(", ") || "none")
    );
  }

  if (fromRole && toRole) {
    const fromSkillSet = new Set([
      ...(fromRole.skills_grouped?.core      || []),
      ...(fromRole.skills_grouped?.technical || []),
    ].map(s => s.toLowerCase()));

    const toSkills = [
      ...(toRole.skills_grouped?.core      || []),
      ...(toRole.skills_grouped?.technical || []),
    ].map(s => s.toLowerCase());

    const overlap  = toSkills.filter(s => fromSkillSet.has(s));
    const missing  = toSkills.filter(s => !fromSkillSet.has(s));

    const matchPct = toSkills.length > 0
      ? Math.round((overlap.length / toSkills.length) * 100) : 50;

    const fromRank = SENIORITY_RANK[fromRole.seniority] || 3;
    const toRank   = SENIORITY_RANK[toRole.seniority]   || 3;
    const senDelta = Math.max(0, toRank - fromRank);

    const difficulty = Math.min(100, Math.round(
      (toRole.difficulty_to_enter || 50) * 0.5 +
      (100 - matchPct) * 0.35 +
      senDelta * 5
    ));

    const successRate = Math.max(15, Math.min(90, Math.round(
      matchPct * 0.5 + (100 - difficulty) * 0.35 + (fromRole.demand_score || 50) * 0.15
    )));

    const baseTime  = toRole.time_to_hire || 3;
    const timeMin   = Math.max(2, Math.round(missing.length * 0.8 + senDelta * 2 + baseTime) - 2);
    const timeMax   = timeMin + 4;

    const fromSal = fromRole.salary_uk?.mean || 0;
    const toSal   = toRole.salary_uk?.mean   || 0;
    const salDelta = fromSal > 0 && toSal > 0
      ? (((toSal - fromSal) / fromSal) * 100).toFixed(0) : null;

    lines.push(
      "CALCULATED TRANSITION METRICS:",
      "  Difficulty score: " + difficulty + "/100",
      "  Success rate: " + successRate + "%",
      "  Timeline: " + timeMin + "-" + timeMax + " months",
      salDelta !== null
        ? "  Salary change: " + (salDelta >= 0 ? "+" : "") + salDelta + "% (GBP" + fromSal.toLocaleString("en-GB") + " -> GBP" + toSal.toLocaleString("en-GB") + ")"
        : "  Salary data: not available",
      "  Skill match: " + matchPct + "%",
      "  Skills to acquire: " + missing.slice(0, 6).join(", "),
      "  Transferable skills: " + overlap.slice(0, 4).join(", ")
    );

    if (fromRole.career_paths?.next_roles?.length > 0) {
      const altPaths = fromRole.career_paths.next_roles
        .filter(r => r !== toRole.title)
        .slice(0, 3);
      if (altPaths.length > 0) {
        lines.push("  Alternative paths from current role: " + altPaths.join(", "));
      }
    }
  }

  return lines.join("\n");
}

function extractRole(message, direction) {
  if (!message) return null;
  if (direction === "from") {
    const m = message.match(/from (?:a |an )?([A-Za-z ]+?) (?:to|into|->)/i);
    return m?.[1]?.trim() || null;
  }
  const m = message.match(/(?:to|into|become (?:a |an )?|->)\s*([A-Za-z ]+?)(?:\?|$|,|\.| in | at )/i);
  return m?.[1]?.trim() || null;
}

// ============================================================================
// Handler
// ============================================================================

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: "Invalid JSON." });
  }

  const { message, context } = body;
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required." });
  }

  try {
    if (openai) {
      return res.status(200).json(await aiResponse(message.trim(), context || {}));
    }
    // Fallback: keyword engine
    const { composeChatResponse } = await import("../../lib/copilot/responseComposer.js");
    return res.status(200).json(composeChatResponse(message.trim(), context || {}));
  } catch (err) {
    console.error("[edgex/chat]", err);
    return res.status(500).json({
      ok: false,
      error: "EDGEX is temporarily unavailable.",
      message: err.message,
    });
  }
}

// ============================================================================
// AI response
// ============================================================================

async function aiResponse(message, context) {
  const intent = detectIntent(message);

  // Resolve role titles from context or message
  const fromTitle = context?.role   || extractRole(message, "from");
  const toTitle   = context?.target || extractRole(message, "to");

  // Inject career graph data from dataset
  const graphData = buildCareerGraphData(fromTitle, toTitle);

  const userContent = buildUserMessage(message, context, graphData);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user",   content: userContent },
    ],
    temperature: 0.3,
    max_tokens:  900,
  });

  const raw = completion.choices?.[0]?.message?.content?.trim() || "";

  // Strip [ACTIONS] before sending to frontend
  const { reply, nextActions } = parseActions(raw);

  return {
    ok: true,
    data: {
      reply,
      intent: { name: intent, confidence: 0.9 },
      insights: null,
      recommendations: [],
      next_actions: nextActions,
      context: updateCtx(context, message, intent, fromTitle, toTitle),
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

function buildUserMessage(message, context, graphData) {
  const parts = [];

  const ctxLines = [];
  if (context?.role)       ctxLines.push("Current role: " + context.role);
  if (context?.target)     ctxLines.push("Target role: "  + context.target);
  if (context?.yearsExp)   ctxLines.push("Years of experience: " + context.yearsExp);
  if (context?.country)    ctxLines.push("Country: " + context.country);
  if (context?.lastIntent) ctxLines.push("Previous topic: " + context.lastIntent.replace(/_/g, " "));

  if (ctxLines.length > 0) {
    parts.push("[SESSION MEMORY -- do not ask for this again]\n" + ctxLines.join("\n"));
  }

  if (graphData) {
    parts.push(graphData);
  }

  parts.push("[USER MESSAGE]\n" + message);
  return parts.join("\n\n");
}

function parseActions(raw) {
  const match = raw.match(/\[ACTIONS\]([\s\S]*?)\[\/ACTIONS\]/);
  if (!match) return { reply: raw.trim(), nextActions: [] };
  let nextActions = [];
  try {
    const parsed = JSON.parse(match[1].trim());
    nextActions = Array.isArray(parsed) ? parsed : [];
  } catch { nextActions = []; }
  const reply = raw.replace(/\[ACTIONS\][\s\S]*?\[\/ACTIONS\]/g, "").trim();
  return { reply, nextActions };
}

function detectIntent(msg) {
  const t = msg.toLowerCase();
  if (/visa|immigrat|work permit|skilled worker|sponsorship/.test(t)) return "visa_eligibility";
  if (/salary|pay|earn|compensation|wage/.test(t))                    return "salary_benchmark";
  if (/interview|question|prepare|prep/.test(t))                      return "interview_prep";
  if (/cv|resume|linkedin|profile/.test(t))                           return "profile_optimisation";
  if (/skill|learn|course|gap|missing/.test(t))                       return "skill_gap";
  if (/transition|move|switch|change|become|from.*to|into/.test(t))   return "career_transition";
  if (/compare|vs|versus|difference/.test(t))                         return "role_comparison";
  if (/roadmap|plan|path|next step|what should/.test(t))              return "career_planning";
  return "general_career";
}

function updateCtx(existing, message, intent, fromTitle, toTitle) {
  const ctx = { ...existing };
  if (!ctx.role   && fromTitle) ctx.role   = fromTitle;
  if (!ctx.target && toTitle)   ctx.target = toTitle;
  ctx.lastIntent = intent;
  return ctx;
}
