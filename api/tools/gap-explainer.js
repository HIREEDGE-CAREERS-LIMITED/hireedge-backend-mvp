// ============================================================================
// api/tools/career-gap-explainer.js
// HireEdge Backend -- Career Gap Explainer (v2)
//
// Upgraded to produce a full 10-section diagnostic:
//   hero  transition_verdict  gap_breakdown  skill_gap_deep_dive
//   experience_gap  market_gap  gap_severity_map  reality_check
//   fix_priority_plan  if_ignored
//
// Supports:
//   GET ?action=explain&from=SLUG&to=SLUG
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
  if (action !== "explain")  return res.status(400).json({ ok: false, error: "action=explain required" });
  if (!from || !to)          return res.status(400).json({ ok: false, error: "from and to slugs required" });

  const fromData = getRoleBySlug(from);
  const toData   = getRoleBySlug(to);

  if (!fromData) return res.status(404).json({ ok: false, error: `Role not found: ${from}` });
  if (!toData)   return res.status(404).json({ ok: false, error: `Role not found: ${to}` });

  const fromTitle = fromData.title;
  const toTitle   = toData.title;

  let data = _emptyData(fromTitle, toTitle);

  if (process.env.OPENAI_API_KEY) {
    try {
      data = await _generateDiagnostic({ fromData, toData, fromTitle, toTitle });
    } catch (err) {
      console.error("[gap-explainer] AI error:", err.message);
    }
  }

  return res.status(200).json({ ok: true, data });
}

// =============================================================================
// AI generation
// =============================================================================

