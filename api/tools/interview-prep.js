// ============================================================================
// api/tools/interview-prep.js
// HireEdge Backend — Interview Preparation (Production v4)
//
// v4 additions over v3:
//   interview_strategy    — positioning, strengths_to_lead, weaknesses_to_manage,
//                           what_they_care_about (new top section)
//   opening_pitch         — promoted from transition_narratives, 30–45 sec framing
//   readiness_score       — adds focus_areas (ordered prep priorities)
//   red_flags             — 4 personalised mistakes to avoid
//   final_checklist       — day_before / morning_of / in_the_room items
//   mock scoring upgrade  — score_breakdown (structure/content/relevance),
//                           strengths_shown[], improvements_needed[]
// ============================================================================

import OpenAI from "openai";
import { generateInterviewPrep } from "../../lib/tools/interviewEngine.js";
import { getRoleBySlug }         from "../../lib/dataset/roleIndex.js";
import { enforceBilling }        from "../../lib/billing/billingMiddleware.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET")     return _legacyGet(req, res);
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });
  if (enforceBilling(req, res, "interview-prep")) return;

  const mode = req.query?.mode || "prepare";
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}; }
  catch { return res.status(400).json({ ok: false, error: "Invalid JSON" }); }

  if (mode === "mock") return _handleMock(req, res, body);
  return _handlePrepare(req, res, body);
}

// =============================================================================
// MODE: prepare
// =============================================================================

