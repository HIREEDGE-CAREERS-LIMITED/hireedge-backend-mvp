// ============================================================================
// api/tools/career-roadmap.js
// HireEdge Backend — Career Roadmap (Production v4)
//
// POST body:
//   fromRole    string        required   slug
//   toRole      string        required   slug
//   strategy    string        optional   fastest|safe|highest_paid  (default: safe)
//   skills      string|array  optional
//   yearsExp    number        optional
//   resumeText  string        optional   CV — drives hyper-personalisation
//
// v4 AI additions over v3:
//   probability_scores    — transition_confidence / skills_readiness / market_demand
//   decision_layer        — recommended path verdict, risk level, why this path wins
//   risks                 — what_can_go_wrong, failure_reasons, mitigations
//   bridge_strategy       — always-present actionable plan (replaces "no direct path")
//   personalisation_hook  — opening paragraph using candidate's exact background
//   this_week             — actions now include why_it_matters + expected_outcome
//   phase actions         — now include why_it_matters + expected_outcome
//   strengths             — adds competitive_advantage field
//   gaps                  — adds severity + time_to_close
// ============================================================================

import OpenAI from "openai";
import { buildRoadmap, buildMultiRoadmap } from "../../lib/tools/roadmapEngine.js";
import { getRoleBySlug, getRoleMap }        from "../../lib/dataset/roleIndex.js";
import { getNextMoves, getPreviousMoves }   from "../../lib/graph/careerPathEngine.js";
import { enforceBilling }                   from "../../lib/billing/billingMiddleware.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET")     return _legacyGet(req, res);
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });
  if (enforceBilling(req, res, "career-roadmap")) return;

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON" });
  }

  const {
    fromRole   = "",
    toRole     = "",
    strategy   = "safe",
    skills     = "",
    yearsExp   = null,
    resumeText = "",
  } = body;

  if (!fromRole || !toRole) {
    return res.status(400).json({ ok: false, error: "fromRole and toRole are required" });
  }

  const fromData = getRoleBySlug(fromRole);
  const toData   = getRoleBySlug(toRole);
  if (!fromData)  return res.status(404).json({ ok: false, error: `Role not found: ${fromRole}` });
  if (!toData)    return res.status(404).json({ ok: false, error: `Role not found: ${toRole}` });

  const skillList = Array.isArray(skills)
    ? skills.filter(Boolean)
    : (skills || "").split(",").map((s) => s.trim()).filter(Boolean);

  const validStrats = ["fastest", "safe", "highest_paid", "easiest"];
  const strat       = validStrats.includes(strategy) ? strategy : "safe";

  // ── 1. Graph engine paths ─────────────────────────────────────────────────
  const roadmap  = buildRoadmap(fromRole, toRole, { strategy: strat, maxDepth: 8 });
  let graphData  = roadmap?.reachable
    ? { ...roadmap, bridge_mode: false }
    : _buildBridgePath(fromRole, toRole, fromData, toData, strat);

  // Alternative strategy paths (context for AI)
  const fastPath = strat !== "fastest"      ? buildRoadmap(fromRole, toRole, { strategy: "fastest",      maxDepth: 8 }) : null;
  const easyPath = strat !== "easiest"      ? buildRoadmap(fromRole, toRole, { strategy: "easiest",      maxDepth: 8 }) : null;
  const paidPath = strat !== "highest_paid" ? buildRoadmap(fromRole, toRole, { strategy: "highest_paid", maxDepth: 8 }) : null;

  // ── 2. AI layer ───────────────────────────────────────────────────────────
  let ai = _emptyAI();
  if (process.env.OPENAI_API_KEY) {
    try {
      ai = await _aiLayer({ fromData, toData, skillList, yearsExp, resumeText, strat, graphData, fastPath, easyPath, paidPath });
    } catch (err) {
      console.error("[career-roadmap] AI error:", err.message);
    }
  }

  return res.status(200).json({
    ok:   true,
    data: {
      from:          graphData.from,
      to:            graphData.to,
      reachable:     graphData.reachable,
      bridge_mode:   graphData.bridge_mode,
      bridge_role:   graphData.bridge_role   || null,
      steps:         graphData.steps         || [],
      summary:       graphData.summary       || null,
      alternatives:  graphData.alternatives  || [],
      adjacent_from: graphData.adjacent_from || [],
      adjacent_to:   graphData.adjacent_to   || [],
      ai,
    },
  });
}

