// ============================================================================
// api/tools/career-roadmap.js
// HireEdge Backend — Career Roadmap (Production v5)
//
// PART 2 — BILLING FIX:
//   Career Roadmap is accessible to: career_pack | pro | elite
//   Inline gating replaces any billingMiddleware "pro-only" rule.
//   Returns { ok:false, reason:"access_denied", upgrade_to:"career_pack" }
//   when plan is free | starter | or anything not in ALLOWED_PLANS.
//
// v5 AI additions over v4:
//   career_strategy_box  — strengths[], risks[], approach (McKinsey-brief)
//   transition_scorecard — skill_match_pct, market_fit_pct, difficulty, timeline
//   is_it_worth_it       — verdict, salary_growth, risk_level, recommendation
//   next_step_cta        — single most important first action + why
// ============================================================================

import OpenAI from "openai";
import { buildRoadmap, buildMultiRoadmap } from "../../lib/tools/roadmapEngine.js";
import { getRoleBySlug, getRoleMap }        from "../../lib/dataset/roleIndex.js";
import { getNextMoves, getPreviousMoves }   from "../../lib/graph/careerPathEngine.js";
import { enforceBilling }                   from "../../lib/billing/billingMiddleware.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Plans that include Career Roadmap
const ALLOWED_PLANS = ["career_pack", "pro", "elite"];

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

  // ── PART 2: Inline billing gate ────────────────────────────────────────────
  // Replaces any billingMiddleware "pro-only" gating for this tool.
  // career-roadmap is included in career_pack | pro | elite.
  const plan = (req.headers["x-hireedge-plan"] || "free").toLowerCase().trim();
  if (!ALLOWED_PLANS.includes(plan)) {
    return res.status(403).json({
      ok:         false,
      reason:     "access_denied",
      upgrade_to: "career_pack",
      message:    "Career Roadmap is included in Career Pack or higher.",
    });
  }

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

  // ── 1. Graph engine ───────────────────────────────────────────────────────
  const roadmap = buildRoadmap(fromRole, toRole, { strategy: strat, maxDepth: 8 });
  let graphData  = roadmap?.reachable
    ? { ...roadmap, bridge_mode: false }
    : _buildBridgePath(fromRole, toRole, fromData, toData, strat);

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
// AI layer — v5
// =============================================================================

