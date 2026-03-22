// ============================================================================
// api/tools/career-gap-explainer.js
// HireEdge Backend -- Career Gap Diagnostic (v5)
//
// GET ?action=explain&from=SLUG&to=SLUG
//
// Returns:
//   meta             -- is_role_based flag, titles
//   hero             -- gap_severity, skill_match_pct, transition_difficulty
//   verdict          -- headline, is_realistic, biggest_blocker, biggest_advantage, summary
//   gap_origins      -- skill_gap, experience_gap, market_gap (each with severity + explanation)
//   gap_scoreboard   -- skills_readiness, experience_readiness, market_readiness, transition_risk
//   missing_skills   -- ranked list with severity, why_it_matters, how_to_close, time_estimate
//   experience_gaps  -- named missing real-world exposure
//   market_perception -- recruiter_view, hiring_manager_view, positioning_gap
//   fits_now         -- current_fit, stretch_fit, not_yet, bridge_roles[]
//   fix_plan         -- 3 actions with why_first, expected_outcome, time_estimate
//   risk_if_ignored  -- 4 specific consequences
//   premium_preview  -- cv_rejection_risks, interview_weak_points, transition_timeline,
//                       salary_upside, next_tool (shown as locked teasers for free users)
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
    try {
      data = await generate({ fromData, toData, fromTitle, toTitle });
    } catch (e) {
      console.error("[gap-explainer]", e.message);
    }
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
    "FROM ROLE: " + fromTitle + " (" + fromData.category + ", " + fromData.seniority + ")" + (salFrom ? " " + salFrom : ""),
    "TO ROLE: "   + toTitle   + " (" + toData.category   + ", " + toData.seniority   + ")" + (salTo   ? " " + salTo   : ""),
    fromCore.length ? "FROM SKILLS: " + fromCore.slice(0, 8).join(", ") : null,
    fromTech.length ? "FROM TECH: "   + fromTech.slice(0, 5).join(", ") : null,
    toCore.length   ? "TO REQUIRED: "      + toCore.slice(0, 8).join(", ") : null,
    toTech.length   ? "TO TECH REQUIRED: " + toTech.slice(0, 5).join(", ") : null,
  ].filter(Boolean).join("\n");

  const system = `You are a senior UK talent strategist producing a Career Gap Diagnostic report.

Rules:
- Every statement must reference these specific roles -- zero generic career advice
- Be honest about difficulty -- do not soften the reality
- UK market context and UK spelling throughout
- Short, direct sentences. No filler.
- Return ONLY valid JSON. No markdown, no backticks, no commentary outside JSON.`;

  const user = ctx + `

Produce a full Career Gap Diagnostic from ${fromTitle} to ${toTitle}.

Return this EXACT JSON (no extra keys, no missing keys):

{
  "meta": {
    "is_role_based": true,
    "from_title": "${fromTitle}",
    "to_title": "${toTitle}"
  },

  "hero": {
    "title": "One sharp sentence: the core challenge in moving from ${fromTitle} to ${toTitle}",
    "gap_severity": "High | Medium | Low",
    "skill_match_pct": 0,
    "transition_difficulty": "Hard | Medium | Easy"
  },

  "verdict": {
    "headline": "One bold sentence -- the single most important thing to know about this transition",
    "is_realistic": true,
    "biggest_blocker": "The most important structural gap -- name specific skills or experience, not categories",
    "biggest_advantage": "The strongest transferable asset from ${fromTitle} that directly helps in ${toTitle}",
    "summary": "2-3 sentences: is this realistic, why, what is the key structural challenge"
  },

  "gap_origins": {
    "skill_gap": {
      "severity": "High | Medium | Low",
      "explanation": "2 sentences naming the specific skills missing",
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
      "why_it_matters": "1 sentence: what this gap costs in ${toTitle} roles",
      "how_to_close": "1 sentence: the most direct way to build this",
      "time_estimate": "e.g. 4-6 weeks"
    }
  ],

  "experience_gaps": [
    {
      "gap": "Named missing experience -- e.g. 'No product roadmap ownership'",
      "severity": "High | Medium | Low",
      "explanation": "1-2 sentences: why ${fromTitle} background does not provide this"
    }
  ],

  "market_perception": {
    "recruiter_view": "2 sentences: what a recruiter thinks when they see this profile applying for ${toTitle}",
    "hiring_manager_view": "2 sentences: what a hiring manager thinks during the interview",
    "positioning_gap": "1-2 sentences: the core narrative mismatch between current profile and target expectations"
  },

  "fits_now": {
    "current_fit": "Specific roles this profile is competitive for TODAY -- be honest, name actual roles",
    "stretch_fit": "Roles possible with 3-6 months targeted preparation",
    "not_yet": "Why ${toTitle} is not yet realistic -- name specific reasons",
    "bridge_roles": ["Role 1", "Role 2", "Role 3"]
  },

  "fix_plan": [
    {
      "action": "Specific, named, completable action",
      "why_first": "1 sentence: why this is the highest-leverage first move",
      "expected_outcome": "1 sentence: what changes once this is done",
      "time_estimate": "e.g. 2-4 weeks"
    },
    { "action": "string", "why_first": "string", "expected_outcome": "string", "time_estimate": "string" },
    { "action": "string", "why_first": "string", "expected_outcome": "string", "time_estimate": "string" }
  ],

  "risk_if_ignored": [
    "Specific consequence 1 -- what happens if nothing changes in 12 months",
    "Specific consequence 2",
    "Specific consequence 3",
    "Specific consequence 4"
  ],

  "premium_preview": {
    "cv_rejection_risks": {
      "headline": "1 sentence: the specific CV-level risk that will cause a recruiter screening ${toTitle} applications to hesitate on a ${fromTitle} profile",
      "teaser_points": [
        "Specific red flag a recruiter would note from a ${fromTitle} CV",
        "Second specific red flag",
        "Third specific red flag"
      ]
    },
    "interview_weak_points": {
      "headline": "1 sentence: the interview moment where a ${fromTitle} candidate is most likely to struggle in a ${toTitle} panel",
      "teaser_points": [
        "Specific question or scenario they will struggle with",
        "Second weak point",
        "Third weak point"
      ]
    },
    "transition_timeline": {
      "headline": "1 sentence: realistic framing of the ${fromTitle} to ${toTitle} transition timeline",
      "realistic_range": "e.g. 9-18 months -- be honest, not optimistic",
      "key_milestones": [
        "First concrete checkpoint on the path",
        "Second checkpoint",
        "Final milestone before applying"
      ]
    },
    "salary_upside": {
      "headline": "1 sentence: salary trajectory from ${fromTitle} to ${toTitle} after closing gaps",
      "from_band": "e.g. GBP45,000-55,000 typical for ${fromTitle} in UK",
      "to_band": "e.g. GBP60,000-80,000 typical for ${toTitle} in UK",
      "uplift_note": "1 sentence: what determines whether someone lands at the lower or upper end of the target band"
    },
    "next_tool": {
      "tool": "Resume Optimiser | LinkedIn Optimiser | Interview Prep | Career Roadmap",
      "why": "1 sentence: why this specific tool is the highest-leverage next step for this exact transition"
    }
  }
}

CALIBRATION:
- skill_match_pct: honest 0-100 based on actual skill overlap between the two roles
- gap_scoreboard values: spread across a real range -- do not cluster at 50
- transition_risk: higher score = more risky (inverted direction vs readiness)
- missing_skills: minimum 5 items, maximum 8
- experience_gaps: minimum 4 items
- All premium_preview content must reference ${fromTitle} and ${toTitle} specifically -- not generic
- next_tool: pick the single most impactful tool for THIS specific transition`;

  const raw = await callAI(system, user);
  return parseJson(raw);
}

// ============================================================================
// Fallback empty data
// ============================================================================

function emptyData(fromTitle, toTitle) {
  return {
    meta: { is_role_based: true, from_title: fromTitle, to_title: toTitle },
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
    premium_preview:   null,
  };
}

// ============================================================================
// Helpers
// ============================================================================

async function callAI(system, user) {
  const r = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user   },
    ],
    temperature: 0.4,
    response_format: { type: "json_object" },
  });
  return r.choices?.[0]?.message?.content?.trim() ?? "{}";
}

function parseJson(raw) {
  let t = (raw || "").trim().replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch {
    const m = t.match(/\{[\s\S]*\}/);
    try { return JSON.parse(m?.[0] || "{}"); } catch { return {}; }
  }
}