// =============================================================================
// AI layer — v4 strategic decision engine
// =============================================================================

async function _aiLayer({ fromData, toData, skillList, yearsExp, resumeText, strat, graphData, fastPath, easyPath, paidPath }) {
  const fromCore = fromData?.skills_grouped?.core      || [];
  const fromTech = fromData?.skills_grouped?.technical || [];
  const toCore   = toData?.skills_grouped?.core        || [];
  const toTech   = toData?.skills_grouped?.technical   || [];

  const pathStr  = (graphData.steps || []).map((s) => s.title).join(" → ") || "No direct graph path";
  const fastStr  = fastPath?.reachable ? fastPath.steps.map((s) => s.title).join(" → ") : null;
  const easyStr  = easyPath?.reachable ? easyPath.steps.map((s) => s.title).join(" → ") : null;
  const paidStr  = paidPath?.reachable ? paidPath.steps.map((s) => s.title).join(" → ") : null;

  const isDirectPath = graphData.reachable && !graphData.bridge_mode;
  const isBridge     = graphData.bridge_mode;

  const ctx = [
    `FROM ROLE: ${fromData.title} (${fromData.category}, ${fromData.seniority})`,
    fromData.salary_uk?.mean ? `FROM SALARY: ~£${fromData.salary_uk.mean.toLocaleString()}` : null,
    `TO ROLE: ${toData.title} (${toData.category}, ${toData.seniority})`,
    toData.salary_uk?.mean   ? `TO SALARY: ~£${toData.salary_uk.mean.toLocaleString()}` : null,
    `PREFERRED STRATEGY: ${strat}`,
    yearsExp         ? `YEARS OF EXPERIENCE: ${yearsExp}` : null,
    skillList.length ? `CANDIDATE SKILLS: ${skillList.slice(0, 20).join(", ")}` : null,
    fromCore.length  ? `FROM ROLE CORE SKILLS: ${fromCore.slice(0, 8).join(", ")}` : null,
    toCore.length    ? `TARGET ROLE CORE SKILLS: ${toCore.slice(0, 8).join(", ")}` : null,
    toTech.length    ? `TARGET ROLE TECHNICAL SKILLS: ${toTech.slice(0, 6).join(", ")}` : null,
    `GRAPH PATH (${strat}): ${pathStr}`,
    fastStr ? `FASTEST PATH AVAILABLE: ${fastStr}` : null,
    easyStr ? `EASIEST PATH AVAILABLE: ${easyStr}` : null,
    paidStr ? `HIGHEST-PAID PATH AVAILABLE: ${paidStr}` : null,
    graphData.summary ? `ESTIMATED TOTAL YEARS: ~${graphData.summary.total_estimated_years}` : null,
    graphData.bridge_role ? `BRIDGE ROLE: ${graphData.bridge_role.title}` : null,
    `PATH TYPE: ${isDirectPath ? "Direct graph path exists" : isBridge ? "Bridge path via intermediary" : "No graph path — bridge strategy required"}`,
    resumeText ? `\nCANDIDATE BACKGROUND (CV):\n${resumeText.slice(0, 2000)}` : null,
  ].filter(Boolean).join("\n");

  // ── System: tone and rules ────────────────────────────────────────────────
  const system = `You are a McKinsey-level UK career strategist producing a bespoke career strategy document.

TONE STANDARD:
- Every claim is specific and evidenced — no vague reassurances
- Lead with the conclusion, then provide the rationale
- Use the candidate's actual background as the frame of reference throughout
- Name specific skills, roles, timeframes, and market signals
- No hedging: never write "you might", "could be helpful", "it may be worth", "fairly", "quite", "somewhat"
- Write as if you've analysed this candidate's profile and are presenting findings at a board meeting
- Paragraphs are punchy — 2–3 sentences max per block
- UK spelling throughout: organise, specialise, programme, recognise, colour

WHAT HYPER-PERSONALISATION MEANS:
- If the CV mentions sales experience → reference how enterprise pipeline management maps to stakeholder prioritisation
- If the CV mentions founding a company → reference that as proof of execution, not just a claim
- If the CV mentions data or analytics → reference that as a competitive differentiator against candidates from traditional routes
- Never write an answer that could apply to any random person doing this transition

Return ONLY valid JSON. No markdown, no backticks, no prose outside JSON.`;

  // ── User: full schema ─────────────────────────────────────────────────────
  const user = `${ctx}

Generate a complete strategic career decision document. Return this exact JSON:

{
  "personalisation_hook": "Opening paragraph (3–4 sentences) that references THIS candidate's specific background — not generic transition advice. Name their actual role type, any skills from the list, and why that combination makes this transition viable or challenging. Sounds like a strategist who has read their file.",

  "probability_scores": {
    "transition_confidence": 0,
    "transition_confidence_rationale": "2 sentences explaining this score. Reference specific transferable assets or gaps that drive it up or down.",
    "skills_readiness": 0,
    "skills_readiness_rationale": "2 sentences. Name the specific skills they have vs. what the target role requires.",
    "market_demand": 0,
    "market_demand_rationale": "2 sentences on UK market conditions for ${toData.title} — demand trend, competition, hiring volume."
  },

  "decision_layer": {
    "recommended_path_label": "e.g. 'Safe path via internal pivot' or 'Direct application with bridge-building'",
    "why_this_path_wins": "3–4 sentences explaining why this specific path is optimal for THIS candidate's profile. Reference their background directly. Compare against why the fastest path or alternative would be inferior for them specifically.",
    "risk_level": "low | medium | high | very high",
    "risk_level_rationale": "2 sentences. What specifically makes this risky or safe for this person.",
    "decision_confidence": "One of: High — act now | Moderate — validate first | Low — gather more information"
  },

  "feasibility": {
    "label": "One of: very achievable | achievable | challenging | ambitious | unconventional",
    "headline": "One precise, McKinsey-style verdict sentence. Not 'This is an exciting opportunity' — something like 'The commercial track record transfers directly; the credibility gap is product process, not product thinking.'",
    "why": "2–3 sentences. Specific to this role pair and this candidate's background. Name the actual competency overlap and the actual gap."
  },

  "recommended_path": {
    "label": "Safe path",
    "headline": "One sentence describing the route and its core logic",
    "total_timeline": "e.g. 12–18 months",
    "difficulty": "achievable",
    "phases": [
      {
        "label": "0–3 months",
        "title": "Short evocative title",
        "goal": "One sentence — the concrete milestone that marks success at end of phase",
        "actions": [
          {
            "action": "Specific, named action — not a category but an actual task",
            "detail": "How to execute this. Name platforms, outputs, contacts. 1–2 sentences.",
            "why_it_matters": "Why this action is a prerequisite for the next phase. 1 sentence.",
            "expected_outcome": "What doing this produces — a signal, a skill, a proof point, a door. 1 sentence."
          },
          {
            "action": "Second action",
            "detail": "Detail",
            "why_it_matters": "Why",
            "expected_outcome": "Outcome"
          },
          {
            "action": "Third action",
            "detail": "Detail",
            "why_it_matters": "Why",
            "expected_outcome": "Outcome"
          }
        ],
        "skills_focus": ["Skill 1", "Skill 2", "Skill 3", "Skill 4"]
      },
      {
        "label": "3–6 months",
        "title": "Short title",
        "goal": "Concrete milestone",
        "actions": [
          { "action": "string", "detail": "string", "why_it_matters": "string", "expected_outcome": "string" },
          { "action": "string", "detail": "string", "why_it_matters": "string", "expected_outcome": "string" },
          { "action": "string", "detail": "string", "why_it_matters": "string", "expected_outcome": "string" }
        ],
        "skills_focus": ["Skill 1", "Skill 2", "Skill 3"]
      },
      {
        "label": "6–12 months",
        "title": "Short title",
        "goal": "Concrete milestone",
        "actions": [
          { "action": "string", "detail": "string", "why_it_matters": "string", "expected_outcome": "string" },
          { "action": "string", "detail": "string", "why_it_matters": "string", "expected_outcome": "string" },
          { "action": "string", "detail": "string", "why_it_matters": "string", "expected_outcome": "string" }
        ],
        "skills_focus": ["Skill 1", "Skill 2", "Skill 3"]
      }
    ]
  },

  "risks": [
    {
      "risk": "Precise name of the risk — not 'it might be hard' but 'Credibility gap in product process methodology'",
      "why_it_happens": "Why this specific candidate faces this specific risk. 1–2 sentences. Reference their background.",
      "probability": "low | medium | high",
      "mitigation": "The specific action that neutralises this risk before it becomes a blocker. 1–2 sentences."
    },
    {
      "risk": "Second risk",
      "why_it_happens": "string",
      "probability": "medium | high | low",
      "mitigation": "string"
    },
    {
      "risk": "Third risk",
      "why_it_happens": "string",
      "probability": "string",
      "mitigation": "string"
    },
    {
      "risk": "Fourth risk",
      "why_it_happens": "string",
      "probability": "string",
      "mitigation": "string"
    }
  ],

  "common_failure_reasons": [
    "Specific reason candidates with this background typically fail this transition — not generic. 1 sentence.",
    "Second failure reason",
    "Third failure reason"
  ],

  "bridge_strategy": {
    "required": true,
    "headline": "One sentence naming the bridge approach",
    "why_direct_is_blocked": "1–2 sentences on exactly what blocks a direct application. If a direct path exists in the graph, explain why the bridge still adds value.",
    "bridge_steps": [
      {
        "step": 1,
        "title": "Name of the bridge step or role",
        "duration": "e.g. 3–6 months",
        "what_to_do": "Specific action at this step",
        "what_it_unlocks": "What this step makes possible that wasn't possible before"
      },
      {
        "step": 2,
        "title": "string",
        "duration": "string",
        "what_to_do": "string",
        "what_it_unlocks": "string"
      },
      {
        "step": 3,
        "title": "string",
        "duration": "string",
        "what_to_do": "string",
        "what_it_unlocks": "string"
      }
    ]
  },

  "strengths_to_leverage": [
    {
      "strength": "Named, specific strength from this candidate's background",
      "how_to_use": "Concrete deployment advice — in interviews, in the role, in the job search. 1–2 sentences.",
      "competitive_advantage": "Why this strength is rare among candidates applying for ${toData.title} who came up through the traditional route. 1 sentence."
    },
    {
      "strength": "Second strength",
      "how_to_use": "string",
      "competitive_advantage": "string"
    },
    {
      "strength": "Third strength",
      "how_to_use": "string",
      "competitive_advantage": "string"
    }
  ],

  "gaps_to_close": [
    {
      "gap": "Precise gap name",
      "why_it_matters": "Why hiring managers for ${toData.title} will probe this. 1 sentence.",
      "how_to_close": "Specific, named method. Not 'study Agile' but 'complete a sprint cycle as a volunteer PM on a side project and document the output'. 1–2 sentences.",
      "severity": "critical | significant | minor",
      "time_to_close": "e.g. 4–8 weeks"
    },
    {
      "gap": "Second gap",
      "why_it_matters": "string",
      "how_to_close": "string",
      "severity": "string",
      "time_to_close": "string"
    },
    {
      "gap": "Third gap",
      "why_it_matters": "string",
      "how_to_close": "string",
      "severity": "string",
      "time_to_close": "string"
    },
    {
      "gap": "Fourth gap",
      "why_it_matters": "string",
      "how_to_close": "string",
      "severity": "string",
      "time_to_close": "string"
    }
  ],

  "alternative_paths": [
    {
      "label": "Fastest path",
      "headline": "One sentence",
      "route": ["${fromData.title}", "${toData.title}"],
      "timeline": "e.g. 6–9 months",
      "trade_off": "What you sacrifice. Be specific.",
      "best_for": "Who this approach suits. One sentence."
    },
    {
      "label": "Via [specific bridge role]",
      "headline": "One sentence",
      "route": ["${fromData.title}", "Bridge role", "${toData.title}"],
      "timeline": "string",
      "trade_off": "string",
      "best_for": "string"
    },
    {
      "label": "Lateral pivot",
      "headline": "One sentence",
      "route": ["${fromData.title}", "Adjacent role", "${toData.title}"],
      "timeline": "string",
      "trade_off": "string",
      "best_for": "string"
    }
  ],

  "this_week": [
    {
      "action": "Specific, named, completable-in-7-days action",
      "detail": "How exactly. Name platform, output, contact type. 1–2 sentences.",
      "why_it_matters": "Why this is the highest-leverage first action. 1 sentence.",
      "expected_outcome": "What you will have at the end of this action. 1 sentence."
    },
    {
      "action": "Second action",
      "detail": "string",
      "why_it_matters": "string",
      "expected_outcome": "string"
    },
    {
      "action": "Third action",
      "detail": "string",
      "why_it_matters": "string",
      "expected_outcome": "string"
    }
  ],

  "salary_trajectory": {
    "current": "e.g. £45,000–£60,000",
    "target": "e.g. £55,000–£85,000",
    "note": "One sentence on UK market conditions, timing, and what maximises the salary at the target role"
  }
}

MANDATORY PERSONALISATION RULES:
- personalisation_hook MUST reference the candidate's specific skills list or CV — not generic transition narrative
- Every risk must reference why THIS candidate (not a generic career-changer) faces it
- probability_scores must be calibrated to actual skill overlap between the two role datasets provided
- bridge_strategy.required = true always — even if a direct path exists, the bridge adds credibility-building value
- common_failure_reasons must be transition-specific, not generic career advice`;

  const raw  = await _callAI(system, user);
  return _parseJson(raw);
}

