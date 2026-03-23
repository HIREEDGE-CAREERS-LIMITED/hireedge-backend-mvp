// ============================================================================
// api/copilot/chat.js
// HireEdge Backend -- EDGEX Career Intelligence Engine (v4)
//
// v4 adds: global input validation layer before any LLM call.
// Intent-to-required-fields map gates every request.
// Missing fields return structured clarification -- never assume roles.
// ============================================================================

import OpenAI from "openai";
import { getRoleBySlug } from "../../lib/dataset/roleIndex.js";

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ============================================================================
// INTENT -> REQUIRED FIELDS MAP
// Every intent that needs specific context is listed here.
// Add new intents as the product grows.
// ============================================================================

const INTENT_REQUIREMENTS = {
  career_transition: {
    required: ["current_role", "target_role"],
    messages: {
      current_role: "What is your current role?",
      target_role:  "What role do you want to move into?",
    },
  },
  career_planning: {
    required: ["current_role"],
    messages: {
      current_role: "What is your current role?",
    },
  },
  skill_gap: {
    required: ["current_role", "target_role"],
    messages: {
      current_role: "What is your current role?",
      target_role:  "What role are you aiming for?",
    },
  },
  interview_prep: {
    required: ["target_role"],
    messages: {
      target_role: "Which role are you interviewing for?",
    },
  },
  profile_optimisation: {
    required: ["target_role"],
    messages: {
      target_role: "What role are you optimising your profile for?",
    },
  },
  role_comparison: {
    required: ["current_role", "target_role"],
    messages: {
      current_role: "Which role are you comparing from?",
      target_role:  "Which role are you comparing to?",
    },
  },
  // These intents work without role context
  salary_benchmark:    { required: [] },
  visa_eligibility:    { required: [] },
  market_intelligence: { required: [] },
  general_career:      { required: [] },
};

// ============================================================================
// VALIDATION MIDDLEWARE
// Runs before every LLM call. Returns null if valid, or a clarification
// response object if required fields are missing.
// ============================================================================

function validateRequest(intent, context, message) {
  const spec = INTENT_REQUIREMENTS[intent] || INTENT_REQUIREMENTS.general_career;
  if (!spec.required || spec.required.length === 0) return null;

  // Resolve what we already know from context + message
  const resolved = resolveContext(context, message);

  const missingFields = spec.required.filter(field => {
    if (field === "current_role") return !resolved.role;
    if (field === "target_role")  return !resolved.target;
    return true;
  });

  if (missingFields.length === 0) return null;

  // Build clarification response
  const actions = missingFields.map(field => ({
    type:   "question",
    label:  spec.messages[field] || ("Set " + field.replace("_", " ")),
    prompt: spec.messages[field] || ("What is your " + field.replace("_", " ") + "?"),
  }));

  // Human-readable what's missing
  const missingLabels = missingFields.map(f =>
    f === "current_role" ? "your current role" : "your target role"
  );

  const intentLabel = {
    career_transition:   "a 90-day career transition plan",
    career_planning:     "a career plan",
    skill_gap:           "a skill gap analysis",
    interview_prep:      "interview preparation",
    profile_optimisation:"profile optimisation advice",
    role_comparison:     "a role comparison",
  }[intent] || "this";

  return {
    ok: true,
    data: {
      type:           "clarification",
      reply:          "To build " + intentLabel + ", I need " + missingLabels.join(" and ") + " first.",
      intent:         { name: intent, confidence: 0.9 },
      missing_fields: missingFields,
      next_actions:   actions,
      recommendations: [],
      insights:       null,
      context:        context || {},
    },
  };
}

// ============================================================================
// CONTEXT RESOLVER
// Extracts role/target from context object AND from the raw message text.
//
// ============================================================================

