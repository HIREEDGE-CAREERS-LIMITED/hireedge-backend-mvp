// ============================================================================
// api/tools/resume-optimiser.js
// HireEdge Backend — Resume Optimiser + Generator (Production v2)
// ============================================================================

import OpenAI from "openai";
import { getRoleBySlug } from "../../lib/dataset/roleIndex.js";
import { getSalaryIntelligence } from "../../lib/intelligence/salaryEngine.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET")     return _handleLegacyGet(req, res);
  if (req.method !== "POST")    return res.status(405).json({ error: "Method not allowed. Use POST." });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ ok: false, error: "OPENAI_API_KEY is not configured." });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON in request body." });
  }

  const {
    cvText         = "",
    targetRole     = "",
    targetRoleTitle = "",
    currentRole    = "",
    skills         = "",
    yearsExp       = null,
    jobDescription = "",
  } = body;

  if (!targetRole && !targetRoleTitle) {
    return res.status(400).json({ ok: false, error: "targetRole or targetRoleTitle is required." });
  }

  const mode       = cvText.trim().length > 50 ? "optimise" : "generate";
  const roleData   = getRoleBySlug(targetRole) || null;
  const roleTitle  = targetRoleTitle || roleData?.title || _slugToTitle(targetRole);
  const currTitle  = _slugToTitle(currentRole);
  const skillsList = typeof skills === "string"
    ? skills.split(",").map((s) => s.trim()).filter(Boolean)
    : (Array.isArray(skills) ? skills : []);
  const roleCtx    = roleData ? _buildRoleContext(roleData, _safe(() => getSalaryIntelligence(targetRole))) : "";

  let analysisResult, writerResult;
  try {
    [analysisResult, writerResult] = await Promise.all([
      _callOpenAI(_analysisSystem(), _analysisUser({ mode, cvText, roleTitle, currTitle, skillsList, yearsExp, jobDescription, roleCtx })),
      _callOpenAIText(_writerSystem(),  _writerUser({ mode, cvText, roleTitle, currTitle, skillsList, yearsExp, jobDescription, roleCtx })),
    ]);
  } catch (err) {
    console.error("[resume-optimiser] AI error:", err.message);
    return res.status(500).json({ ok: false, error: "AI service unavailable. Please try again." });
  }

  let p;
  try {
    p = JSON.parse(_cleanJson(analysisResult));
  } catch {
    const m = analysisResult.match(/\{[\s\S]*\}/);
    try { p = JSON.parse(m?.[0] || "{}"); } catch { p = {}; }
  }

  return res.status(200).json({
    ok:   true,
    mode,
    summary: {
      currentATS:          p.currentATS          ?? (mode === "generate" ? null : 0),
      improvedATS:         p.improvedATS          ?? p.atsScore ?? null,
      topGaps:             p.topGaps              || [],
      positioningStrategy: p.positioningStrategy  || "",
      scoreExplanation:    p.scoreExplanation     || [],
    },
    resume: {
      professionalSummary:  p.professionalSummary  || "",
      coreSkills:           p.coreSkills           || skillsList,
      experience:           p.experience           || [],
      suggestedStructure:   p.suggestedStructure   || [],
      fullText:             writerResult           || "",
    },
    keywords: {
      matched:                      p.keywords?.matched                      || [],
      missing:                      p.keywords?.missing                      || [],
      priority:                     p.keywords?.priority                     || [],
      keywordPlacementRecommendations: p.keywords?.keywordPlacementRecommendations || [],
    },
    improvements: {
      changesMade:  p.improvements?.changesMade  || [],
      stillMissing: p.improvements?.stillMissing || [],
    },
  });
}

// ===========================================================================
// Analysis prompt — structured JSON output
// ===========================================================================