// =============================================================================
// Bridge path (graph engine — unchanged logic from v3)
// =============================================================================

function _buildBridgePath(fromSlug, toSlug, fromData, toData, strat) {
  const fromNext = _safe(() => getNextMoves(fromSlug,  { limit: 20 })) || [];
  const toPrev   = _safe(() => getPreviousMoves(toSlug, { limit: 20 })) || [];

  const fromSet  = new Set(fromNext.map((r) => r.slug));
  const toPrevSet= new Set(toPrev.map((r)  => r.slug));
  const bridges  = [...fromSet].filter((s) => toPrevSet.has(s));

  if (bridges.length > 0) {
    const bridgeSlug = bridges[0];
    const leg1 = buildRoadmap(fromSlug,   bridgeSlug, { strategy: strat, maxDepth: 6 });
    const leg2 = buildRoadmap(bridgeSlug, toSlug,     { strategy: strat, maxDepth: 6 });

    if (leg1?.reachable && leg2?.reachable) {
      const allSteps = [
        ...leg1.steps,
        ...leg2.steps
          .filter((s) => s.slug !== bridgeSlug)
          .map((s) => ({ ...s, step: leg1.steps.length + s.step - 1 })),
      ];
      return {
        reachable:   true,
        bridge_mode: true,
        bridge_role: { slug: bridgeSlug, title: getRoleBySlug(bridgeSlug)?.title || bridgeSlug },
        from:        _roleSummary(fromData),
        to:          _roleSummary(toData),
        steps:       allSteps,
        summary: {
          total_steps:           allSteps.length,
          total_estimated_years: (leg1.summary.total_estimated_years || 0) + (leg2.summary.total_estimated_years || 0),
          salary_growth_pct:     _safe(() => Math.round(((toData.salary_uk?.mean - fromData.salary_uk?.mean) / fromData.salary_uk?.mean) * 100)) || null,
          via_bridge:            true,
        },
        alternatives: _buildAlternativeTargets(fromSlug, toData, strat),
      };
    }
  }

  return {
    reachable:    false,
    bridge_mode:  true,
    from:         _roleSummary(fromData),
    to:           _roleSummary(toData),
    adjacent_from:fromNext.slice(0, 6).map((r) => ({ slug: r.slug, title: r.title, difficulty_label: r.difficulty_label || null })),
    adjacent_to:  toPrev.slice(0, 6).map((r)  => ({ slug: r.slug, title: r.title })),
    alternatives: _buildAlternativeTargets(fromSlug, toData, strat),
  };
}

