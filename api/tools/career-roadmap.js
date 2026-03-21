// ============================================================================
// api/tools/career-roadmap.js
// HireEdge Backend — Career Roadmap (Production v3)
//
// POST body:
//   fromRole    string        required   slug
//   toRole      string        required   slug
//   strategy    string        optional   fastest|safe|highest_paid  (default: safe)
//   skills      string|array  optional   candidate's current skills
//   yearsExp    number        optional
//   resumeText  string        optional   CV text for personalisation
//
// AI layer returns (v3):
//   recommended_path   — phased 0–3 / 3–6 / 6–12 month plan with specific actions
//   alternative_paths  — 3 named routes (fastest / safe / alternative)
//   strengths_to_leverage — specific, not generic
//   gaps_to_close         — with how-to-close per gap
//   this_week             — 3 hyper-specific immediate actions
//   feasibility           — label + headline + why
//   salary_trajectory     — current / target / note
//
// Bridge path logic and legacy GET preserved from v2.
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

  const skillList  = Array.isArray(skills)
    ? skills.filter(Boolean)
    : (skills || "").split(",").map((s) => s.trim()).filter(Boolean);

  const validStrats = ["fastest", "safe", "highest_paid", "easiest"];
  const strat       = validStrats.includes(strategy) ? strategy : "safe";

  // ── 1. Graph engine — direct path ─────────────────────────────────────────
  const roadmap = buildRoadmap(fromRole, toRole, { strategy: strat, maxDepth: 8 });
  let graphData;

  if (roadmap?.reachable) {
    graphData = { ...roadmap, bridge_mode: false };
  } else {
    graphData = _buildBridgePath(fromRole, toRole, fromData, toData, strat);
  }

  // ── 2. Alternative graph paths (for AI context) ───────────────────────────
  const fastPath   = strat !== "fastest"     ? buildRoadmap(fromRole, toRole, { strategy: "fastest",     maxDepth: 8 }) : null;
  const easyPath   = strat !== "easiest"     ? buildRoadmap(fromRole, toRole, { strategy: "easiest",     maxDepth: 8 }) : null;
  const paidPath   = strat !== "highest_paid"? buildRoadmap(fromRole, toRole, { strategy: "highest_paid",maxDepth: 8 }) : null;

  // ── 3. AI layer ───────────────────────────────────────────────────────────
  let ai = _emptyAI(fromData, toData);
  if (process.env.OPENAI_API_KEY) {
    try {
      ai = await _aiLayer({
        fromData, toData, skillList, yearsExp, resumeText,
        strat, graphData, fastPath, easyPath, paidPath,
      });
    } catch (err) {
      console.error("[career-roadmap] AI error:", err.message);
    }
  }

  return res.status(200).json({
    ok:   true,
    data: {
      // Graph engine data (steps, summary, bridge)
      from:         graphData.from,
      to:           graphData.to,
      reachable:    graphData.reachable,
      bridge_mode:  graphData.bridge_mode,
      bridge_role:  graphData.bridge_role  || null,
      steps:        graphData.steps        || [],
      summary:      graphData.summary      || null,
      alternatives: graphData.alternatives || [],
      adjacent_from:graphData.adjacent_from|| [],
      adjacent_to:  graphData.adjacent_to  || [],
      // AI premium layer
      ai,
    },
  });
}

// =============================================================================
// AI content layer — full phased roadmap
// =============================================================================

