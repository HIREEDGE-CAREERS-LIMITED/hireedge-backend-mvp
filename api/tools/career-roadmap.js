// ============================================================================
// api/tools/career-roadmap.js
// HireEdge Backend — Career Roadmap (Production v2)
//
// POST body:
//   fromRole    string  required  slug
//   toRole      string  required  slug
//   strategy    string  optional  fastest|easiest|highest_paid (default: fastest)
//   skills      string|array  optional
//
// When direct path exists → full enriched roadmap
// When no direct path → bridge path via nearest connected intermediaries
// AI layer adds: feasibility narrative, top blockers, first 3 actions, alternatives
//
// Legacy GET preserved for action router compat.
// ============================================================================

import OpenAI from "openai";
import { buildRoadmap, buildMultiRoadmap } from "../../lib/tools/roadmapEngine.js";
import { getRoleBySlug, getRoleMap } from "../../lib/dataset/roleIndex.js";
import { getSalaryIntelligence } from "../../lib/intelligence/salaryEngine.js";
import { getNextMoves, getPreviousMoves } from "../../lib/graph/careerPathEngine.js";
import { enforceBilling } from "../../lib/billing/billingMiddleware.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    fromRole  = "",
    toRole    = "",
    strategy  = "fastest",
    skills    = "",
  } = body;

  if (!fromRole || !toRole) {
    return res.status(400).json({ ok: false, error: "fromRole and toRole are required" });
  }

  const fromData = getRoleBySlug(fromRole);
  const toData   = getRoleBySlug(toRole);

  if (!fromData) return res.status(404).json({ ok: false, error: `Role not found: ${fromRole}` });
  if (!toData)   return res.status(404).json({ ok: false, error: `Role not found: ${toRole}` });

  const skillList = Array.isArray(skills)
    ? skills.filter(Boolean)
    : (skills || "").split(",").map((s) => s.trim()).filter(Boolean);

  const validStrategies = ["fastest", "easiest", "highest_paid"];
  const strat = validStrategies.includes(strategy) ? strategy : "fastest";

  // ── 1. Try direct path ────────────────────────────────────────────────────
  const roadmap = buildRoadmap(fromRole, toRole, { strategy: strat, maxDepth: 8 });

  let responseData;

  if (roadmap?.reachable) {
    responseData = { ...roadmap, bridge_mode: false };
  } else {
    // ── 2. Bridge path: find nearest intermediaries ───────────────────────
    responseData = _buildBridgePath(fromRole, toRole, fromData, toData, strat);
  }

  // ── 3. AI layer ───────────────────────────────────────────────────────────
  let aiLayer = {};
  if (process.env.OPENAI_API_KEY) {
    try {
      aiLayer = await _aiLayer({
        fromData, toData, skillList, strat, responseData,
      });
    } catch (err) {
      console.error("[career-roadmap] AI error:", err.message);
    }
  }

  return res.status(200).json({ ok: true, data: { ...responseData, ai: aiLayer } });
}

// ===========================================================================
// Bridge path logic
// ===========================================================================

function _buildBridgePath(fromSlug, toSlug, fromData, toData, strat) {
  // Get roles reachable FROM the source
  const fromNextMoves = _safe(() => getNextMoves(fromSlug, { limit: 20 })) || [];

  // Get roles that CAN reach the target (reverse: previous moves of target)
  const toPrevMoves = _safe(() => getPreviousMoves(toSlug, { limit: 20 })) || [];

  // Find intersection — roles that appear in both sets
  const fromSlugs   = new Set(fromNextMoves.map((r) => r.slug));
  const toPrevSlugs = new Set(toPrevMoves.map((r) => r.slug));
  const bridges     = [...fromSlugs].filter((s) => toPrevSlugs.has(s));

  let bridgeSteps = [];
  let bridgePath  = null;

  if (bridges.length > 0) {
    // Use first bridge (closest to source by salary)
    const bridgeSlug = bridges[0];
    const leg1 = buildRoadmap(fromSlug, bridgeSlug, { strategy: strat, maxDepth: 6 });
    const leg2 = buildRoadmap(bridgeSlug, toSlug,   { strategy: strat, maxDepth: 6 });

    if (leg1?.reachable && leg2?.reachable) {
      // Merge the two legs, de-dup the bridge node
      const allSteps = [
        ...leg1.steps,
        ...leg2.steps.filter((s) => s.slug !== bridgeSlug).map((s) => ({
          ...s,
          step: leg1.steps.length + s.step - 1,
        })),
      ];

      bridgePath = {
        reachable:   true,
        bridge_mode: true,
        bridge_role: { slug: bridgeSlug, title: getRoleBySlug(bridgeSlug)?.title || bridgeSlug },
        from:        { slug: fromData.slug, title: fromData.title, category: fromData.category, seniority: fromData.seniority, salary_mean: fromData.salary_uk?.mean || null },
        to:          { slug: toData.slug,   title: toData.title,   category: toData.category,   seniority: toData.seniority,   salary_mean: toData.salary_uk?.mean   || null },
        steps:       allSteps,
        summary: {
          total_steps:            allSteps.length,
          total_estimated_years:  (leg1.summary.total_estimated_years || 0) + (leg2.summary.total_estimated_years || 0),
          salary_growth_pct:      _safe(() => Math.round(((toData.salary_uk?.mean - fromData.salary_uk?.mean) / fromData.salary_uk?.mean) * 100)) || null,
          via_bridge:             true,
        },
        alternatives: _buildAlternativeTargets(fromSlug, toData, strat),
      };
    }
  }

  if (!bridgePath) {
    // No bridge found — return structured fallback with adjacent alternatives
    bridgePath = {
      reachable:   false,
      bridge_mode: true,
      from:        { slug: fromData.slug, title: fromData.title, category: fromData.category, seniority: fromData.seniority, salary_mean: fromData.salary_uk?.mean || null },
      to:          { slug: toData.slug,   title: toData.title,   category: toData.category,   seniority: toData.seniority,   salary_mean: toData.salary_uk?.mean   || null },
      adjacent_from: fromNextMoves.slice(0, 6).map((r) => ({ slug: r.slug, title: r.title, difficulty_label: r.difficulty_label || null })),
      adjacent_to:   toPrevMoves.slice(0, 6).map((r) => ({ slug: r.slug, title: r.title })),
      alternatives:  _buildAlternativeTargets(fromSlug, toData, strat),
    };
  }

  return bridgePath;
}

