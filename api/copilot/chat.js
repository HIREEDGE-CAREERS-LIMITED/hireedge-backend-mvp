// ============================================================================
// api/copilot/chat.js  (v5)
// HireEdge -- EDGEX Tool Routing Engine
//
// Pipeline per request:
//   1. Validate input + parse body
//   2. resolveContext() -- extract roles from message
//   3. validateRequest() -- gate for missing required fields
//   4. detectIntent() -- classify the message
//   5. routeTool() -- map intent to tool endpoint
//   6. If routable: callTool() -> format with LLM
//      If general:  LLM answers directly
//      If unclear:  return clarification
//
// Every response shape:
//   { ok: true, data: { intent, tool_used, reply, next_actions, context } }
// ============================================================================

import OpenAI from "openai";
import { getRoleBySlug } from "../../lib/dataset/roleIndex.js";
import { detectIntent, routeTool, callTool } from "../../lib/copilot/intentRouter.js";

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

//  Intent -> required fields map 

const INTENT_REQUIREMENTS = {
  career_transition: {
    required: ["current_role", "target_role"],
    messages: {
      current_role: "What is your current role?",
      target_role:  "What role do you want to move into?",
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
    messages: { target_role: "Which role are you interviewing for?" },
  },
  resume_optimise: {
    required: ["target_role"],
    messages: { target_role: "Which role are you optimising your CV for?" },
  },
  linkedin_optimise: {
    required: ["target_role"],
    messages: { target_role: "Which role are you optimising your profile for?" },
  },
  salary_benchmark:  { required: [] },
  visa_eligibility:  { required: [] },
  general_career:    { required: [] },
  unclear:           { required: [] },
};

//  Validation gate 

function validateRequest(intent, resolved) {
  const spec = INTENT_REQUIREMENTS[intent] || { required: [] };
  const missing = spec.required.filter(f =>
    f === "current_role" ? !resolved.role : !resolved.target
  );
  if (missing.length === 0) return null;

  const labels  = missing.map(f => f === "current_role" ? "your current role" : "your target role");
  const actions = missing.map(f => ({
    type:   "question",
    label:  spec.messages[f],
    prompt: spec.messages[f],
  }));

  const intentLabel = {
    career_transition: "a career transition plan",
    skill_gap:         "a skill gap analysis",
    resume_optimise:   "CV optimisation",
    linkedin_optimise: "LinkedIn optimisation",
    interview_prep:    "interview preparation",
  }[intent] || "this";

  return {
    ok: true,
    data: {
      type:           "clarification",
      reply:          "To build " + intentLabel + ", I need " + labels.join(" and ") + " first.",
      intent:         { name: intent, confidence: 0.9 },
      tool_used:      null,
      missing_fields: missing,
      next_actions:   actions,
      recommendations: [],
      context:        resolved,
    },
  };
}

//  Context resolver 

const ROLE_RE = [
  [/(?<![a-zA-Z])from\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)\s+(?:to|into)\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)(?=[,.]|$|\?|\s+(?:role|as)\b)/i, "both"],
  [/\bi\s+(?:work|worked)\s+as\s+(?:a |an )?([a-z][a-z -]{1,24}?)\s+and\s+(?:want|need|hope|plan|look)/i, "role"],
  [/\bi\s+am\s+(?:currently\s+)?(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)(?=\s+(?:and|looking|wanting|hoping|trying|aiming|moving|planning|who)\b|[,.]|$)/i, "role"],
  [/\bcurrently\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)(?=[,.]|\s+(?:and|looking|aiming)\b|$)/i, "role"],
  [/want(?:ing)?\s+to\s+(?:be|become|transition\s+(?:to|into)|move\s+into)\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)(?=[,.]|$|\?|\s+role\b)/i, "target"],
  [/(?<![a-z])(?:become|move\s+into|transition\s+(?:to|into)|moving\s+(?:to|into))\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)(?=[,.]|$|\?|\s+role\b)/i, "target"],
  [/aim(?:ing)?\s+(?:for|to\s+become)\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)(?=[,.]|$|\s+role\b)/i, "target"],
];
const SHORT_X_TO_Y = /^([A-Za-z][A-Za-z -]{2,25}?)\s+to\s+([A-Za-z][A-Za-z -]{2,25})$/i;

function extractRoles(message) {
  let role = null, target = null;
  const t = (message || "").toLowerCase().trim();
  if (t.split(/\s+/).length <= 6) {
    const m = SHORT_X_TO_Y.exec(t);
    if (m) { role = m[1].trim(); target = m[2].trim(); }
  }
  for (const [re, kind] of ROLE_RE) {
    const m = re.exec(t);
    if (!m) continue;
    if (kind === "both") { if (!role) role = m[1].trim(); if (!target && m[2]) target = m[2].trim(); }
    else if (kind === "role"   && !role)   role   = m[1].trim();
    else if (kind === "target" && !target) target = m[1].trim();
    if (role && target) break;
  }
  return { role, target };
}

