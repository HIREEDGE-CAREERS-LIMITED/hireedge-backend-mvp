// ============================================================================
// api/tools/linkedin-optimiser.js
// HireEdge Backend — LinkedIn Optimiser (Production v3)
//
// Upgrades over v2:
//   - headlines: { recommended, alternatives[] } — no raw style labels
//   - about_section: { text, char_count, hashtags } — real \n newlines
//   - experience_rewrites: per-role bullet arrays — never hallucinated metrics
//   - skills: { core, supporting, missing } — grouped for the target role
//   - positioning_strategy stays (angle, bridge_message, credibility_signal)
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
    currentRole    = "",
    targetRole     = "",
    skills         = "",
    yearsExp       = null,
    resumeText     = "",
    jobDescription = "",
    industry       = "",
  } = body;

  if (!currentRole) {
    return res.status(400).json({ ok: false, error: "currentRole is required" });
  }

  const skillList = Array.isArray(skills)
    ? skills.filter(Boolean)
    : skills.split(",").map((s) => s.trim()).filter(Boolean);

  // ── 1. Algorithmic engine (keyword strategy, skills gap, profile score) ────
  const engineData = generateLinkedInOptimisation({
    currentRole,
    skills:     skillList,
    yearsExp:   yearsExp ? parseInt(yearsExp, 10) : undefined,
    targetRole: targetRole || undefined,
    industry:   industry   || undefined,
  });

  if (!engineData) {
    return res.status(404).json({ ok: false, error: `Role not found: ${currentRole}` });
  }

  const currentData = getRoleBySlug(currentRole);
  const targetData  = targetRole ? getRoleBySlug(targetRole) : null;
  const currTitle   = currentData?.title || _slugToTitle(currentRole);
  const tgtTitle    = targetData?.title  || (targetRole ? _slugToTitle(targetRole) : null);

  // ── 2. AI content layer ───────────────────────────────────────────────────
  let ai = _emptyAI();
  if (process.env.OPENAI_API_KEY) {
    try {
      ai = await _aiLayer({
        currTitle, tgtTitle, skillList, yearsExp,
        resumeText, jobDescription, industry,
        currentData, targetData, engineData,
      });
    } catch (err) {
      console.error("[linkedin-optimiser] AI error:", err.message);
    }
  }

  return res.status(200).json({
    ok: true,
    data: {
      // Engine fields (scores, keyword strategy)
      current_role:     engineData.current_role,
      target_role:      engineData.target_role,
      strength_score:   engineData.strength_score,
      keyword_strategy: engineData.keyword_strategy,
      skills_strategy:  engineData.skills_strategy,
      // AI-generated content
      ai,
    },
  });
}

// ===========================================================================
// AI layer — full content generation
// ===========================================================================

