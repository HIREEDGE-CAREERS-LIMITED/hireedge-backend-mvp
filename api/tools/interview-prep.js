// ============================================================================
// api/tools/interview-prep.js
// HireEdge Backend — Interview Preparation (Production v3)
//
// TWO MODES via query param ?mode=
//
// ── MODE: prepare (default) ───────────────────────────────────────────────────
// POST /api/tools/interview-prep
// Body: { targetRole, currentRole, skills, yearsExp, jobDescription, resumeText }
//
// Returns:
//   ai.readiness_score        — overall + 5-axis breakdown + hire_risk
//   ai.must_prepare_questions — top 5–7 questions with FULL STAR answers
//   ai.transition_narratives  — tell_me_about_yourself / why_pm / why_transition
//   ai.gap_handling           — per-gap copy-ready answer templates
//   ai.interview_intelligence — format, difficulty, wild card
//   ai.salary_line
//   (engine data pass-through)
//
// ── MODE: mock ────────────────────────────────────────────────────────────────
// Step 1 — POST /api/tools/interview-prep?mode=mock
// Body: { targetRole, currentRole, skills, questionIndex? }
// Returns: { question, question_id }
//
// Step 2 — POST /api/tools/interview-prep?mode=mock
// Body: { targetRole, currentRole, question, question_id, answer }
// Returns: { score, score_label, feedback, improved_answer, what_to_keep }
// ============================================================================

