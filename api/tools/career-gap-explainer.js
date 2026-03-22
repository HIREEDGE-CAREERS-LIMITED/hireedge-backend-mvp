// ============================================================================
// api/tools/career-gap-explainer.js
// HireEdge Backend -- Career Gap Diagnostic (v4)
//
// GET ?action=explain&from=SLUG&to=SLUG
//
// Returns full 10-section diagnostic matching the v4 frontend data shape:
//   hero, verdict, gap_origins, gap_scoreboard, missing_skills,
//   experience_gaps, market_perception, fits_now, fix_plan, risk_if_ignored
// ============================================================================

import OpenAI from "openai";
import { getRoleBySlug } from "../../lib/dataset/roleIndex.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET")    return res.status(405).json({ error: "Method not allowed" });

  const { action, from, to } = req.query;
  if (action !== "explain") return res.status(400).json({ ok: false, error: "action=explain required" });
  if (!from || !to)         return res.status(400).json({ ok: false, error: "from and to required" });

  const fromData = getRoleBySlug(from);
  const toData   = getRoleBySlug(to);
  if (!fromData) return res.status(404).json({ ok: false, error: "Role not found: " + from });
  if (!toData)   return res.status(404).json({ ok: false, error: "Role not found: " + to });

  const fromTitle = fromData.title;
  const toTitle   = toData.title;

  let data = emptyData(fromTitle, toTitle);
  if (process.env.OPENAI_API_KEY) {
    try { data = await generate({ fromData, toData, fromTitle, toTitle }); }
    catch (e) { console.error("[gap-explainer]", e.message); }
  }

  return res.status(200).json({ ok: true, data });
}

// ============================================================================
// AI generation
// ============================================================================