async function _aiLayer({ fromData, toData, skillList, yearsExp, resumeText, strat, graphData, fastPath, easyPath, paidPath }) {

  // Build path context strings
  const pathStepTitles  = (graphData.steps || []).map((s) => s.title).join(" → ") || "No direct graph path";
  const fastStepTitles  = fastPath?.reachable  ? fastPath.steps.map((s) => s.title).join(" → ")  : null;
  const easyStepTitles  = easyPath?.reachable  ? easyPath.steps.map((s) => s.title).join(" → ")  : null;
  const paidStepTitles  = paidPath?.reachable  ? paidPath.steps.map((s) => s.title).join(" → ")  : null;

  const fromCore  = fromData?.skills_grouped?.core        || [];
  const fromTech  = fromData?.skills_grouped?.technical   || [];
  const toCore    = toData?.skills_grouped?.core          || [];
  const toTech    = toData?.skills_grouped?.technical     || [];

  const ctx = [
    `FROM ROLE: ${fromData.title} (${fromData.category}, ${fromData.seniority})`,
    fromData.salary_uk?.mean ? `FROM SALARY: ~£${fromData.salary_uk.mean.toLocaleString()}` : null,
    `TO ROLE: ${toData.title} (${toData.category}, ${toData.seniority})`,
    toData.salary_uk?.mean   ? `TO SALARY: ~£${toData.salary_uk.mean.toLocaleString()}` : null,
    `STRATEGY REQUESTED: ${strat}`,
    yearsExp  ? `YEARS OF EXPERIENCE: ${yearsExp}` : null,
    skillList.length ? `CANDIDATE'S SKILLS: ${skillList.slice(0, 20).join(", ")}` : null,
    fromCore.length  ? `FROM ROLE CORE SKILLS: ${fromCore.slice(0, 8).join(", ")}` : null,
    toCore.length    ? `TARGET ROLE CORE SKILLS: ${toCore.slice(0, 8).join(", ")}` : null,
    toTech.length    ? `TARGET ROLE TECHNICAL SKILLS: ${toTech.slice(0, 6).join(", ")}` : null,
    `GRAPH PATH: ${pathStepTitles}`,
    fastStepTitles  ? `FASTEST GRAPH PATH: ${fastStepTitles}` : null,
    easyStepTitles  ? `EASIEST GRAPH PATH: ${easyStepTitles}` : null,
    paidStepTitles  ? `HIGHEST PAID GRAPH PATH: ${paidStepTitles}` : null,
    graphData.summary ? `TOTAL ESTIMATED YEARS: ~${graphData.summary.total_estimated_years}` : null,
    graphData.bridge_role ? `BRIDGE ROLE: ${graphData.bridge_role.title}` : null,
    resumeText ? `\nCANDIDATE BACKGROUND:\n${resumeText.slice(0, 1500)}` : null,
  ].filter(Boolean).join("\n");

  const system = `You are a senior UK career strategist inside the EDGEX career intelligence platform.
You write specific, actionable career roadmaps — not generic advice.
Rules:
- UK spelling (organise, specialise, programme, recognise)
- Never say "take a course" without naming the specific skill or resource type
- Every action must be concrete and completable — not "network more" but "message 5 PMs on LinkedIn this week using your commercial background as the hook"
- Phases must build on each other logically
- Alternative paths must be genuinely different routes, not variations of the same plan
- Return ONLY valid JSON. No markdown, no backticks, no prose outside JSON.`;

  const user = `${ctx}

Generate a complete, premium career roadmap. Return this exact JSON structure:

{
  "feasibility": {
    "label": "One of: very achievable | achievable | challenging | ambitious | unconventional",
    "headline": "One bold, specific sentence summarising why this transition is or isn't straightforward",
    "why": "2–3 sentences on what specifically makes this path realistic or hard — reference actual role differences, skill gaps, or market conditions"
  },

  "recommended_path": {
    "label": "Safe path",
    "headline": "One sentence describing this route and why it's recommended",
    "total_timeline": "e.g. 12–18 months",
    "difficulty": "achievable",
    "phases": [
      {
        "label": "0–3 months",
        "title": "Short evocative title e.g. 'Foundation & Signal-Building'",
        "goal": "One sentence: what you will have achieved by the end of this phase",
        "actions": [
          {
            "action": "Specific, concrete action — name the exact thing to do",
            "detail": "One sentence expanding on how to do this and why it matters for this transition"
          },
          {
            "action": "Second action",
            "detail": "Detail"
          },
          {
            "action": "Third action",
            "detail": "Detail"
          }
        ],
        "skills_focus": ["Skill 1", "Skill 2", "Skill 3", "Skill 4"]
      },
      {
        "label": "3–6 months",
        "title": "Short title",
        "goal": "What you achieve",
        "actions": [
          { "action": "string", "detail": "string" },
          { "action": "string", "detail": "string" },
          { "action": "string", "detail": "string" }
        ],
        "skills_focus": ["Skill 1", "Skill 2", "Skill 3"]
      },
      {
        "label": "6–12 months",
        "title": "Short title",
        "goal": "What you achieve",
        "actions": [
          { "action": "string", "detail": "string" },
          { "action": "string", "detail": "string" },
          { "action": "string", "detail": "string" }
        ],
        "skills_focus": ["Skill 1", "Skill 2", "Skill 3"]
      }
    ]
  },

  "alternative_paths": [
    {
      "label": "Fastest path",
      "headline": "One sentence describing this route",
      "route": ["${fromData.title}", "Intermediate role if needed", "${toData.title}"],
      "timeline": "e.g. 6–9 months",
      "trade_off": "What you sacrifice by going this fast. Be specific.",
      "best_for": "Who this approach suits. One sentence."
    },
    {
      "label": "Via [specific bridge role name]",
      "headline": "One sentence",
      "route": ["${fromData.title}", "Bridge role name", "${toData.title}"],
      "timeline": "e.g. 18–24 months",
      "trade_off": "What the detour costs you",
      "best_for": "Who benefits most from this route"
    },
    {
      "label": "Lateral pivot",
      "headline": "One sentence describing a third distinct approach",
      "route": ["${fromData.title}", "Adjacent role or approach", "${toData.title}"],
      "timeline": "e.g. 12–18 months",
      "trade_off": "The trade-off",
      "best_for": "Who this suits"
    }
  ],

  "strengths_to_leverage": [
    {
      "strength": "Specific transferable strength from ${fromData.title} background",
      "how_to_use": "Concrete, specific advice on how to deploy this strength in the ${toData.title} job search or role itself. 1–2 sentences."
    },
    {
      "strength": "Second strength",
      "how_to_use": "How to use it"
    },
    {
      "strength": "Third strength",
      "how_to_use": "How to use it"
    }
  ],

  "gaps_to_close": [
    {
      "gap": "Specific skill or experience gap — name it precisely",
      "why_it_matters": "Why hiring managers for ${toData.title} will care about this gap. 1 sentence.",
      "how_to_close": "Specific, realistic way to close this gap — name the method, not just the category. 1–2 sentences."
    },
    {
      "gap": "Second gap",
      "why_it_matters": "string",
      "how_to_close": "string"
    },
    {
      "gap": "Third gap",
      "why_it_matters": "string",
      "how_to_close": "string"
    },
    {
      "gap": "Fourth gap",
      "why_it_matters": "string",
      "how_to_close": "string"
    }
  ],

  "this_week": [
    {
      "action": "Specific thing to do TODAY or this week — very concrete",
      "detail": "Exactly how to do it. Name the platform, the person type, the specific output. 1–2 sentences."
    },
    {
      "action": "Second immediate action",
      "detail": "Detail"
    },
    {
      "action": "Third immediate action",
      "detail": "Detail"
    }
  ],

  "salary_trajectory": {
    "current": "e.g. £45,000–£60,000",
    "target": "e.g. £55,000–£80,000",
    "note": "One sentence on timing and what influences salary at the target role in the UK market"
  }
}

IMPORTANT:
- Use the graph path data to inform route specifics — do not invent a completely different path if the graph already has one
- If the candidate has skills listed, tailor the gaps and strengths to those specific skills
- this_week actions must be completable within 7 days — not quarter-long goals
- Alternative paths must genuinely differ in approach, not just be slower/faster versions of the same steps`;

  const raw = await _callAI(system, user);
  return _parseJson(raw);
}