async function _aiLayer({ currTitle, tgtTitle, skillList, yearsExp, resumeText, jobDescription, industry, currentData, targetData, engineData }) {
  const coreSkills    = currentData?.skills_grouped?.core        || [];
  const techSkills    = currentData?.skills_grouped?.technical   || [];
  const tgtCore       = targetData?.skills_grouped?.core         || [];
  const tgtTech       = targetData?.skills_grouped?.technical    || [];
  const missingSkills = engineData?.keyword_strategy?.aspirational || [];

  // Build context block
  const ctx = [
    `CURRENT ROLE: ${currTitle}`,
    tgtTitle          ? `TARGET ROLE: ${tgtTitle}` : null,
    yearsExp          ? `YEARS OF EXPERIENCE: ${yearsExp}` : null,
    skillList.length  ? `USER'S SKILLS: ${skillList.slice(0, 20).join(", ")}` : null,
    coreSkills.length ? `CORE COMPETENCIES (${currTitle}): ${coreSkills.slice(0, 8).join(", ")}` : null,
    tgtCore.length    ? `TARGET ROLE CORE SKILLS (${tgtTitle}): ${tgtCore.slice(0, 8).join(", ")}` : null,
    tgtTech.length    ? `TARGET ROLE TECHNICAL SKILLS: ${tgtTech.slice(0, 6).join(", ")}` : null,
    industry          ? `INDUSTRY: ${industry}` : null,
    resumeText        ? `\nCANDIDATE CV / BACKGROUND:\n${resumeText.slice(0, 2000)}` : null,
    jobDescription    ? `\nTARGET JOB DESCRIPTION:\n${jobDescription.slice(0, 1000)}` : null,
  ].filter(Boolean).join("\n");

  const system = `You are an elite UK LinkedIn copywriter and career strategist.
You write actual copy-ready content — not templates, not guidance, not examples.
Every word must be directly usable by the candidate.

RULES:
- UK spelling throughout (organise, optimise, recognise, programme)
- No first-person pronouns in About section (no "I", "my", "me")
- No buzzwords without substance (no "passionate", "results-driven", "synergy")
- Experience bullets: use realistic, conservative phrasing. If metrics are unknown, 
  write "driving measurable improvement" rather than inventing specific numbers.
  Only use specific numbers (%, £, counts) if they appear in the candidate's CV text.
- Headlines: under 220 characters. Count carefully.
- About section: 1,500–1,900 characters. Count carefully.
- Return ONLY valid JSON. No markdown, no backticks, no explanation.`;

  const user = `${ctx}

Generate complete, copy-ready LinkedIn profile content. Return this exact JSON structure:

{
  "headlines": {
    "recommended": {
      "text": "The single best headline for this person — max 220 chars, keyword-rich, specific to their background",
      "char_count": 0,
      "why": "One sentence explaining why this is the strongest option"
    },
    "alternatives": [
      {
        "text": "Alternative headline option 1 — different angle",
        "char_count": 0,
        "label": "Short descriptive label e.g. 'SEO-focused' or 'Transition-signalling' or 'Seniority-led'",
        "why": "One sentence rationale"
      },
      {
        "text": "Alternative headline option 2",
        "char_count": 0,
        "label": "Short label",
        "why": "One sentence rationale"
      },
      {
        "text": "Alternative headline option 3",
        "char_count": 0,
        "label": "Short label",
        "why": "One sentence rationale"
      }
    ]
  },

  "about_section": {
    "text": "Complete About section. 1,500–1,900 characters. Structure: Strong hook (1–2 lines that grab attention) → Core expertise paragraph → Impact/achievement paragraph → Career direction sentence → CTA. Use real paragraph breaks with actual newline characters. No bullet points. No pronouns. Specific, authentic, not corporate.",
    "char_count": 0,
    "hashtags": ["#RelevantHashtag1", "#RelevantHashtag2", "#RelevantHashtag3"]
  },

  "experience_rewrites": [
    {
      "role_title": "Extract each distinct role from the CV — if no CV provided, use current role title",
      "company": "Company name if mentioned in CV, otherwise empty string",
      "bullets": [
        "Strong action verb + specific responsibility + realistic outcome (no invented numbers unless in CV)",
        "Led cross-functional initiative that improved process efficiency and stakeholder alignment",
        "Built and maintained relationships with key accounts, contributing to revenue retention",
        "Collaborated with senior leadership to develop strategy that shaped team direction",
        "Delivered [specific project type] on time and within scope, earning positive stakeholder feedback"
      ]
    }
  ],

  "skills": {
    "core": ["Top 6–8 skills essential for the target role — prioritise these"],
    "supporting": ["6–8 complementary skills that strengthen the profile"],
    "missing": ["5–6 skills the candidate likely lacks for the target role — most important gaps first"]
  },

  "positioning_strategy": {
    "angle": "The strongest narrative angle for this specific transition. 2 sentences.",
    "bridge_message": "How to frame the move from current to target role in a credible, authentic way. 2 sentences.",
    "credibility_signal": "The single most compelling thing about this candidate's background for the target role. 1 sentence."
  }
}

IMPORTANT: 
- Calculate actual char_count values for headlines and about_section
- Experience bullets must be realistic — do NOT invent company names, revenue figures, team sizes, or percentages unless they appear in the CV text provided
- If no CV is provided, write 1 role block for the current role with 4 strong, realistic bullets
- skills.missing should reflect what the target role requires that the candidate hasn't demonstrated`;

  const raw = await _callAI(system, user);
  const parsed = _parseJson(raw);

  // Post-process: calculate char counts if AI didn't
  if (parsed.headlines?.recommended?.text && !parsed.headlines.recommended.char_count) {
    parsed.headlines.recommended.char_count = parsed.headlines.recommended.text.length;
  }
  if (parsed.headlines?.alternatives) {
    parsed.headlines.alternatives = parsed.headlines.alternatives.map((h) => ({
      ...h,
      char_count: h.char_count || h.text?.length || 0,
    }));
  }
  if (parsed.about_section?.text && !parsed.about_section.char_count) {
    parsed.about_section.char_count = parsed.about_section.text.length;
  }

  return parsed;
}

// ===========================================================================
// Helpers
// ===========================================================================

function _emptyAI() {
  return {
    headlines: null,
    about_section: null,
    experience_rewrites: [],
    skills: null,
    positioning_strategy: null,
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
