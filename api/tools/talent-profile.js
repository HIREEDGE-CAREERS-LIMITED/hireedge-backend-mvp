// ============================================================================
// api/tools/talent-profile.js
// HireEdge Backend — Talent Profile (Production v1)
//
// The central intelligence layer of HireEdge.
// Combines role data, skill analysis and candidate background into a
// McKinsey-grade 10-section career profile report.
//
// POST body:
//   currentRole   string   required  slug
//   targetRole    string   optional  slug
//   skills        string   optional  comma-separated
//   yearsExp      number   optional
//   resumeText    string   optional  CV text — drives personalisation depth
//   jobDescription string  optional
//
// Returns:
//   talent_score · executive_summary · transition_confidence · scorecards
//   strengths · critical_gaps · market_positioning · strategic_recommendation
//   action_priorities · outcome_roi
// ============================================================================

import OpenAI from "openai";
import { getRoleBySlug } from "../../lib/dataset/roleIndex.js";
import { enforceBilling } from "../../lib/billing/billingMiddleware.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ALLOWED_PLANS = ["pro", "elite"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });

  // Talent Profile is a Pro/Elite feature
  const plan = (req.headers["x-hireedge-plan"] || "free").toLowerCase().trim();
  if (!ALLOWED_PLANS.includes(plan)) {
    return res.status(403).json({
      ok:         false,
      reason:     "access_denied",
      upgrade_to: "pro",
      message:    "Talent Profile is included in Pro or Elite plans.",
    });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON" });
  }

  const {
    currentRole    = "",
    targetRole     = "",
    skills         = "",
    yearsExp       = null,
    resumeText     = "",
    jobDescription = "",
  } = body;

  if (!currentRole) {
    return res.status(400).json({ ok: false, error: "currentRole is required" });
  }

  const currentData = getRoleBySlug(currentRole);
  const targetData  = targetRole ? getRoleBySlug(targetRole) : null;
  const currTitle   = currentData?.title || _slugToTitle(currentRole);
  const tgtTitle    = targetData?.title  || (targetRole ? _slugToTitle(targetRole) : null);

  if (!currentData) {
    return res.status(404).json({ ok: false, error: `Role not found: ${currentRole}` });
  }

  const skillList = Array.isArray(skills)
    ? skills.filter(Boolean)
    : (skills || "").split(",").map((s) => s.trim()).filter(Boolean);

  let profile = _emptyProfile();
  if (process.env.OPENAI_API_KEY) {
    try {
      profile = await _generateProfile({
        currTitle, tgtTitle, skillList, yearsExp, resumeText, jobDescription,
        currentData, targetData,
      });
    } catch (err) {
      console.error("[talent-profile] AI error:", err.message);
    }
  }

  return res.status(200).json({
    ok:   true,
    data: {
      current_role: { slug: currentData.slug, title: currTitle, category: currentData.category, seniority: currentData.seniority },
      target_role:  targetData ? { slug: targetData.slug, title: tgtTitle, category: targetData.category, seniority: targetData.seniority } : null,
      ...profile,
    },
  });
}

// =============================================================================
// Core AI generation — single call, full 10-section report
// =============================================================================