// =============================================================================
// Bridge path logic (unchanged from v2)
// =============================================================================

function _buildBridgePath(fromSlug, toSlug, fromData, toData, strat) {
  const fromNextMoves  = _safe(() => getNextMoves(fromSlug,  { limit: 20 })) || [];
  const toPrevMoves    = _safe(() => getPreviousMoves(toSlug, { limit: 20 })) || [];

  const fromSlugs  = new Set(fromNextMoves.map((r) => r.slug));
  const toPrevSlugs= new Set(toPrevMoves.map((r)  => r.slug));
  const bridges    = [...fromSlugs].filter((s) => toPrevSlugs.has(s));

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

  // No bridge — structured fallback
  return {
    reachable:    false,
    bridge_mode:  true,
    from:         _roleSummary(fromData),
    to:           _roleSummary(toData),
    adjacent_from:fromNextMoves.slice(0, 6).map((r) => ({ slug: r.slug, title: r.title, difficulty_label: r.difficulty_label || null })),
    adjacent_to:  toPrevMoves.slice(0, 6).map((r)  => ({ slug: r.slug, title: r.title })),
    alternatives: _buildAlternativeTargets(fromSlug, toData, strat),
  };
}

function _buildAlternativeTargets(fromSlug, toData, strat) {
  try {
    const allRoles    = Object.values(getRoleMap() || {});
    const sameCategory= allRoles.filter((r) => r.category === toData.category && r.slug !== toData.slug && r.slug !== fromSlug).slice(0, 10);
    const reachable   = [];
    for (const r of sameCategory) {
      const rm = buildRoadmap(fromSlug, r.slug, { strategy: strat, maxDepth: 6 });
      if (rm?.reachable) {
        reachable.push({ slug: r.slug, title: r.title, seniority: r.seniority, total_steps: rm.summary.total_steps, total_years: rm.summary.total_estimated_years, salary_growth_pct: rm.summary.salary_growth_pct });
        if (reachable.length >= 3) break;
      }
    }
    return reachable;
  } catch { return []; }
}

// =============================================================================
// Helpers
// =============================================================================

function _roleSummary(d) {
  return { slug: d.slug, title: d.title, category: d.category, seniority: d.seniority, salary_mean: d.salary_uk?.mean || null };
}

function _emptyAI(fromData, toData) {
  return {
    feasibility:           { label: "achievable", headline: "", why: "" },
    recommended_path:      null,
    alternative_paths:     [],
    strengths_to_leverage: [],
    gaps_to_close:         [],
    this_week:             [],
    salary_trajectory:     null,
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

// Legacy GET
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
