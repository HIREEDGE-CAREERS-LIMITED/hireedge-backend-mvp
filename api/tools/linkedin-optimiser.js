// ============================================================================
// api/tools/linkedin-optimiser.js
// HireEdge Backend — LinkedIn Profile Audit (Production v4)
//
// v4 additions over v3:
//   profile_audit      — overall_score, breakdown (5 axes), biggest_issues (3)
//   headlines          — when_to_use field on recommended + alternatives
//   about_section      — structured_breakdown { hook, value_prop, transition, cta }
//   keywords           — high_demand + missing_critical with why_it_matters/impact
//   before_after       — headline / about_opening / experience_bullet comparison
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

  // ── 1. Engine layer ───────────────────────────────────────────────────────
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

  // ── 2. AI layer ───────────────────────────────────────────────────────────
  let ai = _emptyAI();
  if (process.env.OPENAI_API_KEY) {
    try {
      ai = await _aiLayer({ currTitle, tgtTitle, skillList, yearsExp, resumeText, jobDescription, industry, currentData, targetData, engineData });
    } catch (err) {
      console.error("[linkedin-optimiser] AI error:", err.message);
    }
  }

  return res.status(200).json({
    ok:   true,
    data: {
      current_role:     engineData.current_role,
      target_role:      engineData.target_role,
      strength_score:   engineData.strength_score,
      keyword_strategy: engineData.keyword_strategy,
      skills_strategy:  engineData.skills_strategy,
      ai,
    },
  });
}

// =============================================================================
// AI layer
// =============================================================================

