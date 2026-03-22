// ============================================================================
// api/copilot/chat.js
// HireEdge Backend -- EDGEX Chat Intelligence (v2)
// Fix: require() -> import (ES module -- matches rest of backend)
// ============================================================================

import OpenAI from "openai";
import { composeChatResponse } from "../../lib/copilot/responseComposer.js";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const SYSTEM = `You are EDGEX -- HireEdge's Career Intelligence Engine.

You are NOT a chatbot. You are a senior career strategist with deep knowledge of:
- UK and international job markets
- Career transition patterns and success rates
- Skill gap analysis and upskilling pathways
- Hiring manager and recruiter expectations
- Salary benchmarks by role, seniority, and geography
- UK visa routes (Skilled Worker, Global Talent, Graduate, HPI)
- CV and LinkedIn positioning strategy
- Interview preparation and gap handling

RESPONSE STRUCTURE:
Every substantive response must follow this structure when relevant:

1. TRANSITION ANALYSIS
   What this move typically looks like in the market. How common it is. Success rate framing.

2. SKILL GAP BREAKDOWN
   Specific skills missing. Severity (High/Medium/Low). Time to close each gap.

3. MARKET EXPECTATION
   What hiring managers and recruiters in this market typically screen for.
   What the profile looks like from the outside right now.

4. STRATEGIC POSITIONING
   The reframe. How to present the background so it maps to the target role.
   What to lead with. What to de-emphasise.

5. NEXT BEST ACTION
   The single highest-leverage thing to do right now. Specific. Completable.

LANGUAGE RULES:
- Never say "you lack" or "your profile doesn't". Use systemic framing.
- Frame as market intelligence: "Candidates moving from X to Y typically..."
- Be direct and specific. No filler. No hedging.
- UK English spelling throughout.
- Give concrete numbers, timelines, and percentages where possible.
- Keep each section tight: 2-4 sentences max.
- For simple questions (salary check, quick definition), skip the structure and answer directly.

TOOL AWARENESS:
Direct users to HireEdge tools when relevant:
- Career Gap Explainer: detailed role-to-role gap analysis
- Career Roadmap: phased transition plan with probability scores
- Visa Intelligence: UK and international visa eligibility
- LinkedIn Optimiser: full profile rewrite for target role
- Interview Prep: role-specific questions and STAR answers
- Resume Optimiser: CV gap analysis and reframe
- Career Pack: full unified transition plan (paid)

MONETISATION:
When the conversation reaches a natural depth point, add a tasteful nudge once:
"Want a full transition plan that connects all of this? Career Pack turns this into a complete 30/60/90 report."

NEXT ACTIONS FORMAT:
At the very end of every response, append exactly this block. No text after [/ACTIONS].
[ACTIONS]
[{"type":"question","label":"Short label under 6 words","prompt":"Full question text"},{"type":"tool","label":"Open tool name","endpoint":"/api/tools/career-gap-explainer","prompt":"unused"}]
[/ACTIONS]

Use 2-3 actions. Mix question and tool types. Array must be valid JSON.`;

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

async function aiResponse(message, context) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user",   content: buildUserMessage(message, context) },
    ],
    temperature: 0.45,
    max_tokens: 900,
  });

  const raw = completion.choices?.[0]?.message?.content?.trim() || "";
  const { reply, nextActions } = parseActions(raw);

  return {
    ok: true,
    data: {
      reply,
      intent: { name: detectIntent(message), confidence: 0.85 },
      insights: null,
      recommendations: [],
      next_actions: nextActions,
      context: updateCtx(context, message, detectIntent(message)),
    },
  };
}

function parseActions(raw) {
  const match = raw.match(/\[ACTIONS\]([\s\S]*?)\[\/ACTIONS\]/);
  if (!match) return { reply: raw.trim(), nextActions: [] };
  let nextActions = [];
  try {
    nextActions = JSON.parse(match[1].trim());
    if (!Array.isArray(nextActions)) nextActions = [];
  } catch { nextActions = []; }
  const reply = raw.replace(/\[ACTIONS\][\s\S]*?\[\/ACTIONS\]/g, "").trim();
  return { reply, nextActions };
}

function buildUserMessage(message, context) {
  const lines = [message];
  if (context && Object.keys(context).length) {
    const ctx = [];
    if (context.role)     ctx.push("Current role: " + context.role);
    if (context.target)   ctx.push("Target role: "  + context.target);
    if (context.yearsExp) ctx.push("Years of experience: " + context.yearsExp);
    if (context.country)  ctx.push("Country: " + context.country);
    if (ctx.length) lines.push("\n[CONTEXT]\n" + ctx.join("\n"));
  }
  return lines.join("\n");
}

function detectIntent(msg) {
  const t = msg.toLowerCase();
  if (/visa|immigrat|work permit|skilled worker|sponsorship/.test(t)) return "visa_eligibility";
  if (/salary|pay|earn|compensation/.test(t))   return "salary_benchmark";
  if (/interview|question|prepare/.test(t))      return "interview_prep";
  if (/skill|learn|course|gap/.test(t))          return "skill_gap";
  if (/transition|move|switch|change|from.*to/.test(t)) return "career_transition";
  if (/compare|vs|versus|difference/.test(t))   return "role_comparison";
  return "general_career";
}

function updateCtx(existing, message, intent) {
  const ctx = { ...existing };
  const fromMatch = message.match(/from (?:a |an )?([A-Za-z ]+?) (?:to|into)/i);
  const toMatch   = message.match(/(?:to|into) (?:a |an )?([A-Za-z ]+?)(?:\?|$|,|\.| in )/i);
  if (fromMatch?.[1]) ctx.role   = fromMatch[1].trim();
  if (toMatch?.[1])   ctx.target = toMatch[1].trim();
  ctx.lastIntent = intent;
  return ctx;
}