async function _generateDiagnostic({ fromData, toData, fromTitle, toTitle }) {
  const fromCore = fromData?.skills_grouped?.core      || [];
  const fromTech = fromData?.skills_grouped?.technical || [];
  const toCore   = toData?.skills_grouped?.core        || [];
  const toTech   = toData?.skills_grouped?.technical   || [];

  const salaryFrom = fromData?.salary_uk?.mean ? `~${fromData.salary_uk.mean.toLocaleString()}` : null;
  const salaryTo   = toData?.salary_uk?.mean   ? `~${toData.salary_uk.mean.toLocaleString()}`   : null;

  const ctx = [
    `FROM ROLE: ${fromTitle} (${fromData.category}, ${fromData.seniority})`,
    salaryFrom ? `FROM SALARY BAND: ${salaryFrom}` : null,
    `TO ROLE: ${toTitle} (${toData.category}, ${toData.seniority})`,
    salaryTo ? `TO SALARY BAND: ${salaryTo}` : null,
    fromCore.length ? `${fromTitle} CORE SKILLS: ${fromCore.slice(0, 8).join(", ")}` : null,
    fromTech.length ? `${fromTitle} TECHNICAL SKILLS: ${fromTech.slice(0, 6).join(", ")}` : null,
    toCore.length   ? `${toTitle} REQUIRED CORE SKILLS: ${toCore.slice(0, 8).join(", ")}` : null,
    toTech.length   ? `${toTitle} REQUIRED TECHNICAL SKILLS: ${toTech.slice(0, 6).join(", ")}` : null,
  ].filter(Boolean).join("\n");

  const system = `You are a senior career strategist and talent market expert producing a precise gap diagnostic report.

This is a diagnostic tool -- it must explain WHY a career transition is hard or easy with surgical precision.

STANDARDS:
- Every output must reference the specific roles, not generic career advice
- Be honest about difficulty -- don't soften the reality
- Lead with the most important information
- UK market context throughout
- Short, direct, professional prose -- no filler
- UK spelling

Return ONLY valid JSON. No markdown, no backticks, no prose outside the JSON.`;

  const user = `${ctx}

Generate a full 10-section Career Gap Diagnostic from ${fromTitle} to ${toTitle}.

Return this EXACT JSON structure:

{
  "hero": {
    "title": "One sharp sentence explaining why this transition is hard/easy -- e.g. 'Why moving from ${fromTitle} to ${toTitle} is a significant structural career change'",
    "gap_severity": "High | Medium | Low",
    "skill_match_pct": 0,
    "transition_difficulty": "Hard | Medium | Easy"
  },

  "transition_verdict": "One strong paragraph (3-5 sentences) -- is this transition realistic, why, and what the main blockers are. No fluff. Specific to these two roles.",

  "gap_breakdown": {
    "skill_gaps": [
      {
        "title": "Named specific skill gap -- e.g. 'Product Roadmapping & Prioritisation'",
        "severity": "High | Medium | Low",
        "explanation": "1 sentence: why this gap exists given the from role",
        "why_it_matters": "1 sentence: why this gap matters for the to role specifically"
      }
    ],
    "experience_gaps": [
      {
        "title": "Named real-world experience gap",
        "severity": "High | Medium | Low",
        "explanation": "1 sentence on the gap",
        "why_it_matters": "1 sentence on why it matters"
      }
    ],
    "market_gaps": [
      {
        "title": "Named market positioning gap",
        "severity": "High | Medium | Low",
        "explanation": "1 sentence",
        "why_it_matters": "1 sentence"
      }
    ]
  },

  "skill_gap_deep_dive": [
    {
      "skill": "Specific skill name -- e.g. 'Product Roadmapping'",
      "current": "Level in ${fromTitle} -- e.g. 'Low exposure' or 'Indirect exposure only'",
      "required": "Level needed in ${toTitle} -- e.g. 'Core daily skill' or 'Advanced proficiency'",
      "impact": "1 sentence: what this limits if not addressed"
    }
  ],

  "experience_gap": [
    {
      "gap": "Named missing real-world experience -- e.g. 'No product lifecycle ownership'",
      "severity": "High | Medium | Low",
      "explanation": "1 sentence: specifically what is missing and why the from role doesn't provide it"
    }
  ],

  "market_gap": {
    "recruiter_view": "2 sentences: what a recruiter sees when they open this candidate's CV -- their first impression and concern",
    "hiring_manager_view": "2 sentences: what a hiring manager thinks when they interview this profile for the target role",
    "positioning_gap": "1-2 sentences: the core narrative gap between how this candidate presents vs. what the target role demands"
  },

  "gap_severity_map": {
    "skills_pct": 0,
    "experience_pct": 0,
    "market_pct": 0,
    "overall_note": "1 sentence: where the biggest concentration of gap sits and what this means"
  },

  "reality_check": {
    "why_delayed": "2 sentences: the structural reasons this transition takes time -- not willpower, but hard realities",
    "where_youll_struggle": "2 sentences: the specific interview/onboarding moments where this gap becomes painful",
    "fits_now": "The specific role or level that is a realistic fit today -- be honest. e.g. 'Associate Product Manager or Product Analyst roles at smaller companies'"
  },

  "fix_priority_plan": [
    {
      "action": "Specific, named, completable action -- not a vague goal",
      "why_it_matters": "1 sentence: why this is the #1 highest-leverage fix",
      "time_estimate": "e.g. '2-4 weeks' or '1 month'"
    },
    {
      "action": "string",
      "why_it_matters": "string",
      "time_estimate": "string"
    },
    {
      "action": "string",
      "why_it_matters": "string",
      "time_estimate": "string"
    }
  ],

  "if_ignored": [
    "What happens if nothing changes -- 1 sentence, specific and honest. E.g. 'Transition to ${toTitle} becomes increasingly unlikely as junior candidates with direct experience accumulate in the market'",
    "Second consequence",
    "Third consequence",
    "Fourth consequence"
  ]
}

CALIBRATION RULES:
- skill_match_pct: honest percentage of overlap between the two skill sets (0-100)
- gap_severity_map percentages must add to 100
- gap_severity_map scores should reflect true weighting -- not 33/33/33
- fix_priority_plan actions must be concrete and completable -- not goals or strategies
- if_ignored items must be direct consequences, not generic warnings
- Minimum: 3 skill_gaps, 3 experience_gap items, 3 fix_priority_plan items, 4 if_ignored items
- skill_gap_deep_dive: minimum 4 items`;

  const raw = await _callAI(system, user);
  return _parseJson(raw);
}

// =============================================================================
// Helpers
// =============================================================================

function _emptyData(fromTitle, toTitle) {
  return {
    hero: {
      title: `Career gap analysis: ${fromTitle}  ${toTitle}`,
      gap_severity: "Medium",
      skill_match_pct: 0,
      transition_difficulty: "Medium",
    },
    transition_verdict:    null,
    gap_breakdown:         { skill_gaps: [], experience_gaps: [], market_gaps: [] },
    skill_gap_deep_dive:   [],
    experience_gap:        [],
    market_gap:            null,
    gap_severity_map:      { skills_pct: 50, experience_pct: 40, market_pct: 10, overall_note: null },
    reality_check:         null,
    fix_priority_plan:     [],
    if_ignored:            [],
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
