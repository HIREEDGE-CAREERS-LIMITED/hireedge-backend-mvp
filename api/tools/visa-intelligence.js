// ============================================================================
// api/tools/visa-intelligence.js
// HireEdge Backend -- Visa Intelligence Engine (v1)
//
// POST body:
//   country        string   required  e.g. "UK", "Canada", "Australia", "Germany"
//   currentRole    string   required  slug or free text
//   yearsExp       number   optional
//   education      string   optional  "phd|masters|bachelors|diploma|none"
//   targetRole     string   optional  slug or free text
//
// Returns:
//   hero           -- eligibility, difficulty, timeline, country
//   verdict        -- headline, summary, is_achievable, biggest_barrier, biggest_asset
//   best_pathways  -- top 2-3 visa routes with fit reasoning
//   requirement_gaps -- what is missing to qualify
//   scoreboard     -- 4 readiness bars
//   strategy       -- step-by-step plan
//   risk_ignored   -- 4 consequences of inaction
//   premium_preview -- locked teasers
// ============================================================================

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON" });
  }

  const { country = "", currentRole = "", yearsExp = null, education = "", targetRole = "" } = body;

  if (!country)     return res.status(400).json({ ok: false, error: "country is required" });
  if (!currentRole) return res.status(400).json({ ok: false, error: "currentRole is required" });

  let data = emptyData(country, currentRole);
  if (process.env.OPENAI_API_KEY) {
    try {
      data = await generate({ country, currentRole, yearsExp, education, targetRole });
    } catch (e) {
      console.error("[visa-intelligence]", e.message);
    }
  }

  return res.status(200).json({ ok: true, data });
}

// ============================================================================
// AI generation
// ============================================================================