function _buildAlternativeTargets(fromSlug, toData, strat) {
  // Find roles in same category as target that ARE reachable from source
  try {
    const allRoles = Object.values(getRoleMap() || {});
    const sameCategory = allRoles
      .filter((r) => r.category === toData.category && r.slug !== toData.slug && r.slug !== fromSlug)
      .slice(0, 10);

    const reachable = [];
    for (const r of sameCategory) {
      const rm = buildRoadmap(fromSlug, r.slug, { strategy: strat, maxDepth: 6 });
      if (rm?.reachable) {
        reachable.push({
          slug:               r.slug,
          title:              r.title,
          seniority:          r.seniority,
          total_steps:        rm.summary.total_steps,
          total_years:        rm.summary.total_estimated_years,
          salary_growth_pct:  rm.summary.salary_growth_pct,
        });
        if (reachable.length >= 3) break;
      }
    }
    return reachable;
  } catch {
    return [];
  }
}

// ===========================================================================
// AI layer
// ===========================================================================

async function _aiLayer({ fromData, toData, skillList, strat, responseData }) {
  const ctx = [
    `FROM: ${fromData.title} (${fromData.category}, ${fromData.seniority})`,
    `TO: ${toData.title} (${toData.category}, ${toData.seniority})`,
    `STRATEGY: ${strat}`,
    skillList.length ? `CANDIDATE SKILLS: ${skillList.slice(0, 15).join(", ")}` : null,
    `PATH FOUND: ${responseData.reachable ? "Yes" : "No — bridge/alternative mode"}`,
    responseData.reachable ? `PATH STEPS: ${responseData.summary?.total_steps}` : null,
    responseData.reachable ? `EST. YEARS: ${responseData.summary?.total_estimated_years}` : null,
    responseData.bridge_role ? `BRIDGE ROLE: ${responseData.bridge_role.title}` : null,
  ].filter(Boolean).join("\n");

  const system = `You are a senior UK career strategist inside the EDGEX career intelligence platform.
Provide concise, specific career roadmap guidance. UK spelling throughout.
Return ONLY valid JSON — no markdown fences.`;

  const user = `${ctx}

Generate career roadmap intelligence. Return this exact JSON:

{
  "feasibility": {
    "label": "One of: very achievable | achievable | challenging | ambitious | unconventional",
    "headline": "One bold sentence summarising the transition. Specific to these roles.",
    "why": "2–3 sentences: what makes this path realistic or hard. Reference specific skills, seniority, category."
  },
  "top_blockers": [
    "Specific blocker 1 — name the exact gap or challenge",
    "Specific blocker 2",
    "Specific blocker 3"
  ],
  "first_3_actions": [
    {
      "action": "Specific action to take this week/month",
      "why": "Why this action matters for this transition. 1 sentence.",
      "timeframe": "This week | This month | Next 3 months"
    },
    {
      "action": "string",
      "why": "string",
      "timeframe": "string"
    },
    {
      "action": "string",
      "why": "string",
      "timeframe": "string"
    }
  ],
  "transferable_strengths": [
    "Strength 1 — specific to ${fromData.title} that directly helps in ${toData.title}",
    "Strength 2",
    "Strength 3"
  ],
  "salary_direction": "1–2 sentences on expected salary trajectory for this move. Include UK market context.",
  "realistic_timeline": "Honest, specific estimate of total time to achieve this transition. 1–2 sentences."
}`;

  const raw = await _callAI(system, user);
  return _parseJson(raw);
}

// ===========================================================================
// Helpers
// ===========================================================================

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
      const strat = ["fastest","easiest","highest_paid"].includes(strategy) ? strategy : "fastest";
      const data = buildRoadmap(from, to, { strategy: strat, maxDepth: maxDepth ? parseInt(maxDepth) : 6 });
      if (!data) return res.status(404).json({ error: "Role not found" });
      return res.status(200).json({ ok: true, data });
    }
    if (action === "multi") {
      if (!from || !targets) return res.status(400).json({ error: "Missing: from, targets" });
      const tList = targets.split(",").map((s) => s.trim()).filter(Boolean);
      const strat = ["fastest","easiest","highest_paid"].includes(strategy) ? strategy : "fastest";
      const data = buildMultiRoadmap(from, tList, { strategy: strat });
      return res.status(200).json({ ok: true, data });
    }
    return res.status(400).json({ error: "Invalid action", valid_actions: ["build","multi"] });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