function resolveContext(context, message) {
  const extracted = extractRoles(message);
  return {
    role:     extracted.role   || context?.role   || null,
    target:   extracted.target || context?.target || null,
    yearsExp: context?.yearsExp || null,
    country:  context?.country  || null,
  };
}

function safeContext(ctx) {
  if (!ctx) return {};
  const out = {};
  for (const k of ["role", "target", "yearsExp", "country", "lastIntent"]) {
    if (ctx[k] != null) out[k] = ctx[k];
  }
  return out;
}

//  Career graph (inlined) 

const SEN_RANK = { junior:1, mid:2, senior:3, lead:4, head:5, director:6, vp:7, c_suite:8 };

function findRole(title) {
  if (!title) return null;
  try {
    const slug = title.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    return getRoleBySlug(slug) || null;
  } catch { return null; }
}

function buildCareerGraph(fromTitle, toTitle) {
  const from = findRole(fromTitle), to = findRole(toTitle);
  if (!from && !to) return "";
  const lines = ["[CAREER GRAPH DATA -- use these numbers in your response]"];
  if (from) {
    const skills = [...(from.skills_grouped?.core||[]), ...(from.skills_grouped?.technical||[])];
    lines.push("FROM: " + from.title, "  Salary: GBP" + (from.salary_uk?.mean?.toLocaleString("en-GB")||"n/a"), "  Skills: " + skills.slice(0,6).join(", "));
  }
  if (to) {
    const skills = [...(to.skills_grouped?.core||[]), ...(to.skills_grouped?.technical||[])];
    lines.push("TO: " + to.title, "  Salary: GBP" + (to.salary_uk?.mean?.toLocaleString("en-GB")||"n/a"), "  Demand: " + (to.demand_score||50)+"/100", "  Skills: " + skills.slice(0,6).join(", "));
  }
  if (from && to) {
    const fromSet = new Set([...(from.skills_grouped?.core||[]), ...(from.skills_grouped?.technical||[])].map(s=>s.toLowerCase()));
    const toSkills = [...(to.skills_grouped?.core||[]), ...(to.skills_grouped?.technical||[])].map(s=>s.toLowerCase());
    const overlap = toSkills.filter(s=>fromSet.has(s));
    const missing = toSkills.filter(s=>!fromSet.has(s));
    const matchPct = toSkills.length ? Math.round(overlap.length/toSkills.length*100) : 50;
    const senDelta = Math.max(0,(SEN_RANK[to.seniority]||3)-(SEN_RANK[from.seniority]||3));
    const diff = Math.min(100,Math.round((to.difficulty_to_enter||50)*0.5+(100-matchPct)*0.35+senDelta*5));
    const rate = Math.max(15,Math.min(90,Math.round(matchPct*0.5+(100-diff)*0.35+(from.demand_score||50)*0.15)));
    const tMin = Math.max(2,Math.round(missing.length*0.8+senDelta*2+(to.time_to_hire||3))-2);
    const fromSal = from.salary_uk?.mean||0, toSal = to.salary_uk?.mean||0;
    const salD = fromSal>0&&toSal>0 ? (((toSal-fromSal)/fromSal)*100).toFixed(0) : null;
    lines.push(
      "METRICS: Difficulty=" + diff + "/100 | Success=" + rate + "% | Timeline=" + tMin + "-" + (tMin+4) + "m",
      salD!=null ? "  Salary: "+(salD>=0?"+":"")+salD+"% (GBP"+fromSal.toLocaleString("en-GB")+" -> GBP"+toSal.toLocaleString("en-GB")+")" : "  Salary: n/a",
      "  Skill match: " + matchPct + "% | Missing: " + missing.slice(0,5).join(", "),
      "  Transferable: " + overlap.slice(0,4).join(", ")
    );
  }
  return lines.join("\n");
}

//  System prompt 

const SYSTEM = `You are EDGEX -- HireEdge's Career Intelligence Engine.

ROLE: Format tool data into clear, structured career intelligence. You do NOT generate plans from scratch -- you format real data from tools.

RULES:
1. When tool_data is provided, format ONLY that data. Do not add invented content.
2. NEVER invent or assume a role name.
3. Answer general questions (salary, market, skills, visa) directly even when context has roles.
4. If the user states new roles, use those immediately.
5. UK English throughout. No filler. No hedging.
6. NEVER say "I can only provide information about your current transition".

FORMAT when tool_data provided:
Use the exact numbers from tool_data. Structure with sections:
**TRANSITION SNAPSHOT** / **SKILL GAP BREAKDOWN** / **MARKET EXPECTATION (UK)** / **STRATEGIC POSITIONING** / **NEXT BEST ACTION**

FORMAT for general questions:
Answer directly in 2-4 sentences. No structured format needed.

NEXT ACTIONS (mandatory at end -- always include):
[ACTIONS]
[{"type":"question","label":"Short label","prompt":"Full question"},{"type":"tool","label":"Open tool","endpoint":"/api/tools/career-gap-explainer","prompt":""}]
[/ACTIONS]`;