async function generate({ fromData, toData, fromTitle, toTitle }) {
  const fromCore = fromData?.skills_grouped?.core      || [];
  const fromTech = fromData?.skills_grouped?.technical || [];
  const toCore   = toData?.skills_grouped?.core        || [];
  const toTech   = toData?.skills_grouped?.technical   || [];
  const salFrom  = fromData?.salary_uk?.mean ? "~GBP" + fromData.salary_uk.mean.toLocaleString() : null;
  const salTo    = toData?.salary_uk?.mean   ? "~GBP" + toData.salary_uk.mean.toLocaleString()   : null;

  const ctx = [
    "FROM: " + fromTitle + " (" + fromData.category + ", " + fromData.seniority + ")" + (salFrom ? " " + salFrom : ""),
    "TO: "   + toTitle   + " (" + toData.category   + ", " + toData.seniority   + ")" + (salTo   ? " " + salTo   : ""),
    fromCore.length ? fromTitle + " SKILLS: " + fromCore.slice(0, 8).join(", ") : null,
    fromTech.length ? fromTitle + " TECH: "   + fromTech.slice(0, 5).join(", ") : null,
    toCore.length   ? toTitle   + " REQUIRED: "  + toCore.slice(0, 8).join(", ") : null,
    toTech.length   ? toTitle   + " TECH REQUIRED: " + toTech.slice(0, 5).join(", ") : null,
  ].filter(Boolean).join("\n");

  const system = `You are a senior talent strategist producing a Career Gap Diagnostic.
Rules:
- Every statement must reference the specific roles, not generic career concepts
- Be honest about difficulty -- do not soften the reality
- UK market context throughout. UK spelling
- Short sentences. No filler.
- Return ONLY valid JSON. No markdown, no backticks.`;

  const user = ctx + `

Produce a full Career Gap Diagnostic from ` + fromTitle + ` to ` + toTitle + `.

Return this EXACT JSON:

{
  "hero": {
    "title": "One sharp sentence: why moving from ` + fromTitle + ` to ` + toTitle + ` is [hard/achievable/straightforward]",
    "gap_severity": "High | Medium | Low",
    "skill_match_pct": 0,
    "transition_difficulty": "Hard | Medium | Easy"
  },

  "verdict": {
    "headline": "One bold diagnostic sentence summarising the entire situation -- the most important thing to know",
    "is_realistic": true,
    "biggest_blocker": "The single most important gap preventing this transition right now -- specific, not generic",
    "biggest_advantage": "The strongest transferable asset from ` + fromTitle + ` that helps in ` + toTitle + `",
    "summary": "2-3 sentences: is this realistic, why, what is the structural challenge"
  },

  "gap_origins": {
    "skill_gap": {
      "severity": "High | Medium | Low",
      "explanation": "2 sentences: what the skill gap actually is -- name the specific skills",
      "why_it_matters": "1 sentence: what this gap costs in interviews or on the job"
    },
    "experience_gap": {
      "severity": "High | Medium | Low",
      "explanation": "2 sentences: what real-world experience is missing",
      "why_it_matters": "1 sentence: why hiring managers care about this"
    },
    "market_gap": {
      "severity": "High | Medium | Low",
      "explanation": "2 sentences: how the market currently categorises this profile",
      "why_it_matters": "1 sentence: the commercial consequence of this positioning gap"
    }
  },

  "gap_scoreboard": {
    "skills_readiness": 0,
    "experience_readiness": 0,
    "market_readiness": 0,
    "transition_risk": 0,
    "overall_note": "1 sentence on what the scoreboard tells us overall"
  },

  "missing_skills": [
    {
      "skill": "Specific named skill -- not a category",
      "severity": "High | Medium | Low",
      "why_it_matters": "1 sentence: what this gap costs in ` + toTitle + ` roles",
      "how_to_close": "1 sentence: the most direct way to build this",
      "time_estimate": "e.g. 4-6 weeks"
    }
  ],

  "experience_gaps": [
    {
      "gap": "Named missing experience -- e.g. 'No product roadmap ownership'",
      "severity": "High | Medium | Low",
      "explanation": "1-2 sentences: why ` + fromTitle + ` background does not provide this"
    }
  ],

  "market_perception": {
    "recruiter_view": "2 sentences: what a recruiter thinks when they see this profile applying for ` + toTitle + `",
    "hiring_manager_view": "2 sentences: what a hiring manager thinks during the interview",
    "positioning_gap": "1-2 sentences: the core narrative mismatch between current profile and target role expectations"
  },

  "fits_now": {
    "current_fit": "The specific roles this profile is competitive for TODAY -- be honest and name actual roles",
    "stretch_fit": "Roles that are possible with 3-6 months of targeted preparation",
    "not_yet": "Why ` + toTitle + ` is not yet realistic -- specific reasons",
    "bridge_roles": ["Role 1", "Role 2", "Role 3"]
  },

  "fix_plan": [
    {
      "action": "Specific, named, completable action -- not a strategy statement",
      "why_first": "1 sentence: why this is the highest-leverage first move",
      "expected_outcome": "1 sentence: what changes once this is done",
      "time_estimate": "e.g. 2-4 weeks"
    },
    {
      "action": "string",
      "why_first": "string",
      "expected_outcome": "string",
      "time_estimate": "string"
    },
    {
      "action": "string",
      "why_first": "string",
      "expected_outcome": "string",
      "time_estimate": "string"
    }
  ],

  "risk_if_ignored": [
    "Specific consequence 1 -- what happens to this profile if nothing changes in 12 months",
    "Specific consequence 2",
    "Specific consequence 3",
    "Specific consequence 4"
  ]
}

CALIBRATION:
- skill_match_pct: honest 0-100 based on actual skill overlap between the two roles
- gap_scoreboard values: spread across a real range -- do not cluster at 50
- transition_risk: higher = more risky (opposite direction to readiness scores)
- missing_skills: minimum 5 items, maximum 8
- experience_gaps: minimum 4 items
- All text must reference the specific roles -- zero generic career advice`;

  const raw = await callAI(system, user);
  return parseJson(raw);
}

// ============================================================================
// Fallback empty data
// ============================================================================

function emptyData(fromTitle, toTitle) {
  return {
    hero: {
      title: "Career gap analysis: " + fromTitle + " to " + toTitle,
      gap_severity: "Medium",
      skill_match_pct: 0,
      transition_difficulty: "Medium",
    },
    verdict:           null,
    gap_origins:       null,
    gap_scoreboard:    { skills_readiness: 0, experience_readiness: 0, market_readiness: 0, transition_risk: 0 },
    missing_skills:    [],
    experience_gaps:   [],
    market_perception: null,
    fits_now:          null,
    fix_plan:          [],
    risk_if_ignored:   [],
  };
}

// ============================================================================
// Helpers
// ============================================================================

async function callAI(system, user) {
  const r = await openai.responses.create({
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: system },
      { role: "user",   content: user   },
    ],
  });
  return r.output?.[0]?.content?.[0]?.text?.trim() ?? "{}";
}

function parseJson(raw) {
  let t = (raw || "").trim().replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch {
    const m = t.match(/\{[\s\S]*\}/);
    try { return JSON.parse(m?.[0] || "{}"); } catch { return {}; }
  }
}
