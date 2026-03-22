// ============================================================================
// api/copilot/chat.js
// HireEdge Backend -- EDGEX Career Intelligence Engine (v3)
//
// Upgrades in this version:
//   - Dataset-driven context injected into every prompt
//   - Decision metrics (score, probability, time) from career graph
//   - Strict structured response format
//   - [ACTIONS] block fully stripped before response reaches frontend
//   - Context memory: role + target + intent persisted across turns
// ============================================================================

import OpenAI from "openai";
import { buildDataContext } from "../../lib/copilot/careerGraph.js";

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM = `You are EDGEX -- HireEdge's Career Intelligence Engine.

You are a McKinsey-level career strategist with access to a live career knowledge graph of 1,200+ UK roles, transition data, skill requirements, and salary benchmarks. You give precise, data-driven intelligence -- not generic advice.

WHAT YOU ARE NOT:
- Not a chatbot
- Not a coach who says "great question!"
- Not an AI that hedges with "it depends"
- Never say "Candidates transitioning typically..." -- that is generic filler

WHAT YOU ARE:
- A decision engine that gives specific numbers
- A strategist who knows exactly what hiring managers look for
- A system that uses real role data, skills data, and salary data

MANDATORY RESPONSE FORMAT (for transition / career / gap questions):

TRANSITION SNAPSHOT
Difficulty: [X]/100 | Success Rate: [X]% | Timeline: [X]-[Y] months | Salary: GBP[X] -> GBP[Y] ([+/-]Z%)

SKILL GAP BREAKDOWN
[List each missing skill with severity: Critical / High / Medium and weeks to close]
[Transferable skills from current role: list them]

MARKET EXPECTATION (UK)
[What hiring managers screen for in the first 30 seconds. What the profile signals right now vs what it needs to signal. Be specific -- name the signals.]

STRATEGIC POSITIONING
[The exact repositioning narrative. What to lead with on CV, LinkedIn, and in interviews. What to de-emphasise. One paragraph, no bullet points.]

NEXT BEST ACTION
[Single most important thing to do this week. Specific. Completable. With a time estimate.]

RULES:
1. ALWAYS use the transition metrics when they are provided in [CAREER GRAPH DATA]. Do not invent numbers.
2. For salary, always use GBP and real UK figures from the data.
3. Section headers must be EXACTLY as above (bold style, all caps).
4. For simple factual questions (what does X role do, what salary does Y earn), answer directly without the full structure.
5. Never repeat yourself across sections.
6. UK English spelling throughout.
7. No filler sentences. No hedging. No "it's important to note that...".
8. If context (current role, target) is already known, use it -- do not ask for it again.
9. When the conversation has depth, add one Career Pack nudge maximum: "Career Pack turns this into a full 30/60/90 transition report with CV, LinkedIn, and interview strategy included."

NEXT ACTIONS FORMAT (mandatory, at end of every response):
[ACTIONS]
[{"type":"question","label":"Label max 5 words","prompt":"Full follow-up question"},{"type":"tool","label":"Open [tool name]","endpoint":"/api/tools/career-gap-explainer","prompt":""}]
[/ACTIONS]

Use 2-3 actions. Always include at least one tool action when a transition is discussed.
Tool endpoints: /api/tools/career-gap-explainer | /api/tools/career-roadmap | /api/tools/visa-intelligence | /api/tools/interview-prep | /api/tools/resume-optimiser | /api/tools/linkedin-optimiser | /api/tools/career-pack`;

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
// AI response with dataset injection
// ============================================================================