// Role extraction patterns -- ordered by specificity
const ROLE_RE = [
  // "from X to/into Y"
  [/(?<![a-zA-Z])from\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)\s+(?:to|into)\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)(?=[,.]|$|\?|\s+(?:role|as|at|in)\b)/i, "both"],
  // "I work/worked as a X and want/need..."
  [/\bi\s+(?:work|worked)\s+as\s+(?:a |an )?([a-z][a-z -]{1,24}?)\s+and\s+(?:want|need|hope|plan|look)/i, "role"],
  // "I work as a X" end of string
  [/\bi\s+(?:work|worked)\s+as\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,25})$/i, "role"],
  // "I am (currently) a X"
  [/\bi\s+am\s+(?:currently\s+)?(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)(?=\s+(?:and|looking|wanting|hoping|trying|aiming|moving|planning|who)\b|[,.]|$)/i, "role"],
  // "currently a X"
  [/\bcurrently\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)(?=[,.]|\s+(?:and|looking|aiming)\b|$)/i, "role"],
  // "want to be/become/transition to X"
  [/want(?:ing)?\s+to\s+(?:be|become|transition\s+(?:to|into)|move\s+into)\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)(?=[,.]|$|\?|\s+role\b|\s+position\b)/i, "target"],
  // "become / move into / transition to X"
  [/(?<![a-z])(?:become|move\s+into|transition\s+(?:to|into)|moving\s+(?:to|into)|pivot\s+(?:to|into)|switch\s+(?:to|into))\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)(?=[,.]|$|\?|\s+role\b)/i, "target"],
  // "aiming for X"
  [/aim(?:ing)?\s+(?:for|to\s+become)\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)(?=[,.]|$|\s+role\b)/i, "target"],
];

const SHORT_X_TO_Y = /^([A-Za-z][A-Za-z -]{2,25}?)\s+to\s+([A-Za-z][A-Za-z -]{2,25})$/i;

function extractRolesFromMessage(msg) {
  let role = null, target = null;
  const t = (msg || "").toLowerCase().trim();
  const wordCount = t.split(/\s+/).length;

  // bare "X to Y" only for short messages (<=6 words)
  if (wordCount <= 6) {
    const m = SHORT_X_TO_Y.exec(t);
    if (m) { role = m[1].trim(); target = m[2].trim(); }
  }

  for (const [re, kind] of ROLE_RE) {
    const m = re.exec(t);
    if (!m) continue;
    const g1 = m[1].trim();
    if (kind === "both") {
      const g2 = m[2] ? m[2].trim() : null;
      if (!role) role = g1;
      if (!target && g2) target = g2;
    } else if (kind === "role" && !role) {
      role = g1;
    } else if (kind === "target" && !target) {
      target = g1;
    }
    if (role && target) break;
  }
  return { role, target };
}

