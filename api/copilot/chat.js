// ============================================================================
// api/copilot/chat.js
// HireEdge Backend -- EDGEX Chat Intelligence (v2)
//
// POST /api/copilot/chat
// Body:    { message: string, context: object }
// Response: { ok: true, data: { reply, intent, insights, recommendations,
//                               next_actions, context } }
//
// v2: Delegates to real OpenAI GPT-4o-mini when OPENAI_API_KEY is set.
// Falls back to the existing composeChatResponse() engine otherwise,
// so dev/staging environments keep working without an API key.
// ============================================================================

let openai = null;
try {
  if (process.env.OPENAI_API_KEY) {
    const { default: OpenAI } = await import("openai");
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
} catch {
  // openai package not available -- fall back to keyword engine
}

const SYSTEM = `You are EDGEX, HireEdge's career intelligence engine.

You help professionals navigate career transitions, skill gaps, salary benchmarks, interview preparation, and UK/international visa eligibility.

RULES:
- Be direct, specific, and authoritative. No generic advice.
- Frame everything as market intelligence: "Candidates moving from X to Y typically...", "Hiring managers in the UK usually expect..."
- Never say "you lack" or "your profile doesn't". Use systemic framing.
- UK English spelling throughout.
- Keep replies concise: 2-4 paragraphs max unless a detailed breakdown is needed.
- Give concrete numbers/timelines where possible.

TOOL AWARENESS -- direct users to these tools when relevant:
- Career Gap Explainer: detailed gap analysis between two roles
- Career Roadmap: phased transition plan
- Visa Intelligence: UK and international visa eligibility
- LinkedIn Optimiser: profile optimisation
- Interview Prep: role-specific questions and STAR answers
- Resume Optimiser: CV gap analysis
- Career Pack: full unified transition plan (paid)

After your reply, append next actions in this EXACT format (no extra text outside it):
[ACTIONS]
[{"type":"question","label":"Follow-up label","prompt":"Full follow-up question"},{"type":"tool","label":"Open tool name","endpoint":"/api/tools/career-gap-explainer","prompt":"Run tool"}]
[/ACTIONS]`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: "Invalid JSON in request body." });
  }

  const { message, context } = body;
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Missing required field: message" });
  }

  try {
    if (openai) {
      return res.status(200).json(await aiResponse(message.trim(), context || {}));
    }
    // Fallback to existing keyword engine
    const { composeChatResponse } = await import("../../lib/copilot/responseComposer.js");
    return res.status(200).json(composeChatResponse(message.trim(), context || {}));
  } catch (err) {
    console.error("[edgex/chat]", err);
    return res.status(500).json({ ok: false, error: "EDGEX is temporarily unavailable.", message: err.message });
  }
}

async function aiResponse(message, context) {
  const userMsg = buildUserMessage(message, context);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user",   content: userMsg },
    ],
    temperature: 0.5,
    max_tokens: 700,
  });

  const raw = completion.choices?.[0]?.message?.content?.trim() || "";
  const { reply, nextActions } = parseRaw(raw);
  const intent = detectIntent(message);
  const updatedCtx = updateCtx(context, message, intent);

  return {
    ok: true,
    data: {
      reply,
      intent: { name: intent, confidence: 0.85 },
      insights: null,
      recommendations: [],
      next_actions: nextActions,
      context: updatedCtx,
    },
  };
}

function buildUserMessage(message, context) {
  const lines = [message];
  if (context && Object.keys(context).length > 0) {
    const ctx = [];
    if (context.role)     ctx.push("Current role: " + context.role);
    if (context.target)   ctx.push("Target role: " + context.target);
    if (context.yearsExp) ctx.push("Years of experience: " + context.yearsExp);
    if (context.country)  ctx.push("Country: " + context.country);
    if (ctx.length) lines.push("\n[CONTEXT]\n" + ctx.join("\n"));
  }
  return lines.join("\n");
}

function parseRaw(raw) {
  const m = raw.match(/\[ACTIONS\]([\s\S]*?)\[\/ACTIONS\]/);
  let nextActions = [];
  let reply = raw;
  if (m) {
    try { nextActions = JSON.parse(m[1].trim()); } catch { nextActions = []; }
    reply = raw.replace(/\[ACTIONS\][\s\S]*?\[\/ACTIONS\]/, "").trim();
  }
  return { reply, nextActions };
}

function detectIntent(msg) {
  const t = msg.toLowerCase();
  if (/visa|immigrat|work permit|skilled worker|tier 2|sponsorship/.test(t)) return "visa_eligibility";
  if (/salary|pay|earn|compensation|wage/.test(t))                            return "salary_benchmark";
  if (/interview|question|prepare|prep/.test(t))                              return "interview_prep";
  if (/skill|learn|course|certif|gap/.test(t))                                return "skill_gap";
  if (/transition|move|switch|change|from.+to/.test(t))                       return "career_transition";
  if (/compare|vs|versus|difference|between/.test(t))                         return "role_comparison";
  if (/market|trend|demand|industry/.test(t))                                 return "market_intelligence";
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