function _analysisSystem() {
  return `You are a senior UK careers consultant and ATS specialist inside the EDGEX career intelligence platform.
You write at executive level. Your resume rewrites are used by professionals applying to top-tier companies.

CRITICAL RULES — MUST FOLLOW WITHOUT EXCEPTION:

1. EXPERIENCE BULLETS:
   Every single bullet MUST follow: [Strong Action Verb] + [Task/Responsibility] + [Quantified Impact]
   NEVER write descriptive bullets. ALWAYS include metrics.
   If real metrics are unknown, generate CONSERVATIVE REALISTIC estimates appropriate to the industry.
   
   BAD: "Managed sales pipeline and client relationships"
   GOOD: "Managed a £2.4M sales pipeline across 38 active accounts, maintaining a 94% client retention rate"
   
   BAD: "Led cross-functional teams"
   GOOD: "Led cross-functional teams of 8–12 across Product, Engineering and Design to deliver 3 roadmap releases on schedule"

2. PROFESSIONAL SUMMARY:
   - 3–4 lines maximum
   - No first-person pronouns
   - Must contain: years of experience, target role title, 2 core competencies, 1 quantified achievement
   - Optimised for ATS keyword scanning

3. KEYWORD PLACEMENT:
   - For every missing priority keyword, specify EXACTLY where to place it (which section, which sentence)

4. UK CONTEXT:
   - Use UK spelling throughout (organisation, optimise, etc.)
   - Reference UK salary context where relevant
   - Use "CV" not "resume" in any user-facing copy

Return ONLY valid JSON. No markdown, no backticks, no prose outside JSON.

EXACT JSON STRUCTURE REQUIRED:
{
  "currentATS": number (0-100, null if generate mode),
  "improvedATS": number (0-100),
  "scoreExplanation": string[] (exactly 4 bullet points explaining the score improvement),
  "topGaps": string[] (top 5 missing keywords),
  "positioningStrategy": string (2-3 sentences, specific to this transition, UK-focused),
  "professionalSummary": string (3-4 lines, ATS-optimised, no pronouns, quantified),
  "coreSkills": string[] (14-18 skills, ordered: most to least relevant to target role),
  "experience": [
    {
      "role": string,
      "company": string (use realistic generic if unknown, e.g. "Global Technology Company"),
      "dates": string (e.g. "Mar 2021 – Present"),
      "bullets": string[] (5-6 bullets, EVERY ONE quantified with Action+Task+Metric)
    }
  ],
  "suggestedStructure": string[],
  "keywords": {
    "matched": string[],
    "missing": string[],
    "priority": string[] (top 8 to add immediately),
    "keywordPlacementRecommendations": [
      {
        "keyword": string,
        "section": string (e.g. "Professional Summary", "Core Skills", "Experience — [Role]"),
        "rationale": string (1 sentence why this placement maximises ATS score)
      }
    ]
  },
  "improvements": {
    "changesMade": string[] (specific changes made — reference the actual content),
    "stillMissing": string[] (gaps requiring real-world experience)
  }
}`;
}

function _analysisUser({ mode, cvText, roleTitle, currTitle, skillsList, yearsExp, jobDescription, roleCtx }) {
  const context = [
    `TARGET ROLE: ${roleTitle}`,
    currTitle ? `CURRENT ROLE: ${currTitle}` : null,
    yearsExp  ? `YEARS EXPERIENCE: ${yearsExp}` : null,
    skillsList.length ? `SKILLS: ${skillsList.join(", ")}` : null,
    jobDescription ? `\nJOB DESCRIPTION TO OPTIMISE FOR:\n${jobDescription}` : null,
    roleCtx ? `\nROLE INTELLIGENCE (HireEdge Dataset):\n${roleCtx}` : null,
  ].filter(Boolean).join("\n");

  if (mode === "optimise") {
    return `TASK: Analyse and fully rewrite this CV for the target role. Apply ALL critical rules.

${context}

CURRENT CV:
${cvText}

IMPORTANT:
- Rewrite every experience bullet with Action + Task + Quantified Impact
- Generate conservative realistic metrics if none exist  
- Provide keyword placement recommendations for ALL priority keywords
- Score explanation must reference specific changes made
Return JSON only.`;
  }

  return `TASK: Generate a complete, senior-level CV from scratch for this profile.

${context}

IMPORTANT:
- Generate realistic role history appropriate to ${yearsExp || "the stated"} years experience
- Every bullet must have Action + Task + Quantified Impact with realistic UK-market metrics
- Make the CV feel authentic, not template-generated
- Set currentATS to null
Return JSON only.`;
}

// ===========================================================================
// Writer prompt — full plain-text CV output
// ===========================================================================