function _buildAlternativeTargets(fromSlug, toData, strat) {
  try {
    const all = Object.values(getRoleMap() || {});
    const same = all.filter((r) => r.category === toData.category && r.slug !== toData.slug && r.slug !== fromSlug).slice(0, 10);
    const out  = [];
    for (const r of same) {
      const rm = buildRoadmap(fromSlug, r.slug, { strategy: strat, maxDepth: 6 });
      if (rm?.reachable) {
        out.push({ slug: r.slug, title: r.title, seniority: r.seniority, total_steps: rm.summary.total_steps, total_years: rm.summary.total_estimated_years, salary_growth_pct: rm.summary.salary_growth_pct });
        if (out.length >= 3) break;
      }
    }
    return out;
  } catch { return []; }
}

// =============================================================================
// Helpers
// =============================================================================

function _roleSummary(d) {
  return { slug: d.slug, title: d.title, category: d.category, seniority: d.seniority, salary_mean: d.salary_uk?.mean || null };
}

function _emptyAI() {
  return {
    personalisation_hook:   "",
    probability_scores:     null,
    decision_layer:         null,
    feasibility:            { label: "achievable", headline: "", why: "" },
    recommended_path:       null,
    risks:                  [],
    common_failure_reasons: [],
    bridge_strategy:        null,
    strengths_to_leverage:  [],
    gaps_to_close:          [],
    alternative_paths:      [],
    this_week:              [],
    salary_trajectory:      null,
  };
}

