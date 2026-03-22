// ============================================================================
// api/tools/career-pack.js
// HireEdge Backend -- Career Pack Master Report Engine (v1)
//
// POST body:
//   currentRole   string   required   e.g. "sales-manager" or "Sales Manager"
//   targetRole    string   required   e.g. "product-manager"
//   country       string   optional   default "UK"
//   yearsExp      number   optional
//   education     string   optional   "phd|masters|bachelors|diploma|none"
//   skills        string   optional   comma-separated current skills
//
// Returns a single unified Career Transition Plan with 8 sections:
//   hero          -- readiness, difficulty, timeline, salary growth
//   positioning   -- market identity, positioning gap, how to reframe
//   gap_summary   -- top skill gaps, experience gaps, market perception
//   best_pathway  -- recommended route, phases, bridge roles
//   visa_strategy -- eligibility, best route, key requirements
//   execution     -- 30/60/90 day plan
//   tool_plan     -- resume, linkedin, interview activation steps
//   final_outcome -- what success looks like, salary target, probability
// ============================================================================

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  const plan = req.headers["x-hireedge-plan"] || "free";
  const ALLOWED = ["career_pack", "pro", "elite"];
  if (!ALLOWED.includes(plan)) {
    return res.status(403).json({ ok: false, reason: "access_denied", upgrade_to: "career_pack" });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON body" });
  }

  const {
    currentRole = "",
    targetRole  = "",
    country     = "UK",
    yearsExp    = null,
    education   = "",
    skills      = "",
  } = body;

  if (!currentRole) return res.status(400).json({ ok: false, error: "currentRole is required" });
  if (!targetRole)  return res.status(400).json({ ok: false, error: "targetRole is required" });

  let data = emptyData(currentRole, targetRole, country);
  if (process.env.OPENAI_API_KEY) {
    try {
      data = await generate({ currentRole, targetRole, country, yearsExp, education, skills });
    } catch (e) {
      console.error("[career-pack]", e.message);
    }
  }

  return res.status(200).json({ ok: true, data });
}

// ============================================================================
// AI generation
// ============================================================================

