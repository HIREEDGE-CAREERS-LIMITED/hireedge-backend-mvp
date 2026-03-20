// ============================================================================
// api/tools/linkedin-optimiser.js
// HireEdge Backend — LinkedIn Optimiser (Production v2)
//
// POST body:
//   currentRole     string   required  role slug
//   targetRole      string   optional  role slug
//   skills          string|array  optional
//   yearsExp        number   optional
//   resumeText      string   optional  CV / profile summary to base About on
//   jobDescription  string   optional
//   industry        string   optional
//
// Returns engine data + AI layer:
//   written_about  · written_experience_bullets · positioning_strategy
//   keyword_map · copy_ready_headlines
// ============================================================================

import OpenAI from "openai";
import { generateLinkedInOptimisation } from "../../lib/tools/linkedinEngine.js";
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
  if (enforceBilling(req, res, "linkedin-optimiser")) return;

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON" });
  }

  const {
    currentRole     = "",
    targetRole      = "",
    skills          = "",
    yearsExp        = null,
    resumeText      = "",
    jobDescription  = "",
    industry        = "",
  } = body;

  if (!currentRole) {
    return res.status(400).json({ ok: false, error: "currentRole is required" });
  }

  const skillList = Array.isArray(skills)
    ? skills.filter(Boolean)
    : skills.split(",").map((s) => s.trim()).filter(Boolean);

  // ── 1. Algorithmic engine ─────────────────────────────────────────────────
  const engineData = generateLinkedInOptimisation({
    currentRole,
    skills:      skillList,
    yearsExp:    yearsExp ? parseInt(yearsExp, 10) : undefined,
    targetRole:  targetRole || undefined,
    industry:    industry   || undefined,
  });

  if (!engineData) {
    return res.status(404).json({ ok: false, error: `Role not found: ${currentRole}` });
  }

  const currentData = getRoleBySlug(currentRole);
  const targetData  = targetRole ? getRoleBySlug(targetRole) : null;
  const currTitle   = currentData?.title || _slugToTitle(currentRole);
  const tgtTitle    = targetData?.title  || (targetRole ? _slugToTitle(targetRole) : null);

  // ── 2. AI layer ───────────────────────────────────────────────────────────
  let aiLayer = {};
  if (process.env.OPENAI_API_KEY) {
    try {
      aiLayer = await _aiLayer({
        currTitle, tgtTitle, skillList, yearsExp, resumeText, jobDescription,
        industry, currentData, targetData, engineData,
      });
    } catch (err) {
      console.error("[linkedin-optimiser] AI error:", err.message);
    }
  }

  return res.status(200).json({ ok: true, data: { ...engineData, ai: aiLayer } });
}

// ===========================================================================
// AI layer — writes actual content
// ===========================================================================

async function _aiLayer({ currTitle, tgtTitle, skillList, yearsExp, resumeText, jobDescription, industry, currentData, targetData, engineData }) {
  const coreSkills   = currentData?.skills_grouped?.core   || [];
  const techSkills   = currentData?.skills_grouped?.technical || [];
  const tgtCoreSkills = targetData?.skills_grouped?.core   || [];

  const ctx = [
    `CURRENT ROLE: ${currTitle}`,
    tgtTitle         ? `TARGET ROLE: ${tgtTitle}` : null,
    yearsExp         ? `YEARS EXPERIENCE: ${yearsExp}` : null,
    skillList.length ? `SKILLS: ${skillList.slice(0, 20).join(", ")}` : null,
    coreSkills.length ? `CORE COMPETENCIES FOR ${currTitle}: ${coreSkills.slice(0, 8).join(", ")}` : null,
    tgtCoreSkills.length ? `TARGET ROLE COMPETENCIES: ${tgtCoreSkills.slice(0, 8).join(", ")}` : null,
    industry         ? `INDUSTRY: ${industry}` : null,
    resumeText       ? `\nCANDIDATE BACKGROUND:\n${resumeText.slice(0, 1500)}` : null,
    jobDescription   ? `\nTARGET JD:\n${jobDescription.slice(0, 1000)}` : null,
  ].filter(Boolean).join("\n");

  const system = `You are an elite UK LinkedIn copywriter and career strategist inside the EDGEX platform.
You write actual copy-ready LinkedIn content, not guidance. UK spelling throughout.
Return ONLY valid JSON — no markdown fences, no prose outside JSON.`;

  const user = `${ctx}

Write complete, copy-ready LinkedIn content. Return this exact JSON:

{
  "written_about": "The full, ready-to-paste LinkedIn About section. 1,500–1,800 characters. No first-person pronouns except naturally at the end CTA. Hook → Expertise → Impact → Direction → CTA. Front-load keywords in the first 2 lines. Authentic, not corporate-speak. Use line breaks between paragraphs (use \\n\\n).",

  "positioning_strategy": {
    "angle": "The strongest repositioning angle for this profile. 2 sentences.",
    "how_to_balance": "How to balance current identity vs target role without sounding fake. 2 sentences.",
    "credibility_signal": "The one thing that makes this candidate credible for the target role. 1 sentence."
  },

  "copy_ready_headlines": [
    {
      "style": "authority",
      "text": "Headline text — max 220 characters",
      "why": "1 sentence rationale"
    },
    {
      "style": "impact",
      "text": "Headline text — max 220 characters",
      "why": "1 sentence rationale"
    },
    {
      "style": "seo_optimised",
      "text": "Headline text — max 220 characters",
      "why": "1 sentence rationale"
    },
    {
      "style": "aspirational",
      "text": "Headline text — max 220 characters",
      "why": "1 sentence rationale"
    }
  ],

  "written_experience_bullets": [
    "Led [specific initiative] across [scope], delivering [metric outcome]",
    "Built [what] that [result], improving [KPI] by [X%/£X]",
    "Managed [what] resulting in [business impact]",
    "Drove [what] that [measurable outcome]",
    "Delivered [what] for [audience/stakeholder], achieving [result]"
  ],

  "keyword_map": {
    "headline_keywords": ["keyword1", "keyword2", "keyword3"],
    "about_keywords":    ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
    "skills_to_add":     ["keyword1", "keyword2", "keyword3", "keyword4"],
    "missing_from_profile": ["keyword1", "keyword2", "keyword3"]
  }
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

function _legacyGet(req, res) {
  if (enforceBilling(req, res, "linkedin-optimiser")) return;
  const { role, skills, yearsExp, target, industry } = req.query;
  if (!role || !skills) return res.status(400).json({ error: "Missing: role, skills" });
  const skillList = skills.split(",").map((s) => s.trim()).filter(Boolean);
  const data = generateLinkedInOptimisation({
    currentRole: role,
    skills:      skillList,
    yearsExp:    yearsExp ? parseInt(yearsExp, 10) : undefined,
    targetRole:  target   || undefined,
    industry:    industry || undefined,
  });
  if (!data) return res.status(404).json({ error: `Role not found: ${role}` });
  return res.status(200).json({ ok: true, data });
}