import OpenAI from "openai";
import { generateInterviewPrep } from "../../lib/tools/interviewEngine.js";
import { getRoleBySlug }         from "../../lib/dataset/roleIndex.js";
import { enforceBilling }        from "../../lib/billing/billingMiddleware.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────

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
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON" });
  }

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

  if (!targetRole) {
    return res.status(400).json({ ok: false, error: "targetRole is required" });
  }

  const skillList   = _toArray(skills);
  const engineData  = generateInterviewPrep({
    targetRole,
    skills:      skillList,
    currentRole: currentRole || undefined,
    yearsExp:    yearsExp ? parseInt(yearsExp, 10) : undefined,
  });

  if (!engineData) {
    return res.status(404).json({ ok: false, error: `Role not found: ${targetRole}` });
  }

  const targetData  = getRoleBySlug(targetRole);
  const currentData = currentRole ? getRoleBySlug(currentRole) : null;
  const roleTitle   = targetRoleTitle || targetData?.title || _slugToTitle(targetRole);
  const currTitle   = currentData?.title || (currentRole ? _slugToTitle(currentRole) : null);
  const tgtCore     = targetData?.skills_grouped?.core       || [];
  const tgtTech     = targetData?.skills_grouped?.technical  || [];
  const currCore    = currentData?.skills_grouped?.core      || [];

  let ai = _emptyAI();
  if (process.env.OPENAI_API_KEY) {
    try {
      ai = await _prepareLayer({
        roleTitle, currTitle, skillList, yearsExp,
        jobDescription, resumeText, engineData,
        tgtCore, tgtTech, currCore,
      });
    } catch (err) {
      console.error("[interview-prep] AI error:", err.message);
    }
  }

  return res.status(200).json({
    ok:   true,
    data: {
      target_role:            engineData.target_role,
      current_role:           engineData.current_role,
      competency_questions:   engineData.competency_questions   || [],
      technical_questions:    engineData.technical_questions    || [],
      behavioural_questions:  engineData.behavioural_questions  || [],
      star_preparation:       engineData.star_preparation       || null,
      questions_to_ask:       engineData.questions_to_ask       || [],
      salary_negotiation:     engineData.salary_negotiation     || null,
      weakness_strategy:      engineData.weakness_strategy      || [],
      ai,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AI layer — prepare mode
// ─────────────────────────────────────────────────────────────────────────────

async function _prepareLayer({ roleTitle, currTitle, skillList, yearsExp, jobDescription, resumeText, engineData, tgtCore, tgtTech, currCore }) {
  const ctx = [
    `TARGET ROLE: ${roleTitle}`,
    currTitle         ? `CURRENT / FROM ROLE: ${currTitle}` : null,
    yearsExp          ? `YEARS OF EXPERIENCE: ${yearsExp}` : null,
    skillList.length  ? `CANDIDATE SKILLS: ${skillList.slice(0, 20).join(", ")}` : null,
    currCore.length   ? `CURRENT ROLE CORE SKILLS: ${currCore.slice(0, 8).join(", ")}` : null,
    tgtCore.length    ? `TARGET ROLE CORE SKILLS: ${tgtCore.slice(0, 8).join(", ")}` : null,
    tgtTech.length    ? `TARGET ROLE TECHNICAL SKILLS: ${tgtTech.slice(0, 6).join(", ")}` : null,
    engineData.readiness?.score ? `ENGINE READINESS: ${engineData.readiness.score}/100` : null,
    jobDescription    ? `\nJOB DESCRIPTION:\n${jobDescription.slice(0, 1500)}` : null,
    resumeText        ? `\nCANDIDATE CV:\n${resumeText.slice(0, 1800)}` : null,
  ].filter(Boolean).join("\n");

  const isTransition = !!(currTitle && currTitle !== roleTitle);

  const system = `You are an elite UK interview coach with 15 years experience placing candidates at top-tier companies.
You write complete, copy-ready answers — not guidance, not bullet fragments, not templates.
Every answer must feel personal and specific to this candidate's background.

RULES:
- UK spelling throughout (organise, specialise, recognise)
- STAR answers must feel like real human speech — not bullet points stitched together
- "Tell me about yourself" must be under 90 seconds when spoken aloud (~180–220 words)
- Transition narrative answers must acknowledge the career change confidently, not apologetically
- Sample answers must use the candidate's background as context — not generic examples
- strong_answer_upgrade must show what separates a top 10% answer from an average one
- Gap handling must never sound defensive — reframe gaps as learning momentum
- Return ONLY valid JSON. No markdown, no backticks, no text outside JSON.`;

  const user = `${ctx}

Generate a complete, premium interview preparation pack. Return this exact JSON:

{
  "readiness_score": {
    "overall": 0,
    "breakdown": {
      "product_thinking": 0,
      "stakeholder_management": 0,
      "technical_knowledge": 0,
      "execution_experience": 0,
      "communication": 0
    },
    "strengths": [
      "Specific strength 1 — reference the candidate's actual background",
      "Specific strength 2",
      "Specific strength 3"
    ],
    "critical_gaps": [
      "Specific gap 1 — what's missing for ${roleTitle}",
      "Specific gap 2",
      "Specific gap 3"
    ],
    "hiring_risk": "low | medium | medium-high | high"
  },

  "must_prepare_questions": [
    {
      "priority": 1,
      "category": "transition | behavioural | product | stakeholder | technical | motivation",
      "question": "Exact interview question as the interviewer would ask it",
      "why_asked": "What this question is really probing — 1–2 sentences",
      "evaluation_focus": "The specific competency or signal the interviewer is scoring — 1 sentence",
      "sample_answer": {
        "situation": "Full sentence — the specific context. Reference their background.",
        "task": "Full sentence — what they needed to accomplish",
        "action": "2–3 sentences — the specific steps taken. Name the approach.",
        "result": "Full sentence — quantified or clearly described outcome"
      },
      "strong_answer_upgrade": "What a top-10% candidate adds to this answer that average candidates miss. 2 sentences.",
      "mistakes": [
        "Common mistake 1 — specific to this question and transition",
        "Common mistake 2"
      ]
    },
    {
      "priority": 2,
      "category": "string",
      "question": "string",
      "why_asked": "string",
      "evaluation_focus": "string",
      "sample_answer": { "situation": "string", "task": "string", "action": "string", "result": "string" },
      "strong_answer_upgrade": "string",
      "mistakes": ["string", "string"]
    },
    {
      "priority": 3,
      "category": "string",
      "question": "string",
      "why_asked": "string",
      "evaluation_focus": "string",
      "sample_answer": { "situation": "string", "task": "string", "action": "string", "result": "string" },
      "strong_answer_upgrade": "string",
      "mistakes": ["string", "string"]
    },
    {
      "priority": 4,
      "category": "string",
      "question": "string",
      "why_asked": "string",
      "evaluation_focus": "string",
      "sample_answer": { "situation": "string", "task": "string", "action": "string", "result": "string" },
      "strong_answer_upgrade": "string",
      "mistakes": ["string", "string"]
    },
    {
      "priority": 5,
      "category": "string",
      "question": "string",
      "why_asked": "string",
      "evaluation_focus": "string",
      "sample_answer": { "situation": "string", "task": "string", "action": "string", "result": "string" },
      "strong_answer_upgrade": "string",
      "mistakes": ["string", "string"]
    }
  ],

  "transition_narratives": {
    "tell_me_about_yourself": {
      "answer": "Full copy-ready 180–220 word spoken answer. Natural, confident, story-driven. Ends with a forward-looking sentence about why ${roleTitle} is the right next move. First person is fine here.",
      "coaching_note": "One sentence on the most important delivery tip for this specific answer."
    },
    "why_product_manager": {
      "answer": "Full copy-ready answer — 100–140 words. Explains the genuine pull toward product, not just push away from current role. Must feel authentic, not rehearsed.",
      "coaching_note": "One delivery tip."
    },
    "why_transition_from_current": {
      "answer": "Full copy-ready answer — 80–120 words. Addresses the career change directly without being defensive. Frames prior experience as an asset. Ends confidently.",
      "coaching_note": "One delivery tip."
    }
  },

  "gap_handling": [
    {
      "gap": "Name of the specific skill or experience gap — e.g. 'Agile / sprint ceremonies'",
      "honest_answer": "Full copy-ready spoken answer — 60–80 words. Honest about the gap but immediately pivots to learning. Never sounds apologetic. Natural and confident.",
      "learning_position": "One sentence: what specific action the candidate can truthfully say they've taken or started",
      "confidence_frame": "One sentence: how to reframe this gap as actually being less of a barrier than it sounds"
    },
    {
      "gap": "Second gap",
      "honest_answer": "string",
      "learning_position": "string",
      "confidence_frame": "string"
    },
    {
      "gap": "Third gap",
      "honest_answer": "string",
      "learning_position": "string",
      "confidence_frame": "string"
    }
  ],

  "interview_intelligence": {
    "panel_type": "Specific format: competency-based | case study + competency | technical screen + panel | etc.",
    "difficulty_label": "standard | competitive | highly competitive",
    "interview_rounds": "Typical number and structure for this seniority and role type",
    "hardest_section": "Which part requires the most preparation for this specific transition. 2 sentences.",
    "wild_card_question": "One genuinely unpredictable but plausible question specific to this exact role/transition that most candidates won't have prepared",
    "what_interviewers_really_want": "The 1–2 sentence insight about what this type of interviewer is actually looking for beyond the obvious"
  },

  "salary_line": "One confident, specific salary negotiation line for this role and transition. Include a realistic UK range. Sounds natural when spoken."
}

CRITICAL: 
- readiness_score values must be realistic integers 0–100 based on the candidate's actual background
- must_prepare_questions must be ordered by probability of being asked + impact if answered poorly
- All STAR sample answers must use the candidate's background as the narrative context — not generic software engineers or retail workers
- gap_handling gaps must be the ACTUAL gaps for this specific transition (e.g. ${isTransition ? `moving from ${currTitle} to ${roleTitle}` : roleTitle + " preparation"})
- transition_narratives answers must feel like a real person speaking, not a document`;

  const raw  = await _callAI(system, user);
  return _parseJson(raw);
}

// =============================================================================
// MODE: mock interview
// =============================================================================

async function _handleMock(req, res, body) {
  const {
    targetRole   = "",
    currentRole  = "",
    skills       = "",
    question     = "",
    question_id  = "",
    answer       = "",
    questionIndex = 0,
  } = body;

  if (!targetRole) {
    return res.status(400).json({ ok: false, error: "targetRole is required" });
  }

  const targetData  = getRoleBySlug(targetRole);
  const currentData = currentRole ? getRoleBySlug(currentRole) : null;
  const roleTitle   = targetData?.title  || _slugToTitle(targetRole);
  const currTitle   = currentData?.title || (currentRole ? _slugToTitle(currentRole) : null);
  const skillList   = _toArray(skills);

  // Step 1: no answer yet — generate a question to ask
  if (!answer) {
    const q = await _mockGenerateQuestion({ roleTitle, currTitle, skillList, questionIndex });
    return res.status(200).json({
      ok:          true,
      mode:        "question",
      question:    q.question,
      question_id: q.question_id,
      category:    q.category,
      hint:        q.hint,
    });
  }

  // Step 2: answer provided — score and give feedback
  if (!question) {
    return res.status(400).json({ ok: false, error: "question is required when submitting an answer" });
  }

  const result = await _mockScoreAnswer({ roleTitle, currTitle, skillList, question, question_id, answer });
  return res.status(200).json({ ok: true, mode: "feedback", ...result });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock: generate question
// ─────────────────────────────────────────────────────────────────────────────

async function _mockGenerateQuestion({ roleTitle, currTitle, skillList, questionIndex }) {
  const system = `You are an interviewer conducting a real ${roleTitle} job interview. Ask ONE question.
Return ONLY valid JSON. No markdown.`;

  const categories = [
    "transition motivation",
    "product thinking",
    "stakeholder management",
    "execution and delivery",
    "commercial awareness",
    "handling failure",
    "career ambition",
  ];
  const category = categories[questionIndex % categories.length];

  const user = `Candidate background: ${currTitle || "experienced professional"} targeting ${roleTitle}.
Skills mentioned: ${skillList.slice(0, 8).join(", ") || "not provided"}.

Ask a ${category} interview question that is specific to this transition and seniority level.

Return:
{
  "question": "The exact question as you would ask it in the interview",
  "question_id": "A 6-character alphanumeric ID",
  "category": "${category}",
  "hint": "One short sentence on what framework (STAR, etc.) best suits this question"
}`;

  const raw = await _callAI(system, user);
  return _parseJson(raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock: score answer
// ─────────────────────────────────────────────────────────────────────────────

async function _mockScoreAnswer({ roleTitle, currTitle, skillList, question, question_id, answer }) {
  const system = `You are an expert ${roleTitle} interviewer scoring a candidate's answer.
Be honest, constructive, and specific. UK spelling.
Return ONLY valid JSON. No markdown.`;

  const user = `ROLE BEING INTERVIEWED FOR: ${roleTitle}
CANDIDATE BACKGROUND: ${currTitle || "not specified"}
SKILLS: ${skillList.slice(0, 8).join(", ") || "not provided"}

QUESTION ASKED: "${question}"

CANDIDATE'S ANSWER: "${answer}"

Score this answer and provide coaching. Return:
{
  "score": 0,
  "score_label": "One of: needs work | developing | good | strong | excellent",
  "overall_verdict": "One sentence honest summary of the answer quality",
  "feedback": {
    "what_worked": "Specific things the candidate did well in this answer — 2–3 sentences",
    "what_to_improve": "Specific, actionable things to improve — 2–3 sentences. Name the exact gap.",
    "missing_element": "The single most important thing that was absent from this answer — 1 sentence"
  },
  "improved_answer": "A rewritten version of the candidate's answer that scores 9–10. Keep the candidate's own details and voice — don't invent new background. Just structure, deepen, and sharpen what they gave. 150–200 words.",
  "what_to_keep": "One sentence identifying the strongest part of their original answer to keep and build on"
}

SCORING GUIDE:
0–3: Unstructured, off-topic, or too brief to evaluate
4–5: On-topic but lacks specificity, STAR structure, or quantified outcome
6–7: Good structure and relevant content, minor gaps
8–9: Specific, well-structured, strong outcome — minor polish needed
10: Exceptional — ready to hire`;

  const raw = await _callAI(system, user);
  return _parseJson(raw);
}

// =============================================================================
// Helpers
// =============================================================================

function _emptyAI() {
  return {
    readiness_score:         null,
    must_prepare_questions:  [],
    transition_narratives:   null,
    gap_handling:            [],
    interview_intelligence:  null,
    salary_line:             null,
  };
}

function _toArray(skills) {
  return Array.isArray(skills)
    ? skills.filter(Boolean)
    : (skills || "").split(",").map((s) => s.trim()).filter(Boolean);
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

function _legacyGet(req, res) {
  if (enforceBilling(req, res, "interview-prep")) return;
  const { target, skills, current, yearsExp } = req.query;
  if (!target || !skills) return res.status(400).json({ error: "Missing: target, skills" });
  const skillList = skills.split(",").map((s) => s.trim()).filter(Boolean);
  const data = generateInterviewPrep({
    targetRole:  target,
    skills:      skillList,
    currentRole: current  || undefined,
    yearsExp:    yearsExp ? parseInt(yearsExp, 10) : undefined,
  });
  if (!data) return res.status(404).json({ error: `Role not found: ${target}` });
  return res.status(200).json({ ok: true, data });
}