async function generate({ currentRole, targetRole, country, yearsExp, education, skills }) {
  const ctx = [
    "CURRENT ROLE: " + currentRole,
    "TARGET ROLE: " + targetRole,
    "TARGET COUNTRY: " + country,
    yearsExp  ? "YEARS OF EXPERIENCE: " + yearsExp : null,
    education ? "EDUCATION: " + education           : null,
    skills    ? "CURRENT SKILLS: " + skills         : null,
  ].filter(Boolean).join("\n");

  const system = `You are HireEdge's senior career intelligence engine. You produce precise, structured Career Transition Plans -- not generic career advice.

LANGUAGE RULES:
- Frame everything as market/system intelligence: "Candidates moving from X to Y typically...", "Hiring managers in ${country} usually expect...", "The transition from ${currentRole} to ${targetRole} typically requires..."
- Never say "you lack" or "your profile". Say "this transition typically requires" or "candidates in this position usually need"
- Be direct and honest about difficulty -- frame as systemic reality, not personal failing
- UK English spelling throughout
- Every section must be specific to ${currentRole} -> ${targetRole} in ${country}. Zero generic advice.
- Return ONLY valid JSON. No markdown, no backticks, no text outside the JSON.`;

  const user = ctx + `

Produce a complete Career Transition Plan for a ${currentRole} transitioning to ${targetRole} in ${country}.

Return this EXACT JSON shape:

{
  "hero": {
    "current_role": "${currentRole}",
    "target_role": "${targetRole}",
    "country": "${country}",
    "readiness_pct": 0,
    "difficulty": "Easy | Moderate | Hard | Very Hard",
    "estimated_timeline": "e.g. 6-12 months",
    "salary_growth": "e.g. +18% to +35%",
    "headline": "One authoritative sentence: the realistic picture of this transition in ${country}.",
    "overall_verdict": "2-3 sentences. What this transition actually looks like in the ${country} market -- how common it is, what the main structural challenge is, and what makes it achievable."
  },

  "positioning": {
    "current_market_identity": "How the ${country} job market typically reads a ${currentRole} profile",
    "target_identity": "How hiring managers for ${targetRole} roles in ${country} typically want candidates positioned",
    "positioning_gap": "The specific gap between how this profile is currently read vs. how it needs to be read",
    "reframe_strategy": "The core repositioning move -- what narrative shift makes the transition credible to ${country} employers",
    "transferable_strengths": [
      { "strength": "Named strength from ${currentRole}", "how_it_maps": "How it maps to ${targetRole} value in ${country}" }
    ],
    "positioning_statement": "A 2-sentence professional positioning statement for this candidate making this transition"
  },

  "gap_summary": {
    "overall_gap_severity": "High | Medium | Low",
    "skill_match_pct": 0,
    "top_skill_gaps": [
      { "skill": "Skill name", "severity": "High | Medium | Low", "why_it_matters": "Why ${targetRole} hiring managers in ${country} require this", "time_to_close": "e.g. 4-8 weeks" }
    ],
    "experience_gaps": [
      { "gap": "Named experience gap", "severity": "High | Medium | Low", "explanation": "Why this gap exists for ${currentRole} moving to ${targetRole}" }
    ],
    "market_perception": {
      "recruiter_view": "How ${country} recruiters typically categorise this profile when it applies for ${targetRole}",
      "hiring_manager_view": "What ${country} hiring managers typically look for and whether this profile fits",
      "biggest_barrier": "The single most important barrier in the ${country} market for this transition"
    },
    "bridge_roles": ["Role that accelerates the transition", "Second bridge option"]
  },

  "best_pathway": {
    "recommended_path": "Direct | Bridge Role | Upskill First | Hybrid",
    "path_headline": "1 sentence: why this is the optimal path for ${currentRole} to ${targetRole} in ${country}",
    "total_timeline": "e.g. 9-15 months",
    "phases": [
      {
        "phase": 1,
        "label": "Phase name e.g. Foundation",
        "duration": "e.g. 0-3 months",
        "goal": "What this phase achieves",
        "actions": ["Specific action 1", "Specific action 2", "Specific action 3"],
        "milestone": "What success looks like at the end of this phase"
      },
      {
        "phase": 2,
        "label": "string",
        "duration": "string",
        "goal": "string",
        "actions": ["string", "string", "string"],
        "milestone": "string"
      },
      {
        "phase": 3,
        "label": "string",
        "duration": "string",
        "goal": "string",
        "actions": ["string", "string", "string"],
        "milestone": "string"
      }
    ],
    "probability_score": 0,
    "success_factors": ["Factor that increases probability", "Second factor", "Third factor"]
  },

  "visa_strategy": {
    "eligibility": "High | Medium | Low | Not Applicable",
    "note": "Brief note on why visa is or isn't relevant for this profile in ${country}",
    "best_route": "Named visa route e.g. UK Skilled Worker, or 'Not required - already eligible'",
    "key_requirements": ["Requirement 1", "Requirement 2", "Requirement 3"],
    "salary_threshold": "e.g. GBP38,700 minimum for Skilled Worker in ${country}",
    "sponsorship_note": "1 sentence on sponsorship situation for ${targetRole} in ${country}"
  },

  "execution_plan": {
    "day_30": {
      "label": "First 30 Days",
      "theme": "Theme name e.g. Intelligence Gathering",
      "actions": [
        { "action": "Specific completable action", "why": "Why this is the highest-leverage first move", "output": "What you have at the end" }
      ]
    },
    "day_60": {
      "label": "Days 31-60",
      "theme": "string",
      "actions": [
        { "action": "string", "why": "string", "output": "string" }
      ]
    },
    "day_90": {
      "label": "Days 61-90",
      "theme": "string",
      "actions": [
        { "action": "string", "why": "string", "output": "string" }
      ]
    }
  },

  "tool_plan": {
    "cv": {
      "headline_change": "The single most important CV change for this transition in ${country}",
      "key_adjustments": ["Specific CV adjustment 1", "Specific CV adjustment 2", "Specific CV adjustment 3"],
      "remove": ["Thing to remove from CV that hurts this application"],
      "add": ["Thing to add that signals ${targetRole} readiness to ${country} employers"]
    },
    "linkedin": {
      "headline_recommendation": "Recommended LinkedIn headline for this transition",
      "about_focus": "What the About section should lead with for this transition",
      "key_signals": ["Signal to add to LinkedIn", "Second signal", "Third signal"]
    },
    "interview": {
      "narrative": "The core transition story to tell in interviews for ${targetRole} roles",
      "top_questions": [
        { "question": "Most likely interview question for this transition", "framing": "How to frame the answer given the ${currentRole} background" }
      ],
      "gap_handling": "How to address the ${currentRole} -> ${targetRole} transition question directly"
    }
  },

  "final_outcome": {
    "success_definition": "What success looks like 12 months from now for this transition in ${country}",
    "target_salary_range": "e.g. GBP55,000 - GBP70,000",
    "transition_probability": 0,
    "probability_note": "1 sentence: what primarily determines whether this transition succeeds in the ${country} market",
    "biggest_risk": "The single most likely reason this transition stalls -- and how to prevent it",
    "time_sensitive_note": "1 sentence: why starting now matters more than starting in 6 months for this specific transition"
  }
}

CALIBRATION:
- readiness_pct: 0-100 based on realistic ${country} market standards for ${targetRole}
- skill_match_pct: honest overlap between ${currentRole} and ${targetRole} skill sets
- probability_score: 0-100 realistic success probability in ${country} market
- transition_probability: same as probability_score
- difficulty: based on actual market distance between these two roles in ${country}
- All salary figures in GBP for ${country}
- execution_plan: minimum 3 actions per day-block, each with specific output
- top_questions: minimum 2 interview questions
- transferable_strengths: minimum 3
- top_skill_gaps: minimum 4, maximum 6
- experience_gaps: minimum 3
- LANGUAGE CHECK: every sentence must use market/system framing, never personal accusatory language`;

  const raw = await callAI(system, user);
  return parseJson(raw);
}

// ============================================================================
// Empty fallback
// ============================================================================

function emptyData(currentRole, targetRole, country) {
  return {
    hero: {
      current_role: currentRole,
      target_role: targetRole,
      country,
      readiness_pct: 0,
      difficulty: "Moderate",
      estimated_timeline: "--",
      salary_growth: "--",
      headline: "Generating your Career Transition Plan...",
      overall_verdict: "",
    },
    positioning:    null,
    gap_summary:    null,
    best_pathway:   null,
    visa_strategy:  null,
    execution_plan: null,
    tool_plan:      null,
    final_outcome:  null,
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
    temperature: 0.3,
    response_format: { type: "json_object" },
    max_tokens: 4000,
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