async function _aiLayer({ fromData, toData, skillList, yearsExp, resumeText, strat, graphData, fastPath, easyPath, paidPath }) {
  const fromCore = fromData?.skills_grouped?.core      || [];
  const fromTech = fromData?.skills_grouped?.technical || [];
  const toCore   = toData?.skills_grouped?.core        || [];
  const toTech   = toData?.skills_grouped?.technical   || [];

  const pathStr = (graphData.steps || []).map((s) => s.title).join(" → ") || "No direct graph path";
  const fastStr = fastPath?.reachable ? fastPath.steps.map((s) => s.title).join(" → ") : null;
  const easyStr = easyPath?.reachable ? easyPath.steps.map((s) => s.title).join(" → ") : null;
  const paidStr = paidPath?.reachable ? paidPath.steps.map((s) => s.title).join(" → ") : null;

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
    resumeText ? `\nCANDIDATE BACKGROUND (CV):\n${resumeText.slice(0, 2000)}` : null,
  ].filter(Boolean).join("\n");

  const system = `You are a McKinsey-level UK career strategist. You produce bespoke career strategy documents.

TONE:
- Lead with the conclusion, then evidence
- Every claim is specific and supported
- No hedging: never "you might", "could be helpful", "fairly", "quite"
- Paragraphs are 2–3 sentences max
- UK spelling throughout

Return ONLY valid JSON. No markdown, no backticks, no prose outside JSON.`;

  const user = `${ctx}

Generate a complete strategic career roadmap. Return this exact JSON:

{
  "career_strategy_box": {
    "strengths": [
      "Specific strength from candidate background that gives advantage for ${toData.title} — 1 sentence",
      "Second strength",
      "Third strength"
    ],
    "risks": [
      "Specific risk or blocker — named precisely, not generic — 1 sentence",
      "Second risk",
      "Third risk"
    ],
    "approach": "1–2 sentence direct recommendation on the optimal strategy for this specific person. Tone: senior advisor in a briefing. Example: 'The commercial track record transfers directly; the priority is closing the product process gap via a structured 90-day upskilling sprint before applying.' No platitudes."
  },

  "transition_scorecard": {
    "skill_match_pct": 0,
    "skill_match_note": "1 sentence on which specific skills match and which are missing",
    "market_fit_pct": 0,
    "market_fit_note": "1 sentence on UK market conditions and hiring volume for ${toData.title}",
    "difficulty": "Low | Medium | High",
    "timeline": "e.g. 12–18 months",
    "timeline_note": "1 sentence on what drives the timeline"
  },

  "personalisation_hook": "3–4 sentences referencing THIS candidate's specific background. Not generic transition advice. What makes their profile distinct for this move.",

  "probability_scores": {
    "transition_confidence": 0,
    "transition_confidence_rationale": "2 sentences — specific transferable assets and gaps",
    "skills_readiness": 0,
    "skills_readiness_rationale": "2 sentences — actual skills vs. target role requirements",
    "market_demand": 0,
    "market_demand_rationale": "2 sentences — UK market conditions for ${toData.title}"
  },

  "decision_layer": {
    "recommended_path_label": "e.g. 'Safe path via structured upskilling'",
    "why_this_path_wins": "3–4 sentences — why this specific path is optimal for THIS candidate. Reference their background. Compare vs. alternatives.",
    "risk_level": "low | medium | high | very high",
    "risk_level_rationale": "2 sentences on what makes this risky or safe for this person",
    "decision_confidence": "High — act now | Moderate — validate first | Low — gather more information"
  },

  "feasibility": {
    "label": "very achievable | achievable | challenging | ambitious | unconventional",
    "headline": "One precise verdict sentence. Not generic — specific to these two roles and this background.",
    "why": "2–3 sentences. Specific role pair and candidate context."
  },

  "recommended_path": {
    "label": "Safe path",
    "headline": "One sentence describing the route logic",
    "total_timeline": "e.g. 12–18 months",
    "difficulty": "achievable",
    "phases": [
      {
        "label": "0–3 months",
        "title": "Short evocative title",
        "goal": "Concrete milestone that marks end-of-phase success",
        "actions": [
          {
            "action": "Specific named action",
            "detail": "How to execute. Name platform or output. 1–2 sentences.",
            "why_it_matters": "Why prerequisite for next phase. 1 sentence.",
            "expected_outcome": "What this produces. 1 sentence."
          },
          { "action": "string", "detail": "string", "why_it_matters": "string", "expected_outcome": "string" },
          { "action": "string", "detail": "string", "why_it_matters": "string", "expected_outcome": "string" }
        ],
        "skills_focus": ["Skill 1", "Skill 2", "Skill 3", "Skill 4"]
      },
      {
        "label": "3–6 months",
        "title": "string",
        "goal": "string",
        "actions": [
          { "action": "string", "detail": "string", "why_it_matters": "string", "expected_outcome": "string" },
          { "action": "string", "detail": "string", "why_it_matters": "string", "expected_outcome": "string" },
          { "action": "string", "detail": "string", "why_it_matters": "string", "expected_outcome": "string" }
        ],
        "skills_focus": ["Skill 1", "Skill 2", "Skill 3"]
      },
      {
        "label": "6–12 months",
        "title": "string",
        "goal": "string",
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
      "risk": "Precise risk name",
      "why_it_happens": "Why this candidate faces this risk. 1–2 sentences.",
      "probability": "low | medium | high",
      "mitigation": "Specific action to neutralise it. 1–2 sentences."
    },
    { "risk": "string", "why_it_happens": "string", "probability": "string", "mitigation": "string" },
    { "risk": "string", "why_it_happens": "string", "probability": "string", "mitigation": "string" },
    { "risk": "string", "why_it_happens": "string", "probability": "string", "mitigation": "string" }
  ],

  "common_failure_reasons": [
    "Specific reason candidates with this background fail this transition — 1 sentence",
    "Second reason",
    "Third reason"
  ],

  "bridge_strategy": {
    "required": true,
    "headline": "One sentence naming the bridge approach",
    "why_direct_is_blocked": "1–2 sentences on exactly what blocks a direct application",
    "bridge_steps": [
      { "step": 1, "title": "string", "duration": "string", "what_to_do": "string", "what_it_unlocks": "string" },
      { "step": 2, "title": "string", "duration": "string", "what_to_do": "string", "what_it_unlocks": "string" },
      { "step": 3, "title": "string", "duration": "string", "what_to_do": "string", "what_it_unlocks": "string" }
    ]
  },

  "strengths_to_leverage": [
    { "strength": "string", "how_to_use": "string", "competitive_advantage": "string" },
    { "strength": "string", "how_to_use": "string", "competitive_advantage": "string" },
    { "strength": "string", "how_to_use": "string", "competitive_advantage": "string" }
  ],

  "gaps_to_close": [
    { "gap": "string", "why_it_matters": "string", "how_to_close": "string", "severity": "critical | significant | minor", "time_to_close": "string" },
    { "gap": "string", "why_it_matters": "string", "how_to_close": "string", "severity": "string", "time_to_close": "string" },
    { "gap": "string", "why_it_matters": "string", "how_to_close": "string", "severity": "string", "time_to_close": "string" },
    { "gap": "string", "why_it_matters": "string", "how_to_close": "string", "severity": "string", "time_to_close": "string" }
  ],

  "alternative_paths": [
    { "label": "Fastest path", "headline": "string", "route": ["${fromData.title}", "${toData.title}"], "timeline": "string", "trade_off": "string", "best_for": "string" },
    { "label": "Via [bridge role]", "headline": "string", "route": ["${fromData.title}", "Bridge role", "${toData.title}"], "timeline": "string", "trade_off": "string", "best_for": "string" },
    { "label": "Lateral pivot", "headline": "string", "route": ["${fromData.title}", "Adjacent role", "${toData.title}"], "timeline": "string", "trade_off": "string", "best_for": "string" }
  ],

  "this_week": [
    { "action": "Specific completable-in-7-days action", "detail": "How exactly. Name platform/output. 1–2 sentences.", "why_it_matters": "Why highest leverage first. 1 sentence.", "expected_outcome": "What you have at the end. 1 sentence." },
    { "action": "string", "detail": "string", "why_it_matters": "string", "expected_outcome": "string" },
    { "action": "string", "detail": "string", "why_it_matters": "string", "expected_outcome": "string" }
  ],

  "is_it_worth_it": {
    "verdict": "Yes | Probably | Conditional | No",
    "salary_growth": "e.g. ~15–20% within 12–18 months of transition",
    "risk_level": "low | medium | high",
    "recommendation": "1–2 sentence direct answer. Tone: trusted advisor, not cheerleader. Include the specific condition or caveat if verdict is Conditional. Example: 'Yes — strong alignment with your commercial background. Expect 15–20% salary uplift, but only after closing the product process gap.'"
  },

  "next_step_cta": {
    "action": "The single most important thing to start this week — specific, named, completable. e.g. 'Start Agile & Scrum Foundation cert on LinkedIn Learning this week'",
    "why": "Why this is the highest-leverage first action for this specific transition. 1 sentence."
  },

  "salary_trajectory": {
    "current": "e.g. £45,000–£60,000",
    "target": "e.g. £55,000–£85,000",
    "note": "1 sentence on timing and what maximises salary at target role in UK market"
  }
}

RULES:
- transition_scorecard scores must be calibrated to actual skill overlap data provided
- career_strategy_box must reference this specific candidate — not generic transition advice
- is_it_worth_it.recommendation must name the specific condition or gap, not just say "yes"
- next_step_cta must be completable in 7 days — not a quarter-long goal
- All probability scores: realistic integers 0–100`;

  const raw  = await _callAI(system, user);
  return _parseJson(raw);
}

// =============================================================================
// Bridge path logic
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
    const all  = Object.values(getRoleMap() || {});
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
    career_strategy_box:    null,
    transition_scorecard:   null,
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
    is_it_worth_it:         null,
    next_step_cta:          null,
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
  const plan = (req.headers["x-hireedge-plan"] || "free").toLowerCase().trim();
  if (!ALLOWED_PLANS.includes(plan)) {
    return res.status(403).json({ ok: false, reason: "access_denied", upgrade_to: "career_pack" });
  }
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
    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