async function _handlePrepare(req, res, body) {
  const {
    targetRole      = "",
    targetRoleTitle = "",
    currentRole     = "",
    skills          = "",
    yearsExp        = null,
    jobDescription  = "",
    resumeText      = "",
  } = body;

  if (!targetRole) return res.status(400).json({ ok: false, error: "targetRole is required" });

  const skillList  = _toArray(skills);
  const engineData = generateInterviewPrep({
    targetRole,
    skills:      skillList,
    currentRole: currentRole || undefined,
    yearsExp:    yearsExp ? parseInt(yearsExp, 10) : undefined,
  });

  if (!engineData) return res.status(404).json({ ok: false, error: `Role not found: ${targetRole}` });

  const targetData  = getRoleBySlug(targetRole);
  const currentData = currentRole ? getRoleBySlug(currentRole) : null;
  const roleTitle   = targetRoleTitle || targetData?.title || _slugToTitle(targetRole);
  const currTitle   = currentData?.title || (currentRole ? _slugToTitle(currentRole) : null);
  const tgtCore     = targetData?.skills_grouped?.core      || [];
  const tgtTech     = targetData?.skills_grouped?.technical || [];
  const currCore    = currentData?.skills_grouped?.core     || [];

  let ai = _emptyAI();
  if (process.env.OPENAI_API_KEY) {
    try {
      ai = await _prepareLayer({ roleTitle, currTitle, skillList, yearsExp, jobDescription, resumeText, engineData, tgtCore, tgtTech, currCore });
    } catch (err) {
      console.error("[interview-prep] AI error:", err.message);
    }
  }

  return res.status(200).json({
    ok:   true,
    data: {
      target_role:           engineData.target_role,
      current_role:          engineData.current_role,
      competency_questions:  engineData.competency_questions  || [],
      technical_questions:   engineData.technical_questions   || [],
      behavioural_questions: engineData.behavioural_questions || [],
      star_preparation:      engineData.star_preparation      || null,
      questions_to_ask:      engineData.questions_to_ask      || [],
      salary_negotiation:    engineData.salary_negotiation    || null,
      weakness_strategy:     engineData.weakness_strategy     || [],
      ai,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AI content layer
// ─────────────────────────────────────────────────────────────────────────────

async function _prepareLayer({ roleTitle, currTitle, skillList, yearsExp, jobDescription, resumeText, engineData, tgtCore, tgtTech, currCore }) {
  const isTransition = !!(currTitle && currTitle !== roleTitle);

  const ctx = [
    `TARGET ROLE: ${roleTitle}`,
    currTitle         ? `CURRENT ROLE: ${currTitle}` : null,
    isTransition      ? `TYPE: Career transition from ${currTitle} to ${roleTitle}` : `TYPE: Direct preparation for ${roleTitle}`,
    yearsExp          ? `YEARS OF EXPERIENCE: ${yearsExp}` : null,
    skillList.length  ? `CANDIDATE SKILLS: ${skillList.slice(0, 20).join(", ")}` : null,
    currCore.length   ? `CURRENT ROLE CORE SKILLS: ${currCore.slice(0, 8).join(", ")}` : null,
    tgtCore.length    ? `TARGET ROLE CORE SKILLS: ${tgtCore.slice(0, 8).join(", ")}` : null,
    tgtTech.length    ? `TARGET ROLE TECHNICAL SKILLS: ${tgtTech.slice(0, 6).join(", ")}` : null,
    engineData.readiness?.score ? `ENGINE READINESS: ${engineData.readiness.score}/100` : null,
    jobDescription    ? `\nJOB DESCRIPTION:\n${jobDescription.slice(0, 1500)}` : null,
    resumeText        ? `\nCANDIDATE CV:\n${resumeText.slice(0, 1800)}` : null,
  ].filter(Boolean).join("\n");

  const system = `You are an elite UK interview coach with 15 years experience placing candidates at top-tier companies.
You produce complete, premium interview preparation packs — not guidance, not frameworks, not templates.
Every piece of content must feel personal to this candidate's exact situation.

RULES:
- UK spelling: organise, specialise, recognise, programme
- All spoken answers must feel like real human speech — conversational, not robotic
- Opening pitch: 80–110 words, spoken in ~35 seconds
- STAR answers: use the candidate's background as context — never generic placeholders
- Red flags: specific to this role and transition — not generic interview advice
- Final checklist: practical and specific — not "be confident" platitudes
- Return ONLY valid JSON. No markdown, no backticks, no prose outside JSON.`;

  const user = `${ctx}

Generate a complete interview preparation pack. Return this exact JSON:

{
  "interview_strategy": {
    "positioning": "2–3 sentences on how to position this candidate for ${roleTitle}. Specific to their background — not generic transition advice. What's the strongest narrative angle?",
    "strengths_to_lead_with": [
      "Specific strength from their background that directly helps for ${roleTitle} — 1 sentence",
      "Second strength",
      "Third strength"
    ],
    "weaknesses_to_manage": [
      {
        "weakness": "Specific weakness or gap for ${roleTitle} given their background",
        "how_to_handle": "Concrete, confident way to address this if it comes up. 1–2 sentences. Never defensive."
      },
      {
        "weakness": "Second weakness",
        "how_to_handle": "string"
      }
    ],
    "what_they_care_about": "2–3 sentences on what hiring managers for ${roleTitle} are actually evaluating beyond the job spec — the unstated criteria that separate candidates who get offers from those who don't."
  },

  "opening_pitch": {
    "text": "A 80–110 word spoken opening pitch — 'tell me about yourself'. Confident, story-driven, ends with a forward-looking hook about why ${roleTitle} is the right next move. First person. Natural speech rhythm. Specific to this candidate's background.",
    "word_count": 0,
    "timing_cue": "~35 seconds",
    "coaching_note": "The single most important delivery tip for this specific answer. 1 sentence."
  },

  "readiness_score": {
    "overall": 0,
    "breakdown": {
      "product_thinking":       { "score": 0, "label": "one of: strength | developing | gap" },
      "stakeholder_management": { "score": 0, "label": "strength | developing | gap" },
      "technical_knowledge":    { "score": 0, "label": "strength | developing | gap" },
      "execution_experience":   { "score": 0, "label": "strength | developing | gap" },
      "communication":          { "score": 0, "label": "strength | developing | gap" }
    },
    "strengths": [
      "Specific strength from this candidate's background. 1 sentence.",
      "Second strength",
      "Third strength"
    ],
    "critical_gaps": [
      "Specific gap for ${roleTitle}. 1 sentence.",
      "Second gap",
      "Third gap"
    ],
    "hiring_risk": "low | medium | medium-high | high",
    "focus_areas": [
      "The single most important area to prep first — specific and actionable. 1 sentence.",
      "Second focus area",
      "Third focus area"
    ]
  },

  "must_prepare_questions": [
    {
      "priority": 1,
      "stakes": "high | very high",
      "category": "transition | behavioural | product | stakeholder | technical | motivation",
      "question": "Exact question as the interviewer asks it",
      "why_asked": "What this probes — 1–2 sentences",
      "evaluation_focus": "The specific competency being scored — 1 sentence",
      "sample_answer": {
        "situation": "Full sentence. Use candidate background as context.",
        "task": "Full sentence.",
        "action": "2–3 sentences. Name the specific approach.",
        "result": "Full sentence. Quantified or clearly described outcome."
      },
      "strong_answer_upgrade": "What top-10% adds that average candidates miss. 2 sentences.",
      "mistakes": ["Specific mistake 1", "Specific mistake 2"]
    },
    { "priority": 2, "stakes": "very high", "category": "string", "question": "string", "why_asked": "string", "evaluation_focus": "string",
      "sample_answer": { "situation": "string", "task": "string", "action": "string", "result": "string" },
      "strong_answer_upgrade": "string", "mistakes": ["string", "string"] },
    { "priority": 3, "stakes": "high", "category": "string", "question": "string", "why_asked": "string", "evaluation_focus": "string",
      "sample_answer": { "situation": "string", "task": "string", "action": "string", "result": "string" },
      "strong_answer_upgrade": "string", "mistakes": ["string", "string"] },
    { "priority": 4, "stakes": "high", "category": "string", "question": "string", "why_asked": "string", "evaluation_focus": "string",
      "sample_answer": { "situation": "string", "task": "string", "action": "string", "result": "string" },
      "strong_answer_upgrade": "string", "mistakes": ["string", "string"] },
    { "priority": 5, "stakes": "high", "category": "string", "question": "string", "why_asked": "string", "evaluation_focus": "string",
      "sample_answer": { "situation": "string", "task": "string", "action": "string", "result": "string" },
      "strong_answer_upgrade": "string", "mistakes": ["string", "string"] }
  ],

  "transition_narratives": {
    "why_this_role": {
      "answer": "Full copy-ready 100–130 word answer to 'Why ${roleTitle}?'. Genuine pull toward the role, not just away from current. Authentic, not rehearsed.",
      "coaching_note": "One delivery tip."
    },
    "why_transition_from_current": {
      "answer": "Full copy-ready 80–110 word answer to 'Why are you leaving ${currTitle || "your current role"}?'. Direct and confident. Frames prior experience as an asset. No apology.",
      "coaching_note": "One delivery tip."
    }
  },

  "gap_handling": [
    {
      "gap": "Specific gap name — e.g. 'No formal Agile experience'",
      "honest_answer": "Full 60–80 word spoken answer. Honest but pivots to learning momentum. Never sounds defensive.",
      "learning_position": "One sentence: what action they can truthfully say they've taken or started.",
      "confidence_frame": "One sentence: how to reframe this gap as less of a barrier than it sounds."
    },
    { "gap": "string", "honest_answer": "string", "learning_position": "string", "confidence_frame": "string" },
    { "gap": "string", "honest_answer": "string", "learning_position": "string", "confidence_frame": "string" }
  ],

  "red_flags": [
    {
      "mistake": "Precise name of the mistake — e.g. 'Treating the transition as a confession' or 'Listing duties instead of outcomes'",
      "why_it_happens": "Why candidates with this background typically make this mistake. 1 sentence.",
      "how_to_avoid": "The specific alternative behaviour. 1–2 sentences."
    },
    { "mistake": "string", "why_it_happens": "string", "how_to_avoid": "string" },
    { "mistake": "string", "why_it_happens": "string", "how_to_avoid": "string" },
    { "mistake": "string", "why_it_happens": "string", "how_to_avoid": "string" }
  ],

  "interview_intelligence": {
    "panel_type": "Specific format: competency-based | case study + competency | technical screen + panel | etc.",
    "difficulty_label": "standard | competitive | highly competitive",
    "interview_rounds": "Typical number and structure for this role and seniority",
    "hardest_section": "Which part needs the most prep for this transition. 2 sentences.",
    "wild_card_question": "One unpredictable but plausible question specific to this role/transition",
    "what_interviewers_really_want": "The 1–2 sentence insight on unstated criteria beyond the obvious"
  },

  "final_checklist": {
    "day_before": [
      "Specific item — not 'prepare' but name exactly what to do",
      "Second item",
      "Third item",
      "Fourth item"
    ],
    "morning_of": [
      "Specific morning-of action",
      "Second item",
      "Third item"
    ],
    "in_the_room": [
      "Specific in-interview behaviour or technique for this role type",
      "Second item",
      "Third item"
    ]
  },

  "salary_line": "One confident, specific salary negotiation line. Include a realistic UK range. Natural when spoken."
}

MANDATORY RULES:
- opening_pitch.word_count: count the actual words and set this field
- readiness_score values must be realistic integers calibrated to actual background
- must_prepare_questions ordered by probability × stakes — highest-risk first
- red_flags must be specific to ${isTransition ? `the ${currTitle} → ${roleTitle} transition` : `${roleTitle} interviews`} — not generic
- final_checklist items must be concrete tasks, not mental states ("Review your 3 STAR stories" not "Feel confident")
- gap_handling gaps must reflect ACTUAL gaps for this specific transition`;

  const raw = await _callAI(system, user);
  const parsed = _parseJson(raw);

  // Post-process word count
  if (parsed.opening_pitch?.text && !parsed.opening_pitch.word_count) {
    parsed.opening_pitch.word_count = parsed.opening_pitch.text.trim().split(/\s+/).length;
  }

  return parsed;
}

// =============================================================================
// MODE: mock interview
// =============================================================================

async function _handleMock(req, res, body) {
  const {
    targetRole    = "",
    currentRole   = "",
    skills        = "",
    question      = "",
    question_id   = "",
    answer        = "",
    questionIndex = 0,
  } = body;

  if (!targetRole) return res.status(400).json({ ok: false, error: "targetRole is required" });

  const targetData  = getRoleBySlug(targetRole);
  const currentData = currentRole ? getRoleBySlug(currentRole) : null;
  const roleTitle   = targetData?.title  || _slugToTitle(targetRole);
  const currTitle   = currentData?.title || (currentRole ? _slugToTitle(currentRole) : null);
  const skillList   = _toArray(skills);

  if (!answer) {
    const q = await _mockGenQuestion({ roleTitle, currTitle, skillList, questionIndex });
    return res.status(200).json({ ok: true, mode: "question", ...q });
  }

  if (!question) return res.status(400).json({ ok: false, error: "question is required when submitting an answer" });

  const result = await _mockScoreAnswer({ roleTitle, currTitle, skillList, question, question_id, answer });
  return res.status(200).json({ ok: true, mode: "feedback", ...result });
}

async function _mockGenQuestion({ roleTitle, currTitle, skillList, questionIndex }) {
  const categories = [
    "transition motivation",
    "product thinking",
    "stakeholder management",
    "execution and delivery",
    "commercial awareness",
    "handling failure or setback",
    "career ambition",
  ];
  const category = categories[questionIndex % categories.length];

  const system = `You are a senior ${roleTitle} interviewer. Ask ONE interview question. Return ONLY valid JSON.`;
  const user   = `Candidate: ${currTitle || "experienced professional"} targeting ${roleTitle}.
Skills: ${skillList.slice(0, 8).join(", ") || "not provided"}.
Category: ${category}.

Return:
{
  "question": "Exact question as you would ask it in the interview",
  "question_id": "6-char alphanumeric ID",
  "category": "${category}",
  "recommended_duration": "2 minutes",
  "hint": "One sentence on what structure (STAR, etc.) best suits this question",
  "what_to_cover": "The 2–3 key points a strong answer must include"
}`;

  const raw = await _callAI(system, user);
  return _parseJson(raw);
}

async function _mockScoreAnswer({ roleTitle, currTitle, skillList, question, question_id, answer }) {
  const system = `You are a ${roleTitle} interviewer scoring a candidate's answer. UK spelling. Return ONLY valid JSON.`;
  const user   = `ROLE: ${roleTitle}
CANDIDATE BACKGROUND: ${currTitle || "not specified"}
SKILLS: ${skillList.slice(0, 8).join(", ") || "not provided"}

QUESTION: "${question}"
ANSWER: "${answer}"

Score and coach this answer:
{
  "score": 0,
  "score_label": "needs work | developing | good | strong | excellent",
  "score_breakdown": {
    "structure": 0,
    "content":   0,
    "relevance": 0
  },
  "overall_verdict": "One honest sentence summarising answer quality",
  "strengths_shown": [
    "Specific thing the candidate did well in this answer — 1 sentence",
    "Second strength shown"
  ],
  "improvements_needed": [
    "Specific, named improvement — 1 sentence",
    "Second improvement needed"
  ],
  "missing_element": "The single most important thing absent from this answer — 1 sentence",
  "improved_answer": "Rewritten version of the candidate's answer that scores 9–10. Keep their voice and details. Structure, deepen, and sharpen only. 150–200 words.",
  "what_to_keep": "One sentence on the strongest part of their original answer"
}

SCORING:
score_breakdown 0–10 each:
  structure = STAR or logical flow
  content = specificity, evidence, examples
  relevance = how directly it answers what was asked
overall score = weighted average (structure 30%, content 40%, relevance 30%)

Score guide: 0–3 off-topic/too brief, 4–5 on-topic but vague, 6–7 good but gaps, 8–9 strong minor polish, 10 exceptional`;

  const raw = await _callAI(system, user);
  return _parseJson(raw);
}

// =============================================================================
// Helpers
// =============================================================================

function _emptyAI() {
  return {
    interview_strategy:    null,
    opening_pitch:         null,
    readiness_score:       null,
    must_prepare_questions:[],
    transition_narratives: null,
    gap_handling:          [],
    red_flags:             [],
    interview_intelligence:null,
    final_checklist:       null,
    salary_line:           null,
  };
}

function _toArray(s) {
  return Array.isArray(s) ? s.filter(Boolean) : (s||"").split(",").map(x=>x.trim()).filter(Boolean);
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
  let t = (raw||"").trim().replace(/^```[a-zA-Z]*\n?/,"").replace(/```$/,"").trim();
  try { return JSON.parse(t); } catch {
    const m = t.match(/\{[\s\S]*\}/);
    try { return JSON.parse(m?.[0]||"{}"); } catch { return {}; }
  }
}

function _slugToTitle(s) {
  return (s||"").replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase());
}

function _legacyGet(req, res) {
  if (enforceBilling(req, res, "interview-prep")) return;
  const { target, skills, current, yearsExp } = req.query;
  if (!target||!skills) return res.status(400).json({ error: "Missing: target, skills" });
  const data = generateInterviewPrep({
    targetRole: target, skills: skills.split(",").map(s=>s.trim()).filter(Boolean),
    currentRole: current||undefined, yearsExp: yearsExp?parseInt(yearsExp):undefined,
  });
  if (!data) return res.status(404).json({ error: `Role not found: ${target}` });
  return res.status(200).json({ ok: true, data });
}