async function _callAI(system, user) {
  const r = await openai.responses.create({
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: system },
      { role: "user",   content: user   },
    ],
  });
  return r.output?.[0]?.content?.[0]?.text?.trim() ?? "{}";
}

function _parseJson(raw) {
  let t = (raw || "").trim().replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch {
    const m = t.match(/\{[\s\S]*\}/);
    try { return JSON.parse(m?.[0] || "{}"); } catch { return {}; }
  }
}

function _safe(fn) { try { return fn(); } catch { return null; } }

function _legacyGet(req, res) {
  if (enforceBilling(req, res, "career-roadmap")) return;
  const { action, from, to, strategy, maxDepth, targets } = req.query;
  try {
    if (action === "build") {
      if (!from || !to) return res.status(400).json({ error: "Missing: from, to" });
      const strat = ["fastest","safe","easiest","highest_paid"].includes(strategy) ? strategy : "safe";
      const data  = buildRoadmap(from, to, { strategy: strat, maxDepth: maxDepth ? parseInt(maxDepth) : 6 });
      if (!data) return res.status(404).json({ error: "Role not found" });
      return res.status(200).json({ ok: true, data });
    }
    if (action === "multi") {
      if (!from || !targets) return res.status(400).json({ error: "Missing: from, targets" });
      const tList = targets.split(",").map((s) => s.trim()).filter(Boolean);
      const strat = ["fastest","safe","easiest","highest_paid"].includes(strategy) ? strategy : "safe";
      const data  = buildMultiRoadmap(from, tList, { strategy: strat });
      return res.status(200).json({ ok: true, data });
    }
    return res.status(400).json({ error: "Invalid action", valid_actions: ["build","multi"] });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