//  LLM formatter 

async function formatWithLLM(message, resolved, intent, toolData, graphData) {
  const parts = [];

  if (resolved.role || resolved.target) {
    const ctx = [];
    if (resolved.role)   ctx.push("Current role: " + resolved.role);
    if (resolved.target) ctx.push("Target role: "  + resolved.target);
    if (resolved.country) ctx.push("Country: " + resolved.country);
    parts.push("[SESSION MEMORY]\n" + ctx.join("\n"));
  }

  if (graphData) parts.push(graphData);

  if (toolData) {
    parts.push("[TOOL DATA -- format this into your response]\n" + JSON.stringify(toolData, null, 2).slice(0, 2000));
  }

  parts.push("[USER MESSAGE]\n" + message);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user",   content: parts.join("\n\n") },
    ],
    temperature: 0.3,
    max_tokens: 900,
  });

  const raw = completion.choices?.[0]?.message?.content?.trim() || "";
  return parseActions(raw);
}

function parseActions(raw) {
  if (!raw) return { reply: "", nextActions: [] };
  let nextActions = [];
  const match = raw.match(/\[ACTIONS\]([\s\S]*?)\[\/ACTIONS\]/);
  if (match) {
    try { nextActions = JSON.parse(match[1].trim()); } catch { nextActions = []; }
    if (!Array.isArray(nextActions)) nextActions = [];
  }
  const reply = raw
    .replace(/\[ACTIONS\][\s\S]*?\[\/ACTIONS\]/g, "")
    .replace(/\[ACTIONS\][\s\S]*/g, "")
    .replace(/\[\/ACTIONS\]/g, "")
    .trim();
  return { reply, nextActions };
}

function updateCtx(resolved, intent) {
  return { ...safeContext(resolved), lastIntent: intent };
}

//  Handler 

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}; }
  catch { return res.status(400).json({ error: "Invalid JSON." }); }

  const { message, context } = body;
  if (!message?.trim()) return res.status(400).json({ error: "message is required." });

  const msg      = message.trim();
  const resolved = resolveContext(context, msg);

  //  1. Detect intent 
  const { intent, confidence, slots } = detectIntent(msg, resolved);
  console.log("[chat] intent=" + intent + " confidence=" + confidence.toFixed(2) + " role=" + resolved.role + " target=" + resolved.target);

  // Merge extracted slots into resolved
  if (slots.role    && !resolved.role)    resolved.role    = slots.role;
  if (slots.target  && !resolved.target)  resolved.target  = slots.target;
  if (slots.country && !resolved.country) resolved.country = slots.country;

  //  2. Validate required fields 
  const clarification = validateRequest(intent, resolved);
  if (clarification) {
    console.log("[chat] clarification required, missing fields:", clarification.data.missing_fields);
    return res.status(200).json(clarification);
  }

  //  3. Route to tool 
  const route = routeTool(intent, { ...resolved, ...slots });

  try {
    let toolData    = null;
    let toolUsed    = null;
    let toolError   = null;

    if (route?.canRoute) {
      console.log("[chat] routing to tool:", route.endpoint);
      const toolResult = await callTool(route);
      if (toolResult.ok) {
        toolData = toolResult.data;
        toolUsed = route.endpoint;
        console.log("[chat] tool succeeded:", route.endpoint);
      } else {
        toolError = toolResult.error;
        console.warn("[chat] tool failed:", route.endpoint, toolResult.error);
      }
    }

    //  4. LLM formats the response 
    if (!openai) {
      return res.status(200).json({
        ok: true,
        data: {
          intent:      { name: intent, confidence },
          tool_used:   toolUsed,
          reply:       toolData ? JSON.stringify(toolData).slice(0, 300) : "EDGEX is initialising.",
          next_actions: [],
          context:     updateCtx(resolved, intent),
        },
      });
    }

    const graphData = buildCareerGraph(resolved.role, resolved.target);
    const { reply, nextActions } = await formatWithLLM(msg, resolved, intent, toolData, graphData);

    return res.status(200).json({
      ok: true,
      data: {
        intent:      { name: intent, confidence },
        tool_used:   toolUsed,
        tool_error:  toolError || undefined,
        reply,
        next_actions: nextActions,
        context:     updateCtx(resolved, intent),
        recommendations: [],
        insights:    null,
      },
    });

  } catch (err) {
    console.error("[chat] handler error:", err);
    return res.status(500).json({ ok: false, error: "EDGEX is temporarily unavailable.", message: err.message });
  }
}