function _writerSystem() {
  return `You are an elite UK CV writer producing recruiter-ready CVs for top professionals.

OUTPUT FORMAT — STRICT:
Use these exact CAPS section headings on their own lines:
PROFESSIONAL SUMMARY
CORE SKILLS  
EXPERIENCE
EDUCATION
ADDITIONAL

EXPERIENCE entries format:
[Job Title] | [Company] | [Location] | [Dates]
• [Achievement bullet — Action + Task + Quantified Impact]
• [Achievement bullet — Action + Task + Quantified Impact]
(5-6 bullets per role)

CORE SKILLS: list skills separated by  |  (pipe with spaces)

Rules:
- Use bullet character • (not dash -)
- UK spelling throughout
- No markdown, no JSON, no asterisks, no headers with #
- No first-person pronouns
- Realistic, specific, quantified
- Output ONLY the CV text`;
}

function _writerUser({ mode, cvText, roleTitle, currTitle, skillsList, yearsExp, jobDescription, roleCtx }) {
  const context = [
    `Target role: ${roleTitle}`,
    currTitle    ? `Current/most recent role: ${currTitle}` : null,
    yearsExp     ? `Years of experience: ${yearsExp}` : null,
    skillsList.length ? `Key skills: ${skillsList.join(", ")}` : null,
    jobDescription ? `\nTarget job description:\n${jobDescription}` : null,
    roleCtx ? `\nRole context:\n${roleCtx}` : null,
  ].filter(Boolean).join("\n");

  if (mode === "optimise") {
    return `Rewrite this CV for the role of ${roleTitle}. Apply all formatting and quality rules.

${context}

Original CV:
${cvText}

Produce the complete optimised CV as plain text only.`;
  }

  return `Generate a complete, realistic CV for ${roleTitle}.
${context}

Generate a full, authentic CV. Use realistic company names and dates. Output plain text only.`;
}

// ===========================================================================
// Helpers
// ===========================================================================

async function _callOpenAI(systemPrompt, userPrompt) {
  const r = await openai.responses.create({
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt   },
    ],
  });
  return r.output?.[0]?.content?.[0]?.text?.trim() ?? "";
}

async function _callOpenAIText(systemPrompt, userPrompt) {
  const r = await openai.responses.create({
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt   },
    ],
  });
  let t = r.output?.[0]?.content?.[0]?.text?.trim() ?? "";
  if (t.startsWith("```")) t = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  return t;
}

function _buildRoleContext(rd, salary) {
  const lines = [
    `Title: ${rd.title}`,
    `Category: ${rd.category}`,
    `Seniority: ${rd.seniority}`,
  ];
  if (rd.skills?.length)        lines.push(`Required skills: ${rd.skills.slice(0, 20).join(", ")}`);
  if (salary?.salary?.mean)     lines.push(`UK salary benchmark: £${salary.salary.mean.toLocaleString()} mean`);
  if (rd.skills_grouped?.core?.length) lines.push(`Core competencies: ${rd.skills_grouped.core.join(", ")}`);
  return lines.join("\n");
}

function _cleanJson(raw) {
  let t = (raw || "").trim();
  if (t.startsWith("```")) t = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  return t;
}

function _slugToTitle(slug) {
  if (!slug) return "";
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function _safe(fn) {
  try { return fn(); } catch { return null; }
}

// ===========================================================================
// Legacy GET (keeps Career Pack working)
// ===========================================================================

function _handleLegacyGet(req, res) {
  const { generateResumeBlueprint, compareResumeReadiness } = require("../../lib/tools/resumeEngine.js");
  const { enforceBilling } = require("../../lib/billing/billingMiddleware.js");
  if (enforceBilling(req, res, "resume-optimiser")) return;

  const { action, target, skills, current, yearsExp, targets } = req.query;

  if (action === "blueprint") {
    if (!target || !skills) return res.status(400).json({ error: "Missing required params: target, skills" });
    const skillList = skills.split(",").map((s) => s.trim()).filter(Boolean);
    const data = generateResumeBlueprint({ targetRole: target, skills: skillList, currentRole: current || undefined, yearsExp: yearsExp ? parseInt(yearsExp, 10) : undefined });
    if (!data) return res.status(404).json({ error: `Role not found: ${target}` });
    return res.status(200).json({ ok: true, data });
  }
  if (action === "compare") {
    if (!targets || !skills) return res.status(400).json({ error: "Missing required params: targets, skills" });
    const data = compareResumeReadiness(targets.split(",").map(s => s.trim()), skills.split(",").map(s => s.trim()));
    return res.status(200).json({ ok: true, data });
  }
  return res.status(400).json({ error: "Use POST for AI resume generation." });
}