async function generate({ country, currentRole, yearsExp, education, targetRole }) {
  const ctx = [
    "TARGET COUNTRY: " + country,
    "CURRENT ROLE: " + currentRole,
    yearsExp    ? "YEARS OF EXPERIENCE: " + yearsExp : null,
    education   ? "EDUCATION LEVEL: " + education   : null,
    targetRole  ? "TARGET ROLE IN " + country.toUpperCase() + ": " + targetRole : null,
  ].filter(Boolean).join("\n");

  const system = `You are a senior UK and international immigration strategist and career advisor.
You produce precise, structured visa intelligence reports -- not generic visa guides.

LANGUAGE RULES:
- Frame everything as market/system facts: "Candidates with X background typically...", "The ${country} immigration system usually requires..."
- Never say "you lack" or "your profile doesn't". Say "this transition typically requires..." or "most candidates in this position need..."
- Be direct and honest about difficulty -- but frame as systemic reality, not personal failing
- UK English spelling throughout
- Return ONLY valid JSON. No markdown, no backticks, no text outside JSON.`;

  const user = ctx + `

Produce a complete Visa Intelligence Report for a ${currentRole} seeking to work in ${country}.

Return this EXACT JSON:

{
  "hero": {
    "country": "${country}",
    "current_role": "${currentRole}",
    "target_role": "${targetRole || currentRole}",
    "eligibility": "High | Medium | Low | Not Possible",
    "difficulty": "Easy | Moderate | Hard",
    "estimated_timeline": "e.g. 3-6 months",
    "headline_metric": "e.g. '2 visa pathways available' or 'Strong candidate for Skilled Worker'"
  },

  "verdict": {
    "headline": "One authoritative sentence: the overall visa situation for this profile in ${country}. Format: 'A ${currentRole} with [X] experience typically [qualifies/faces challenges] for [route] in ${country} because [specific reason].'",
    "is_achievable": true,
    "biggest_barrier": "The single most important obstacle -- named as a system requirement, not a personal failing",
    "biggest_asset": "The strongest factor working in favour of this profile in the ${country} immigration system",
    "summary": "2-3 sentences. The realistic picture of this visa situation -- what routes are typically available, what the main structural challenge is, and what the realistic outcome looks like."
  },

  "best_pathways": [
    {
      "visa_name": "Official name of the visa route",
      "who_its_for": "1 sentence: the type of candidate this route is designed for",
      "why_it_fits": "1-2 sentences: specifically why this profile is or could be a match for this route",
      "key_requirements": ["Requirement 1", "Requirement 2", "Requirement 3"],
      "typical_timeline": "e.g. 3-8 weeks processing",
      "fit_score": 0
    }
  ],

  "requirement_gaps": [
    {
      "gap": "Named specific gap -- e.g. 'Job offer from licensed sponsor required'",
      "severity": "High | Medium | Low",
      "explanation": "1-2 sentences: why this gap exists for this profile and what it costs",
      "how_to_address": "1 sentence: the most direct way to close this gap"
    }
  ],

  "scoreboard": {
    "skills_alignment": 0,
    "salary_threshold_readiness": 0,
    "qualification_match": 0,
    "sponsorship_prospects": 0,
    "overall_note": "1 sentence on what the overall picture looks like"
  },

  "strategy": [
    {
      "step": 1,
      "action": "Specific, completable first action",
      "why_first": "1 sentence: why this is the highest-leverage first move for this profile in ${country}",
      "expected_outcome": "1 sentence: what changes once this is done",
      "time_estimate": "e.g. 2-4 weeks"
    },
    {
      "step": 2,
      "action": "string",
      "why_first": "string",
      "expected_outcome": "string",
      "time_estimate": "string"
    },
    {
      "step": 3,
      "action": "string",
      "why_first": "string",
      "expected_outcome": "string",
      "time_estimate": "string"
    }
  ],

  "risk_ignored": [
    "1 sentence: what typically happens to candidates with this profile who delay their ${country} visa application by 12+ months",
    "1 sentence: how immigration policy changes in ${country} typically disadvantage candidates who wait",
    "1 sentence: the career cost of delaying the move in terms of salary, role level, or opportunities",
    "1 sentence: the compounding difficulty of starting the process later"
  ],

  "premium_preview": {
    "cv_optimisation": {
      "headline": "1 sentence: the specific CV adjustment that most improves success with ${country} employers and visa sponsors",
      "teaser_points": [
        "Specific CV signal ${country} employers typically look for in this role category",
        "Second signal",
        "Third signal"
      ]
    },
    "sponsorship_targets": {
      "headline": "1 sentence: the type of employer in ${country} most likely to sponsor a ${currentRole}",
      "teaser_points": [
        "Industry or employer type most likely to sponsor this role in ${country}",
        "Second target category",
        "Third target"
      ]
    },
    "country_strategy": {
      "headline": "1 sentence: the most strategic approach to the ${country} job market for this profile",
      "teaser_points": [
        "Specific job market tactic for ${country} with this background",
        "Second tactic",
        "Third tactic"
      ]
    }
  }
}

CALIBRATION:
- eligibility: based on real ${country} visa routes for ${currentRole} profiles
- fit_score: 0-100, how well this profile typically matches each visa route
- scoreboard values: spread across a real range, do not cluster at 50
- best_pathways: minimum 2 routes, maximum 3 -- only include routes that actually exist in ${country}
- requirement_gaps: minimum 3, maximum 5 -- only real gaps based on actual ${country} requirements
- All content must reference ${country} and ${currentRole} specifically -- zero generic immigration advice
- LANGUAGE CHECK: Every sentence must use market/system framing, never personal accusatory language`;

  const raw = await callAI(system, user);
  return parseJson(raw);
}

// ============================================================================
// Empty fallback
// ============================================================================

function emptyData(country, currentRole) {
  return {
    hero: {
      country,
      current_role:    currentRole,
      target_role:     currentRole,
      eligibility:     "Medium",
      difficulty:      "Moderate",
      estimated_timeline: "--",
      headline_metric: "Assessment pending",
    },
    verdict:          null,
    best_pathways:    [],
    requirement_gaps: [],
    scoreboard:       { skills_alignment: 0, salary_threshold_readiness: 0, qualification_match: 0, sponsorship_prospects: 0 },
    strategy:         [],
    risk_ignored:     [],
    premium_preview:  null,
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
    temperature: 0.35,
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