async function _generateProfile({ currTitle, tgtTitle, skillList, yearsExp, resumeText, jobDescription, currentData, targetData }) {
  const currCore = currentData?.skills_grouped?.core      || [];
  const currTech = currentData?.skills_grouped?.technical || [];
  const tgtCore  = targetData?.skills_grouped?.core       || [];
  const tgtTech  = targetData?.skills_grouped?.technical  || [];

  const isTransition = !!(tgtTitle && tgtTitle !== currTitle);

  const ctx = [
    `CURRENT ROLE: ${currTitle} (${currentData.category}, ${currentData.seniority})`,
    currentData.salary_uk?.mean ? `CURRENT SALARY BAND: ~£${currentData.salary_uk.mean.toLocaleString()}` : null,
    tgtTitle ? `TARGET ROLE: ${tgtTitle} (${targetData?.category || "unknown"}, ${targetData?.seniority || "unknown"})` : null,
    tgtTitle && targetData?.salary_uk?.mean ? `TARGET SALARY BAND: ~£${targetData.salary_uk.mean.toLocaleString()}` : null,
    isTransition ? `TRANSITION TYPE: Career move from ${currTitle} to ${tgtTitle}` : `CONTEXT: Building profile for ${currTitle}`,
    yearsExp     ? `YEARS OF EXPERIENCE: ${yearsExp}` : null,
    skillList.length ? `CANDIDATE SKILLS: ${skillList.slice(0, 24).join(", ")}` : null,
    currCore.length  ? `${currTitle} CORE COMPETENCIES: ${currCore.slice(0, 8).join(", ")}` : null,
    tgtCore.length   ? `${tgtTitle} REQUIRED CORE SKILLS: ${tgtCore.slice(0, 8).join(", ")}` : null,
    tgtTech.length   ? `${tgtTitle} REQUIRED TECHNICAL SKILLS: ${tgtTech.slice(0, 6).join(", ")}` : null,
    resumeText       ? `\nCANDIDATE BACKGROUND (CV):\n${resumeText.slice(0, 2500)}` : null,
    jobDescription   ? `\nTARGET JOB DESCRIPTION:\n${jobDescription.slice(0, 1000)}` : null,
  ].filter(Boolean).join("\n");

  const system = `You are a McKinsey-level senior career strategist producing a bespoke Talent Profile report.

This is the most important document HireEdge produces. It must feel like a £100 professional career assessment.

STANDARDS:
- Every sentence must be specific to THIS candidate — not one generic word
- Lead with conclusions, then evidence
- No hedging: never "you might", "could consider", "it may be worth"  
- No buzzwords: never "passionate", "results-driven", "dynamic", "leverage synergies"
- Tone: senior partner briefing a client — confident, precise, direct
- Short paragraphs: 2 sentences max per block
- UK spelling throughout

CALIBRATION:
- talent_score: calibrate to how competitive this candidate actually is for their stated target
- scorecards: each score must genuinely differ — don't cluster around 60
- strengths: must reference the candidate's actual background — not generic capabilities
- gaps: must be the actual gaps for THIS transition, not generic career advice
- action_priorities: must be completable actions, not goals

Return ONLY valid JSON. No markdown, no backticks, no prose outside JSON.`;

  const user = `${ctx}

Generate a complete 10-section Talent Profile. Return this EXACT JSON:

{
  "talent_score": {
    "score": 0,
    "status": "Strong Fit | High Potential | Needs Development | Weak Position",
    "verdict": "One sharp, personalised verdict sentence. Example: 'A commercially strong operator with real transition potential, but lacking the product execution proof points that hiring managers require.' Never generic.",
    "risk_level": "Low | Medium | High"
  },

  "executive_summary": {
    "who_they_are": "2 sentences: who this person is in the professional market — their identity, category, and what makes them distinct. Reference their role and any standout background.",
    "market_perception": "2 sentences: how recruiters and hiring managers currently see this profile — what they'll assume, what they'll probe, what they'll worry about.",
    "biggest_strength": "The single most compelling commercial asset this person has. 1 sentence. Specific.",
    "holding_them_back": "The single biggest barrier to their next step. 1 sentence. Specific and honest."
  },

  "transition_confidence": {
    "probability": 0,
    "label": "e.g. 'Achievable with structured effort' — 4–6 words",
    "explanation": "2 sentences on why this probability is realistic. Name the specific transferable assets and the specific gaps that drive this number."
  },

  "scorecards": [
    {
      "dimension": "Skills Strength",
      "score": 0,
      "label": "strength | developing | gap",
      "note": "1 sentence diagnosis of their actual skill profile vs. target requirements"
    },
    {
      "dimension": "Experience Fit",
      "score": 0,
      "label": "strength | developing | gap",
      "note": "1 sentence on how well their experience history maps to the target role"
    },
    {
      "dimension": "Market Readiness",
      "score": 0,
      "label": "strength | developing | gap",
      "note": "1 sentence on how ready they are to apply and compete right now"
    },
    {
      "dimension": "Positioning Strength",
      "score": 0,
      "label": "strength | developing | gap",
      "note": "1 sentence on how well their narrative, LinkedIn, and CV position them for the target"
    },
    {
      "dimension": "Career Mobility",
      "score": 0,
      "label": "strength | developing | gap",
      "note": "1 sentence on how feasible and low-risk this career move is structurally"
    }
  ],

  "strengths": [
    {
      "strength": "Named, specific strength — e.g. 'Enterprise stakeholder management from 7 years of consultative sales'",
      "detail": "Why this specific strength is a competitive advantage for the target role. 1 sentence."
    },
    { "strength": "string", "detail": "string" },
    { "strength": "string", "detail": "string" },
    { "strength": "string", "detail": "string" },
    { "strength": "string", "detail": "string" }
  ],

  "critical_gaps": [
    {
      "gap": "Named, precise gap — e.g. 'No product discovery or Agile sprint execution experience'",
      "impact": "What this gap costs in the interview or the role. 1 sentence.",
      "urgency": "High | Medium | Low"
    },
    { "gap": "string", "impact": "string", "urgency": "string" },
    { "gap": "string", "impact": "string", "urgency": "string" },
    { "gap": "string", "impact": "string", "urgency": "string" }
  ],

  "market_positioning": {
    "how_recruiters_see": "2 sentences on what a recruiter opening this CV sees immediately — their first impression and concern.",
    "fits_today": "The specific role or level this person realistically fits right now — be honest, not optimistic.",
    "what_must_change": "2 sentences: the specific, named shift in profile, narrative, or experience needed to reach the target role."
  },

  "strategic_recommendation": {
    "path": "Safe path | Fast path | Hybrid path",
    "path_label": "Short name for the recommended route — e.g. 'Structured 12-month upskilling sprint'",
    "why_best": "2–3 sentences: why this path specifically suits this candidate's profile, risk tolerance, and market position. Reference their background.",
    "risk_level": "Low | Medium | High",
    "timeline": "e.g. 12–18 months",
    "key_bets": [
      "The single most important thing they must execute correctly for this to work",
      "Second critical success factor",
      "Third — optional but important"
    ]
  },

  "action_priorities": [
    {
      "priority": 1,
      "action": "Specific, named, completable action — e.g. 'Build one end-to-end product case study using customer discovery and a prioritised backlog'",
      "impact": "High | Medium",
      "why": "Why this is the highest-leverage first action. 1 sentence.",
      "timeframe": "This week | This month | Next 3 months"
    },
    {
      "priority": 2,
      "action": "string",
      "impact": "string",
      "why": "string",
      "timeframe": "string"
    },
    {
      "priority": 3,
      "action": "string",
      "impact": "string",
      "why": "string",
      "timeframe": "string"
    }
  ],

  "outcome_roi": {
    "salary_growth": "Expected salary trajectory — e.g. '~15–25% uplift within 18 months of successful transition'",
    "growth_potential": "2 sentences: the ceiling of this career path and what top performers in this role earn / achieve.",
    "time_to_results": "When they'll see meaningful, tangible progress — 1 sentence. Honest, not optimistic."
  }
}

MANDATORY RULES:
- talent_score must be calibrated: without CV typically 45–65, with CV and strong background 60–82
- scorecards must spread across a range — do not cluster at 60–65
- Every strength must reference the candidate's actual role/background, not generic capabilities
- Every gap must name the SPECIFIC skill or experience missing for THIS target role
- strategic_recommendation.key_bets must be the actual make-or-break factors for THIS transition
- action_priorities must be concrete and completable, not strategy-level goals
- outcome_roi must reference UK market ranges where possible`;

  const raw = await _callAI(system, user);
  return _parseJson(raw);
}

// =============================================================================
// Helpers
// =============================================================================

function _emptyProfile() {
  return {
    talent_score:             null,
    executive_summary:        null,
    transition_confidence:    null,
    scorecards:               [],
    strengths:                [],
    critical_gaps:            [],
    market_positioning:       null,
    strategic_recommendation: null,
    action_priorities:        [],
    outcome_roi:              null,
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

function _slugToTitle(s) {
  return (s || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