function resolveContext(context, message) {
  // Always try to extract roles from the current message first
  const extracted = extractRolesFromMessage(message);

  return {
    // Message roles OVERRIDE context -- user explicitly stated new roles
    role:     extracted.role   || context?.role   || null,
    target:   extracted.target || context?.target || null,
    yearsExp: context?.yearsExp || null,
    country:  context?.country  || null,
  };
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM = `You are EDGEX -- HireEdge's Career Intelligence Engine.

You are a McKinsey-level career strategist with access to a career knowledge graph of 1,200+ UK roles, transition data, skill requirements, and salary benchmarks.

ABSOLUTE RULES:
1. NEVER assume a role. If current_role or target_role is missing, do not generate a plan.
2. NEVER invent or assume a role name. Ask for it instead.
3. If required context is missing, stop and ask for it.
4. NEVER say "Candidates transitioning typically..." -- it is generic filler.
5. UK English spelling throughout.
6. No filler. No hedging. No "it's important to note...".
7. ALWAYS answer general questions (salary benchmarks, market trends, skill advice, visa routes) directly and fully -- even when a transition context is set. Context is background information, not a restriction.
8. NEVER say "I can only provide information about your current transition" or refuse to answer a question because it doesn't match the user's stated roles. Answer what was asked.
9. If the user states new roles mid-conversation, switch to those immediately. Never ask for confirmation.

RESPONSE FORMAT for transition / career / gap questions:

**TRANSITION SNAPSHOT**
Difficulty: [X]/100 | Success Rate: [X]% | Timeline: [X]-[Y] months | Salary: GBP[X] -> GBP[Y] ([+/-]Z%)

**SKILL GAP BREAKDOWN**
Critical (0-4 weeks to signal): [list skills]
High (1-3 months): [list skills]
Transferable from current role: [list skills]

**MARKET EXPECTATION (UK)**
[What hiring managers screen for. What this profile signals now vs what it needs to signal. Name specific signals.]

**STRATEGIC POSITIONING**
[Exact repositioning narrative. What to lead with on CV, LinkedIn, interviews. One paragraph.]

**NEXT BEST ACTION**
[Single most important action this week. Specific. Completable. Time estimate.]

For simple questions answer directly without the full structure.

NEXT ACTIONS FORMAT (mandatory at end of every response):
[ACTIONS]
[{"type":"question","label":"Label max 5 words","prompt":"Full follow-up question"},{"type":"tool","label":"Open Gap Explainer","endpoint":"/api/tools/career-gap-explainer","prompt":""}]
[/ACTIONS]

Valid tool endpoints: /api/tools/career-gap-explainer | /api/tools/career-roadmap | /api/tools/visa-intelligence | /api/tools/interview-prep | /api/tools/resume-optimiser | /api/tools/linkedin-optimiser | /api/tools/career-pack`;

// ============================================================================
// CAREER GRAPH (inlined)
// ============================================================================

const SENIORITY_RANK = { junior:1, mid:2, senior:3, lead:4, head:5, director:6, vp:7, c_suite:8 };

function findRole(title) {
  if (!title) return null;
  try {
    const slug = title.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    return getRoleBySlug(slug) || null;
  } catch { return null; }
}

function buildCareerGraphData(fromTitle, toTitle) {
  const fromRole = findRole(fromTitle);
  const toRole   = findRole(toTitle);
  if (!fromRole && !toRole) return "";

  const lines = ["[CAREER GRAPH DATA -- use these exact numbers in your response]"];

  if (fromRole) {
    const skills = [
      ...(fromRole.skills_grouped?.core || []),
      ...(fromRole.skills_grouped?.technical || []),
    ];
    lines.push(
      "FROM: " + fromRole.title,
      "  Seniority: " + (fromRole.seniority || "mid"),
      "  UK salary mean: GBP" + (fromRole.salary_uk?.mean?.toLocaleString("en-GB") || "n/a"),
      "  Skills: " + skills.slice(0, 8).join(", ")
    );
  }

  if (toRole) {
    const toSkills = [
      ...(toRole.skills_grouped?.core || []),
      ...(toRole.skills_grouped?.technical || []),
    ];
    lines.push(
      "TO: " + toRole.title,
      "  Seniority: " + (toRole.seniority || "mid"),
      "  UK salary mean: GBP" + (toRole.salary_uk?.mean?.toLocaleString("en-GB") || "n/a"),
      "  Demand score: " + (toRole.demand_score || 50) + "/100",
      "  Required skills: " + toSkills.slice(0, 8).join(", "),
      "  Next career steps: " + (toRole.career_paths?.next_roles?.slice(0, 3).join(", ") || "none")
    );
  }

  if (fromRole && toRole) {
    const fromSet = new Set([
      ...(fromRole.skills_grouped?.core || []),
      ...(fromRole.skills_grouped?.technical || []),
    ].map(s => s.toLowerCase()));

    const toSkills = [
      ...(toRole.skills_grouped?.core || []),
      ...(toRole.skills_grouped?.technical || []),
    ].map(s => s.toLowerCase());

    const overlap  = toSkills.filter(s => fromSet.has(s));
    const missing  = toSkills.filter(s => !fromSet.has(s));
    const matchPct = toSkills.length > 0 ? Math.round((overlap.length / toSkills.length) * 100) : 50;
    const senDelta = Math.max(0, (SENIORITY_RANK[toRole.seniority] || 3) - (SENIORITY_RANK[fromRole.seniority] || 3));
    const diff     = Math.min(100, Math.round((toRole.difficulty_to_enter || 50) * 0.5 + (100 - matchPct) * 0.35 + senDelta * 5));
    const rate     = Math.max(15, Math.min(90, Math.round(matchPct * 0.5 + (100 - diff) * 0.35 + (fromRole.demand_score || 50) * 0.15)));
    const tMin     = Math.max(2, Math.round(missing.length * 0.8 + senDelta * 2 + (toRole.time_to_hire || 3)) - 2);
    const fromSal  = fromRole.salary_uk?.mean || 0;
    const toSal    = toRole.salary_uk?.mean   || 0;
    const salDelta = fromSal > 0 && toSal > 0 ? (((toSal - fromSal) / fromSal) * 100).toFixed(0) : null;

    lines.push(
      "CALCULATED METRICS:",
      "  Difficulty: " + diff + "/100",
      "  Success rate: " + rate + "%",
      "  Timeline: " + tMin + "-" + (tMin + 4) + " months",
      salDelta !== null ? "  Salary: " + (salDelta >= 0 ? "+" : "") + salDelta + "% (GBP" + fromSal.toLocaleString("en-GB") + " -> GBP" + toSal.toLocaleString("en-GB") + ")" : "  Salary: data not available",
      "  Skill match: " + matchPct + "%",
      "  Skills to acquire: " + missing.slice(0, 6).join(", "),
      "  Transferable: " + overlap.slice(0, 4).join(", ")
    );
    const altPaths = (fromRole.career_paths?.next_roles || []).filter(r => r !== toRole.title).slice(0, 3);
    if (altPaths.length > 0) lines.push("  Alternative paths: " + altPaths.join(", "));
  }

  return lines.join("\n");
}

// ============================================================================
// HANDLER
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

  const intent   = detectIntent(message.trim());
  const resolved = resolveContext(context, message.trim());

  //  VALIDATION GATE: runs before any LLM call 
  const clarification = validateRequest(intent, resolved, message.trim());
  if (clarification) {
    return res.status(200).json(clarification);
  }

  //  Proceed to AI generation 
  try {
    if (openai) {
      return res.status(200).json(await aiResponse(message.trim(), resolved, intent));
    }
    const { composeChatResponse } = await import("../../lib/copilot/responseComposer.js");
    return res.status(200).json(composeChatResponse(message.trim(), context || {}));
  } catch (err) {
    console.error("[edgex/chat]", err);
    return res.status(500).json({ ok: false, error: "EDGEX is temporarily unavailable.", message: err.message });
  }
}

