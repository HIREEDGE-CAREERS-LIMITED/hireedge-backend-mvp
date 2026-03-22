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

  const system = `You are a senior UK talent market analyst producing a Career Gap Diagnostic report.

LANGUAGE RULES -- CRITICAL:
- NEVER say "you lack", "your profile", "you don't have", "you are missing"
- ALWAYS use market-pattern framing:
  - "Candidates moving from [from] to [to] typically..."
  - "In the UK market, this transition usually requires..."
  - "Hiring managers often expect..."
  - "This shift typically involves..."
  - "Based on hiring patterns..."
  - "Most candidates making this move..."
- Every output must feel like MARKET INTELLIGENCE, not personal criticism
- Be honest about difficulty -- do not soften the reality -- but frame it as market fact not personal failing
- UK market context and UK spelling throughout
- Short, direct sentences. No filler. No hedging beyond credibility words (typically, often, usually, in most cases)
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
    "title": "One sharp sentence describing what makes the ${fromTitle} to ${toTitle} transition structurally challenging or straightforward -- framed as market fact, not personal assessment",
    "gap_severity": "High | Medium | Low",
    "skill_match_pct": 0,
    "transition_difficulty": "Hard | Medium | Easy"
  },

  "verdict": {
    "headline": "One authoritative sentence. Format: 'The transition from ${fromTitle} to ${toTitle} is typically [easy/moderate/hard] due to [specific structural reason].' Then on the same string, add a second sentence: 'This shift requires moving from [current mindset/focus] to [target mindset/focus], which most candidates need structured time to build.'",
    "is_realistic": true,
    "biggest_blocker": "The most important structural gap in this transition -- named as a market expectation, not a personal failing. E.g. '${toTitle} roles typically require X, which ${fromTitle} roles rarely involve.'",
    "biggest_advantage": "The strongest transferable asset candidates moving from ${fromTitle} bring to ${toTitle} -- framed as market value",
    "summary": "2-3 sentences. Realistic assessment of this transition, framed as market intelligence. Use 'candidates making this move typically...' not 'you will...'."
  },

  "gap_origins": {
    "skill_gap": {
      "severity": "High | Medium | Low",
      "explanation": "2 sentences. What skills ${toTitle} roles typically require that ${fromTitle} roles do not usually develop. Name specific skills. Start with 'This transition typically requires...' or 'In most cases, ${toTitle} roles demand...'",
      "why_it_matters": "1 sentence. The hiring or on-the-job consequence of this gap, framed as market fact."
    },
    "experience_gap": {
      "severity": "High | Medium | Low",
      "explanation": "2 sentences. Real-world experience ${toTitle} hiring managers typically expect that ${fromTitle} roles do not usually provide. Frame as market expectation.",
      "why_it_matters": "1 sentence. Why hiring managers often screen on this specific experience gap."
    },
    "market_gap": {
      "severity": "High | Medium | Low",
      "explanation": "2 sentences. How the market typically categorises ${fromTitle} candidates applying for ${toTitle} roles. Based on hiring patterns.",
      "why_it_matters": "1 sentence. The commercial consequence of this positioning gap in the hiring process."
    }
  },

  "gap_scoreboard": {
    "skills_readiness": 0,
    "experience_readiness": 0,
    "market_readiness": 0,
    "transition_risk": 0,
    "overall_note": "1 sentence. What this scoreboard pattern typically means for candidates making this transition."
  },

  "missing_skills": [
    {
      "skill": "Specific named skill -- not a category",
      "severity": "High | Medium | Low",
      "why_it_matters": "1 sentence framed as market expectation: '${toTitle} roles typically require...' or 'Hiring managers often screen for...'",
      "how_to_close": "1 sentence: the most direct way candidates typically build this skill",
      "time_estimate": "e.g. 4-6 weeks"
    }
  ],

  "experience_gaps": [
    {
      "gap": "Named missing experience -- e.g. 'Product roadmap ownership'",
      "severity": "High | Medium | Low",
      "explanation": "1-2 sentences. Why ${fromTitle} roles typically do not provide this experience, and why ${toTitle} hiring managers look for it. Use 'In most cases...' or 'Candidates from ${fromTitle} backgrounds often...'"
    }
  ],

  "market_perception": {
    "recruiter_view": "2 sentences. How recruiters typically read a ${fromTitle} application for a ${toTitle} role -- based on hiring patterns. Use 'Recruiters often...' or 'In most cases, a ${fromTitle} profile applying for ${toTitle}...'",
    "hiring_manager_view": "2 sentences. What ${toTitle} hiring managers typically look for that this transition profile usually does not immediately demonstrate. Use 'Hiring managers often expect...' or 'In ${toTitle} interviews, candidates typically need to show...'",
    "positioning_gap": "1-2 sentences. The typical narrative gap between how ${fromTitle} candidates present and what ${toTitle} roles require. Frame as market pattern, not personal failing."
  },

  "fits_now": {
    "current_fit": "Specific roles that candidates with a ${fromTitle} background are typically competitive for today -- name actual role titles, be honest",
    "stretch_fit": "Roles that are typically achievable with 3-6 months of targeted preparation for this transition",
    "not_yet": "Why ${toTitle} is typically not yet realistic for ${fromTitle} candidates without closing specific gaps first -- name the gaps",
    "bridge_roles": ["Role 1", "Role 2", "Role 3"]
  },

  "fix_plan": [
    {
      "action": "Specific, named, completable action that directly closes the most important gap in this transition",
      "why_first": "1 sentence. The market impact: why this action has the highest leverage in the hiring process for this specific transition. Use 'Hiring managers typically...' or 'This directly addresses...'",
      "expected_outcome": "1 sentence. What changes in how the market reads this candidate profile once this action is completed.",
      "time_estimate": "e.g. 2-4 weeks"
    },
    { "action": "string", "why_first": "string", "expected_outcome": "string", "time_estimate": "string" },
    { "action": "string", "why_first": "string", "expected_outcome": "string", "time_estimate": "string" }
  ],

  "risk_if_ignored": [
    "1 sentence. What typically happens to candidates making this transition who do not address the skill gaps within 12 months. Framed as market consequence, not personal failure.",
    "1 sentence. How the competitive landscape for this transition typically shifts over time against candidates who delay.",
    "1 sentence. The likely recruiter categorisation that becomes harder to change the longer this transition is delayed.",
    "1 sentence. The salary or career ceiling that typically applies if the transition does not happen."
  ],

  "premium_preview": {
    "cv_rejection_risks": {
      "headline": "1 sentence framed as market pattern: 'Recruiters screening ${toTitle} applications often hesitate on ${fromTitle} profiles because...' -- name the specific CV signal",
      "teaser_points": [
        "A specific CV signal that typically raises a recruiter flag for this transition",
        "Second typical flag",
        "Third typical flag"
      ]
    },
    "interview_weak_points": {
      "headline": "1 sentence framed as market pattern: 'In ${toTitle} interviews, candidates from ${fromTitle} backgrounds often struggle when...' -- name the specific scenario",
      "teaser_points": [
        "A specific interview question or scenario that typically exposes this gap",
        "Second common weak point in this transition",
        "Third common weak point"
      ]
    },
    "transition_timeline": {
      "headline": "1 sentence framed as realistic market expectation: 'Based on hiring patterns, candidates moving from ${fromTitle} to ${toTitle} typically take...'",
      "realistic_range": "e.g. 9-18 months -- be honest based on typical market experience, not optimistic",
      "key_milestones": [
        "First concrete checkpoint candidates typically need to reach",
        "Second checkpoint",
        "Final milestone typically needed before applying competitively"
      ]
    },
    "salary_upside": {
      "headline": "1 sentence on the typical salary trajectory for this transition in the UK market",
      "from_band": "e.g. GBP45,000-55,000 typical for ${fromTitle} in UK",
      "to_band": "e.g. GBP60,000-80,000 typical for ${toTitle} in UK",
      "uplift_note": "1 sentence: what typically determines whether candidates land at the lower or upper end of the target band"
    },
    "next_tool": {
      "tool": "Resume Optimiser | LinkedIn Optimiser | Interview Prep | Career Roadmap",
      "why": "1 sentence framed as market impact: why this specific tool has the highest leverage for the ${fromTitle} to ${toTitle} transition in the current market"
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
- next_tool: pick the single most impactful tool for THIS specific transition
- LANGUAGE CHECK: Before finalising, verify every sentence uses market-pattern framing ("typically", "often", "in most cases", "hiring managers expect", "candidates from X backgrounds") -- never personal accusatory language ("you lack", "your profile does not", "you are missing")`;

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