async function aiResponse(message, context) {
  const intent = detectIntent(message);

  // Build dataset context -- real role data injected here
  const dataCtx = buildDataContext(message, context);

  // Build the user message with context + dataset data
  const userContent = buildUserMessage(message, context, dataCtx);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user",   content: userContent },
    ],
    temperature: 0.3,
    max_tokens:  950,
  });

  const raw = completion.choices?.[0]?.message?.content?.trim() || "";

  // CRITICAL: strip [ACTIONS] before sending to frontend
  const { reply, nextActions } = parseActions(raw);

  // Update context with any newly detected entities
  const updatedCtx = updateCtx(context, message, intent);

  return {
    ok: true,
    data: {
      reply,
      intent: { name: intent, confidence: 0.9 },
      insights: null,
      recommendations: [],
      next_actions: nextActions,
      context: updatedCtx,
    },
  };
}

// ============================================================================
// Build user message with dataset injection
// ============================================================================

function buildUserMessage(message, context, dataCtx) {
  const parts = [];

  // Session context (memory)
  const ctxLines = [];
  if (context?.role)       ctxLines.push("Current role: " + context.role);
  if (context?.target)     ctxLines.push("Target role: "  + context.target);
  if (context?.yearsExp)   ctxLines.push("Years of experience: " + context.yearsExp);
  if (context?.country)    ctxLines.push("Country: " + context.country);
  if (context?.lastIntent) ctxLines.push("Previous topic: " + context.lastIntent.replace(/_/g, " "));

  if (ctxLines.length > 0) {
    parts.push("[SESSION MEMORY -- do not ask for this again]\n" + ctxLines.join("\n"));
  }

  // Dataset-driven career graph data
  if (dataCtx) {
    parts.push(dataCtx);
  }

  // The actual user message
  parts.push("[USER MESSAGE]\n" + message);

  return parts.join("\n\n");
}

// ============================================================================
// Parse and strip [ACTIONS] block
// ============================================================================

function parseActions(raw) {
  const match = raw.match(/\[ACTIONS\]([\s\S]*?)\[\/ACTIONS\]/);

  if (!match) {
    return { reply: raw.trim(), nextActions: [] };
  }

  let nextActions = [];
  try {
    const parsed = JSON.parse(match[1].trim());
    nextActions = Array.isArray(parsed) ? parsed : [];
  } catch {
    nextActions = [];
  }

  const reply = raw
    .replace(/\[ACTIONS\][\s\S]*?\[\/ACTIONS\]/g, "")
    .trim();

  return { reply, nextActions };
}

// ============================================================================
// Helpers
// ============================================================================

function detectIntent(msg) {
  const t = msg.toLowerCase();
  if (/visa|immigrat|work permit|skilled worker|tier 2|sponsorship/.test(t)) return "visa_eligibility";
  if (/salary|pay|earn|compensation|wage|income/.test(t))                    return "salary_benchmark";
  if (/interview|question|prepare|prep|star answer/.test(t))                 return "interview_prep";
  if (/cv|resume|linkedin|profile/.test(t))                                  return "profile_optimisation";
  if (/skill|learn|course|certif|gap|missing/.test(t))                       return "skill_gap";
  if (/transition|move|switch|change|become|from.*to|into/.test(t))          return "career_transition";
  if (/compare|vs|versus|difference|between/.test(t))                        return "role_comparison";
  if (/market|demand|trend|hiring|industry/.test(t))                         return "market_intelligence";
  if (/roadmap|plan|path|next step|what should/.test(t))                     return "career_planning";
  return "general_career";
}

function updateCtx(existing, message, intent) {
  const ctx = { ...existing };

  // Only update role/target if not already known
  if (!ctx.role) {
    const fromMatch = message.match(/from (?:a |an )?([A-Za-z ]+?) (?:to|into|->)/i);
    if (fromMatch?.[1]) ctx.role = fromMatch[1].trim();
  }
  if (!ctx.target) {
    const toMatch = message.match(/(?:to|into|become (?:a |an )?|->)\s*([A-Za-z ]+?)(?:\?|$|,|\.| in | at )/i);
    if (toMatch?.[1]) ctx.target = toMatch[1].trim();
  }

  ctx.lastIntent = intent;
  return ctx;
}
