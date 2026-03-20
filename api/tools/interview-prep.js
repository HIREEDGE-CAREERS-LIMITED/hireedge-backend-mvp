// ============================================================================
// api/tools/interview-prep.js
// HireEdge Backend — Interview Preparation (Production v2)
//
// POST body:
//   targetRole      string   required  role slug
//   targetRoleTitle string   optional  display override
//   currentRole     string   optional  role slug
//   skills          string|array  optional
//   yearsExp        number   optional
//   jobDescription  string   optional
//   resumeText      string   optional
//
// Returns engine data + AI layer:
//   opening_pitch · transition_narrative · answer_talking_points
//   difficulty_assessment · salary_line
// ============================================================================

import OpenAI from "openai";
import { generateInterviewPrep } from "../../lib/tools/interviewEngine.js";
import { getRoleBySlug } from "../../lib/dataset/roleIndex.js";
import { enforceBilling } from "../../lib/billing/billingMiddleware.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET")     return _legacyGet(req, res);
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed" });
  if (enforceBilling(req, res, "interview-prep")) return;

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON" });
  }

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

  const skillList = Array.isArray(skills)
    ? skills.filter(Boolean)
    : skills.split(",").map((s) => s.trim()).filter(Boolean);

  // ── 1. Run algorithmic engine ─────────────────────────────────────────────
  const engineData = generateInterviewPrep({
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

  // ── 2. AI layer ───────────────────────────────────────────────────────────
  let aiLayer = {};
  if (process.env.OPENAI_API_KEY) {
    try {
      aiLayer = await _aiLayer({ roleTitle, currTitle, skillList, yearsExp, jobDescription, resumeText, engineData });
    } catch (err) {
      console.error("[interview-prep] AI error:", err.message);
    }
  }

  return res.status(200).json({ ok: true, data: { ...engineData, ai: aiLayer } });
}

// ===========================================================================
// AI layer
// ===========================================================================

async function _aiLayer({ roleTitle, currTitle, skillList, yearsExp, jobDescription, resumeText, engineData }) {
  const ctx = [
    `TARGET ROLE: ${roleTitle}`,
    currTitle        ? `CURRENT ROLE: ${currTitle}` : null,
    yearsExp         ? `YEARS EXPERIENCE: ${yearsExp}` : null,
    skillList.length ? `KEY SKILLS: ${skillList.slice(0, 15).join(", ")}` : null,
    engineData.readiness ? `READINESS: ${engineData.readiness.score}/100` : null,
    jobDescription   ? `\nJOB DESCRIPTION:\n${jobDescription.slice(0, 1500)}` : null,
    resumeText       ? `\nCANDIDATE PROFILE:\n${resumeText.slice(0, 1200)}` : null,
  ].filter(Boolean).join("\n");

  const system = `You are a senior UK interview coach inside the EDGEX career intelligence platform.
Write concrete, role-specific interview preparation content. UK spelling throughout.
Return ONLY valid JSON — no markdown fences, no prose outside the JSON.`;

  const user = `${ctx}

Return this exact JSON structure:

{
  "opening_pitch": "A confident 30-second 'tell me about yourself' for this candidate. No first-person pronouns. Specific to role and background. 4–5 sentences.",
  "transition_narrative": {
    "story": "3–4 sentences narrating the career journey from ${currTitle || "current role"} to ${roleTitle}. Compelling and intentional.",
    "transferable_angle": "The single strongest transferable argument for this move. One sentence.",
    "how_to_handle_gaps": "Concrete advice for gaps without being defensive. 2 sentences."
  },
  "answer_talking_points": [
    {
      "category": "behavioural",
      "question_theme": "Delivery under pressure / project ownership",
      "key_points": ["3–5 word talking point", "3–5 word talking point", "3–5 word talking point"],
      "what_they_really_want": "What the interviewer is actually testing. 1 sentence.",
      "common_mistake": "The #1 mistake candidates make on this type of question. 1 sentence."
    },
    {
      "category": "technical",
      "question_theme": "Core technical competency for ${roleTitle}",
      "key_points": ["talking point", "talking point", "talking point"],
      "what_they_really_want": "1 sentence.",
      "common_mistake": "1 sentence."
    },
    {
      "category": "motivation",
      "question_theme": "Why this role / why now",
      "key_points": ["talking point", "talking point", "talking point"],
      "what_they_really_want": "1 sentence.",
      "common_mistake": "1 sentence."
    },
    {
      "category": "weakness",
      "question_theme": "Handling gaps or weaknesses",
      "key_points": ["talking point", "talking point", "talking point"],
      "what_they_really_want": "1 sentence.",
      "common_mistake": "1 sentence."
    }
  ],
  "difficulty_assessment": {
    "panel_type": "Expected interview format: technical, competency-based, mixed, case study, or panel",
    "difficulty_label": "One of: standard / competitive / highly competitive",
    "hardest_section": "Which part they should spend the most preparation time on. 1–2 sentences.",
    "wild_card_question": "One unpredictable but plausible question specific to this role/transition.",
    "interview_rounds": "Typical number and format of rounds for this seniority level."
  },
  "salary_line": "One confident salary negotiation line specific to this transition and UK market. Include a specific range."
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

function _slugToTitle(s) {
  return (s || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Legacy GET — preserves backward compat
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