async function _aiLayer({ currTitle, tgtTitle, skillList, yearsExp, resumeText, jobDescription, industry, currentData, targetData, engineData }) {
  const coreSkills  = currentData?.skills_grouped?.core      || [];
  const tgtCore     = targetData?.skills_grouped?.core       || [];
  const tgtTech     = targetData?.skills_grouped?.technical  || [];
  const isTransition = !!(tgtTitle && tgtTitle !== currTitle);

  const ctx = [
    `CURRENT ROLE: ${currTitle}`,
    tgtTitle         ? `TARGET ROLE: ${tgtTitle}` : null,
    isTransition     ? `TRANSITION TYPE: Career change from ${currTitle} to ${tgtTitle}` : null,
    yearsExp         ? `YEARS OF EXPERIENCE: ${yearsExp}` : null,
    skillList.length ? `CANDIDATE SKILLS: ${skillList.slice(0, 20).join(", ")}` : null,
    coreSkills.length? `CURRENT ROLE CORE SKILLS: ${coreSkills.slice(0, 8).join(", ")}` : null,
    tgtCore.length   ? `TARGET ROLE CORE SKILLS: ${tgtCore.slice(0, 8).join(", ")}` : null,
    tgtTech.length   ? `TARGET ROLE TECHNICAL SKILLS: ${tgtTech.slice(0, 6).join(", ")}` : null,
    industry         ? `INDUSTRY: ${industry}` : null,
    resumeText       ? `\nCANDIDATE CV:\n${resumeText.slice(0, 2000)}` : null,
    jobDescription   ? `\nTARGET JOB DESCRIPTION:\n${jobDescription.slice(0, 1000)}` : null,
  ].filter(Boolean).join("\n");

  const system = `You are an elite UK LinkedIn copywriter and career strategist producing a premium profile audit report.
You write concrete, copy-ready content — never generic guidance, never templates with bracketed placeholders.

RULES:
- UK spelling: organise, optimise, specialise, recognise, programme
- About section: no first-person pronouns (no I / my / me)
- No buzzwords without substance: no "passionate", "results-driven", "dynamic", "synergy"
- Metrics: only use numbers that appear in the candidate's CV. If none, use realistic conservative language.
- Headlines: hard max 220 characters. Count every character.
- About section: 1,500–1,900 characters total. Count carefully.
- Profile audit scores must be calibrated to the actual strength of information provided
- biggest_issues must reference this candidate's specific role and transition — not generic LinkedIn advice
- before_after "before" examples must look like real typical weak profiles, not straw men
- Return ONLY valid JSON. No markdown, no backticks, no prose outside JSON.`;

  const user = `${ctx}

Generate a complete LinkedIn profile audit and rewrite. Return this exact JSON:

{
  "profile_audit": {
    "overall_score": 0,
    "grade": "One of: Needs Work | Developing | Good | Strong | Excellent",
    "breakdown": {
      "headline":       { "score": 0, "note": "1 sentence on what's strong or weak about their likely current headline" },
      "about_section":  { "score": 0, "note": "1 sentence diagnosis" },
      "keywords":       { "score": 0, "note": "1 sentence on keyword density and search visibility" },
      "positioning":    { "score": 0, "note": "1 sentence on how clearly their career direction comes across" },
      "completeness":   { "score": 0, "note": "1 sentence on profile completeness for this role type" }
    },
    "biggest_issues": [
      {
        "issue": "Precise, specific name of the problem — e.g. 'Headline reads as a job title, not a value proposition'",
        "why_it_hurts": "Why this specific issue costs them opportunities. Reference their role type. 1–2 sentences.",
        "fix": "The exact change to make. Specific and actionable. 1 sentence."
      },
      {
        "issue": "Second issue — specific to this candidate's situation",
        "why_it_hurts": "string",
        "fix": "string"
      },
      {
        "issue": "Third issue",
        "why_it_hurts": "string",
        "fix": "string"
      }
    ]
  },

  "before_after": {
    "headline": {
      "before": "A realistic example of the weak headline they probably have now — job title heavy, no value prop",
      "after": "The upgraded recommended headline — keyword-rich, value-driven"
    },
    "about_opening": {
      "before": "A realistic weak About opening they probably have — generic, duty-list, no hook",
      "after": "The strong hook opening from the written About section — first 2 sentences only"
    },
    "experience_bullet": {
      "before": "A weak experience bullet they might have — passive, duty-focused, no outcome",
      "after": "An upgraded version — action verb, specific responsibility, realistic outcome"
    }
  },

  "headlines": {
    "recommended": {
      "text": "Best headline — max 220 chars, keyword-rich, specific to this background and target",
      "char_count": 0,
      "why": "Why this is the strongest option for this specific person. 1 sentence.",
      "when_to_use": "The specific situation or application context where this headline performs best. 1 sentence."
    },
    "alternatives": [
      {
        "text": "Alternative headline — different angle",
        "char_count": 0,
        "label": "Short descriptive label e.g. 'SEO-focused' / 'Transition-signalling' / 'Seniority-led'",
        "why": "1 sentence rationale",
        "when_to_use": "1 sentence on when to switch to this version"
      },
      {
        "text": "Alternative 2",
        "char_count": 0,
        "label": "Label",
        "why": "string",
        "when_to_use": "string"
      },
      {
        "text": "Alternative 3",
        "char_count": 0,
        "label": "Label",
        "why": "string",
        "when_to_use": "string"
      }
    ]
  },

  "about_section": {
    "text": "Full About section — 1,500–1,900 chars. Hook → expertise paragraph → impact paragraph → direction sentence → CTA. Real paragraph breaks. No pronouns. No buzzwords. Specific and authentic.",
    "char_count": 0,
    "hashtags": ["#Hashtag1", "#Hashtag2", "#Hashtag3"],
    "structured_breakdown": {
      "hook": "Just the opening 1–2 sentences from the About section — the hook paragraph only",
      "value_prop": "The expertise / core value paragraph — copy from the full text",
      "transition": "The career direction sentence — how the narrative moves toward target role",
      "cta": "The closing call-to-action sentence"
    }
  },

  "experience_rewrites": [
    {
      "role_title": "Job title — extract from CV or use current role",
      "company": "Company if in CV, else empty string",
      "bullets": [
        "Action verb + specific responsibility + realistic outcome. No invented numbers unless in CV.",
        "Second bullet — same format",
        "Third bullet",
        "Fourth bullet"
      ]
    }
  ],

  "keywords": {
    "high_demand": [
      {
        "keyword": "Keyword name",
        "why_it_matters": "Why recruiters and algorithms weight this keyword for ${tgtTitle || currTitle}. 1 sentence.",
        "where_to_use": "Headline | About | Skills | Experience — or combination"
      },
      { "keyword": "string", "why_it_matters": "string", "where_to_use": "string" },
      { "keyword": "string", "why_it_matters": "string", "where_to_use": "string" },
      { "keyword": "string", "why_it_matters": "string", "where_to_use": "string" },
      { "keyword": "string", "why_it_matters": "string", "where_to_use": "string" }
    ],
    "missing_critical": [
      {
        "keyword": "Keyword they are likely missing",
        "why_it_matters": "What they lose by not having this keyword visible. 1 sentence.",
        "impact": "High | Medium"
      },
      { "keyword": "string", "why_it_matters": "string", "impact": "string" },
      { "keyword": "string", "why_it_matters": "string", "impact": "string" },
      { "keyword": "string", "why_it_matters": "string", "impact": "string" }
    ],
    "currently_strong": ["keyword that likely already exists in their profile", "keyword2", "keyword3"]
  },

  "skills": {
    "core":       ["Top 6–8 skills essential for ${tgtTitle || currTitle}"],
    "supporting": ["6–8 complementary skills"],
    "missing":    ["5–6 skills to add — most important first"]
  },

  "positioning_strategy": {
    "angle": "The strongest narrative angle for this profile. 2 sentences.",
    "bridge_message": "How to frame current → target in a credible way. 2 sentences.",
    "credibility_signal": "The single most compelling thing about this candidate. 1 sentence."
  }
}

CRITICAL RULES:
- profile_audit.overall_score: base this on how much information was provided. Without CV: 40–55. With CV and target role: 55–75. Calibrate breakdown scores independently.
- biggest_issues must be transition/role specific — not generic "add more skills" advice
- before_after.headline "before" must look like a real person's weak headline — not obviously fake
- keywords.high_demand must reference why this keyword matters for THIS target role specifically
- Calculate char_count accurately for every headline and the about_section`;

  const raw    = await _callAI(system, user);
  const parsed = _parseJson(raw);

  // Post-process char counts
  if (parsed.headlines?.recommended?.text && !parsed.headlines.recommended.char_count) {
    parsed.headlines.recommended.char_count = parsed.headlines.recommended.text.length;
  }
  if (parsed.headlines?.alternatives) {
    parsed.headlines.alternatives = parsed.headlines.alternatives.map(h => ({
      ...h, char_count: h.char_count || h.text?.length || 0,
    }));
  }
  if (parsed.about_section?.text && !parsed.about_section.char_count) {
    parsed.about_section.char_count = parsed.about_section.text.length;
  }

  return parsed;
}

// =============================================================================
// Helpers
// =============================================================================

function _emptyAI() {
  return {
    profile_audit:       null,
    before_after:        null,
    headlines:           null,
    about_section:       null,
    experience_rewrites: [],
    keywords:            null,
    skills:              null,
    positioning_strategy:null,
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