// ============================================================================
// AI RESPONSE
// ============================================================================

async function aiResponse(message, resolved, intent) {
  const graphData  = buildCareerGraphData(resolved.role, resolved.target);
  const userContent = buildUserMessage(message, resolved, graphData);

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
  const { reply, nextActions } = parseActions(raw);

  return {
    ok: true,
    data: {
      reply,
      intent:          { name: intent, confidence: 0.9 },
      insights:        null,
      recommendations: [],
      next_actions:    nextActions,
      context:         updateCtx(resolved, intent),
    },
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function buildUserMessage(message, resolved, graphData) {
  const parts = [];

  const ctxLines = [];
  if (resolved.role)     ctxLines.push("Current role: "        + resolved.role);
  if (resolved.target)   ctxLines.push("Target role: "         + resolved.target);
  if (resolved.yearsExp) ctxLines.push("Years of experience: " + resolved.yearsExp);
  if (resolved.country)  ctxLines.push("Country: "             + resolved.country);
  if (resolved.lastIntent) ctxLines.push("Previous topic: "    + resolved.lastIntent.replace(/_/g, " "));

  if (ctxLines.length > 0) {
    parts.push("[SESSION MEMORY -- do not ask for this again]\n" + ctxLines.join("\n"));
  }
  if (graphData) parts.push(graphData);
  parts.push("[USER MESSAGE]\n" + message);
  return parts.join("\n\n");
}

function parseActions(raw) {
  if (!raw) return { reply: "", nextActions: [] };

  let nextActions = [];

  // Extract [ACTIONS]...[/ACTIONS] block
  const match = raw.match(/\[ACTIONS\]([\s\S]*?)\[\/ACTIONS\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[1].trim());
      nextActions = Array.isArray(parsed) ? parsed : [];
    } catch { nextActions = []; }
  }

  // Strip ALL action-related blocks from reply -- even unclosed ones
  let reply = raw
    .replace(/\[ACTIONS\][\s\S]*?\[\/ACTIONS\]/g, "")  // closed block
    .replace(/\[ACTIONS\][\s\S]*/g, "")                   // unclosed block (LLM forgot closing tag)
    .replace(/\[\/ACTIONS\]/g, "")                         // orphan closing tag
    .trim();

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
  if (/roadmap|plan|path|90.day|30.day|next step|what should/.test(t)) return "career_planning";
  return "general_career";
}

function updateCtx(resolved, intent) {
  return {
    role:       resolved.role       || null,
    target:     resolved.target     || null,
    yearsExp:   resolved.yearsExp   || null,
    country:    resolved.country    || null,
    lastIntent: intent,
  };
}
