// ============================================================================
// api/tools/resume-optimiser.js
// HireEdge Backend — Resume Optimiser + Generator (Production v3)
//
// Changes in this version:
//   - Prompt explicitly preserves original job titles
//   - Bullet quality rules tightened (Action + Task + Result mandatory)
//   - Post-process guarantees "•" bullets in writerResult
//   - Legacy GET preserved for Career Pack compatibility
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
    cvText          = "",
    targetRole      = "",
    targetRoleTitle = "",
    currentRole     = "",
    skills          = "",
    yearsExp        = null,
    jobDescription  = "",
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
    : Array.isArray(skills) ? skills : [];
  const roleCtx = roleData
    ? _buildRoleContext(roleData, _safe(() => getSalaryIntelligence(targetRole)))
    : "";

  let analysisRaw, writerRaw;
  try {
    [analysisRaw, writerRaw] = await Promise.all([
      _callOpenAI(
        _analysisSystem(roleTitle),
        _analysisUser({ mode, cvText, roleTitle, currTitle, skillsList, yearsExp, jobDescription, roleCtx })
      ),
      _callOpenAIText(
        _writerSystem(),
        _writerUser({ mode, cvText, roleTitle, currTitle, skillsList, yearsExp, jobDescription, roleCtx })
      ),
    ]);
  } catch (err) {
    console.error("[resume-optimiser] AI error:", err.message);
    return res.status(500).json({ ok: false, error: "AI service unavailable. Please try again." });
  }

  // Guarantee "•" bullets regardless of GPT compliance
  const writerResult = _normaliseBullets(writerRaw);

  let p = {};
  try {
    p = JSON.parse(_cleanJson(analysisRaw));
  } catch {
    const m = analysisRaw.match(/\{[\s\S]*\}/);
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
      professionalSummary: p.professionalSummary || "",
      coreSkills:          p.coreSkills          || skillsList,
      experience:          p.experience          || [],
      suggestedStructure:  p.suggestedStructure  || [],
      fullText:            writerResult          || "",
    },
    keywords: {
      matched:                         p.keywords?.matched                         || [],
      missing:                         p.keywords?.missing                         || [],
      priority:                        p.keywords?.priority                        || [],
      keywordPlacementRecommendations: p.keywords?.keywordPlacementRecommendations || [],
    },
    improvements: {
      changesMade:  p.improvements?.changesMade  || [],
      stillMissing: p.improvements?.stillMissing || [],
    },
  });
}

// ===========================================================================
// Analysis prompt (JSON output)
// ===========================================================================

function _analysisSystem(roleTitle) {
  return `You are a senior UK careers consultant and ATS specialist inside the EDGEX career intelligence platform.
Your rewrites are used by senior professionals applying to competitive roles.

═══════════════════════════════════════════════
RULE 1 — PRESERVE JOB TITLES (CRITICAL)
═══════════════════════════════════════════════
NEVER rename or rewrite the candidate's actual job titles.
If the CV says "Founder and CEO" — keep it as "Founder and CEO".
If the CV says "Senior Account Manager" — keep it as "Senior Account Manager".
You may only rewrite the BULLETS under each role, not the title itself.
The only exception: if generating from scratch with no CV provided.

═══════════════════════════════════════════════
RULE 2 — BULLET QUALITY (MANDATORY FORMAT)
═══════════════════════════════════════════════
Every experience bullet MUST follow: [Action Verb] + [Task] + [Result with metric]
If no metric exists in the CV, generate a CONSERVATIVE REALISTIC estimate
appropriate to the role, seniority, and industry.

EXAMPLES — BEFORE vs AFTER:

Before: "Build and manage partnerships with clients"
After:  "Built and scaled B2B partnerships across 12 enterprise accounts, growing recurring revenue by £340K over 18 months"

Before: "Led product development initiatives"
After:  "Led end-to-end product development for 4 core platform features, reducing user drop-off by 18% and cutting support tickets by 30%"

Before: "Responsible for sales forecasting"
After:  "Delivered monthly sales forecasts with 92% accuracy across a £1.8M pipeline, enabling board-level resource planning"

Before: "Managed a team of analysts"
After:  "Managed a 6-person analytics team, improving report delivery speed by 40% through process redesign and tooling upgrades"

═══════════════════════════════════════════════
RULE 3 — PROFESSIONAL SUMMARY
═══════════════════════════════════════════════
3–4 lines. No first-person pronouns. Must include:
- Years of experience
- Target role: ${roleTitle}
- Two core competencies relevant to target role
- One quantified achievement from the CV

═══════════════════════════════════════════════
RULE 4 — UK STANDARD
═══════════════════════════════════════════════
- UK spelling throughout (organisation, optimise, prioritise, etc.)
- Use "CV" not "resume"
- UK salary context where relevant
- Avoid US-centric terminology

═══════════════════════════════════════════════
OUTPUT RULE — STRICT
═══════════════════════════════════════════════
Return ONLY valid JSON. No markdown, no backticks, no prose outside the JSON.

EXACT STRUCTURE:
{
  "currentATS": number (0-100) or null if generate mode,
  "improvedATS": number (0-100),
  "scoreExplanation": string[] (exactly 4 specific bullet points explaining score improvement),
  "topGaps": string[] (5 most important missing keywords),
  "positioningStrategy": string (2-3 sentences specific to this candidate's transition),
  "professionalSummary": string (3-4 lines, ATS-optimised, no pronouns),
  "coreSkills": string[] (14-18 skills ordered most to least relevant to target role),
  "experience": [
    {
      "role": string (MUST MATCH original CV title exactly — do not rename),
      "company": string,
      "dates": string,
      "bullets": string[] (5-6 bullets, EACH following Action+Task+Result with metric)
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
        "section": string (exact section name),
        "rationale": string (one sentence)
      }
    ]
  },
  "improvements": {
    "changesMade": string[] (specific changes — reference actual content),
    "stillMissing": string[] (gaps requiring real experience)
  }
}`;
}

function _analysisUser({ mode, cvText, roleTitle, currTitle, skillsList, yearsExp, jobDescription, roleCtx }) {
  const ctx = [
    `TARGET ROLE: ${roleTitle}`,
    currTitle      ? `CURRENT ROLE: ${currTitle}` : null,
    yearsExp       ? `YEARS EXPERIENCE: ${yearsExp}` : null,
    skillsList.length ? `SKILLS: ${skillsList.join(", ")}` : null,
    jobDescription ? `\nJOB DESCRIPTION:\n${jobDescription}` : null,
    roleCtx        ? `\nROLE INTELLIGENCE (HireEdge dataset):\n${roleCtx}` : null,
  ].filter(Boolean).join("\n");

  if (mode === "optimise") {
    return `TASK: Analyse and optimise this CV for the role of ${roleTitle}.

${ctx}

IMPORTANT REMINDERS:
- Keep ALL original job titles exactly as written
- Rewrite ONLY the bullets (apply Action+Task+Result format with metrics)
- Calculate currentATS against the target role before rewriting
- Return JSON only

CURRENT CV:
${cvText}`;
  }

  return `TASK: Generate a complete, senior-level CV for ${roleTitle} from scratch.

${ctx}

- Generate realistic role history appropriate to ${yearsExp || "the stated"} years experience
- Every bullet: Action+Task+Result with realistic UK-market metrics
- Set currentATS to null
- Return JSON only`;
}

// ===========================================================================
// Writer prompt (plain-text CV output)
// ===========================================================================

function _writerSystem() {
  return `You are an elite UK CV writer producing recruiter-ready CVs.
Output ONLY the CV as clean plain text. No JSON. No markdown. No asterisks. No bold markers.

SECTION HEADINGS — use exactly these phrases on their own lines:
PROFESSIONAL SUMMARY
CORE SKILLS
EXPERIENCE
EDUCATION
ADDITIONAL

EXPERIENCE FORMAT:
[Original Job Title] | [Company] | [Location] | [Start – End]
• [Action verb] + [task] + [quantified result]
• [Action verb] + [task] + [quantified result]
(5–6 bullets per role)

CORE SKILLS FORMAT:
List skills separated by  |  (pipe with spaces on each side)

BULLET FORMAT:
Start every bullet with the • character (Unicode U+2022).
NEVER use "- " or "* " for bullets.
Every bullet: strong action verb + specific task + metric or outcome.

PRESERVE original job titles exactly as they appear in the source CV.
UK spelling throughout. No first-person pronouns. Output CV text only.`;
}

function _writerUser({ mode, cvText, roleTitle, currTitle, skillsList, yearsExp, jobDescription, roleCtx }) {
  const ctx = [
    `Target role: ${roleTitle}`,
    currTitle      ? `Current/most recent role: ${currTitle}` : null,
    yearsExp       ? `Years of experience: ${yearsExp}` : null,
    skillsList.length ? `Key skills: ${skillsList.join(", ")}` : null,
    jobDescription ? `\nTarget job description:\n${jobDescription}` : null,
    roleCtx        ? `\nRole context:\n${roleCtx}` : null,
  ].filter(Boolean).join("\n");

  if (mode === "optimise") {
    return `Rewrite this CV targeting the role of ${roleTitle}.
Keep all original job titles. Rewrite bullets to Action+Task+Result with metrics.
${ctx}

Original CV:
${cvText}

Output the complete rewritten CV as plain text only.`;
  }

  return `Generate a complete, realistic professional CV for ${roleTitle}.
${ctx}

Use realistic company names and dates. Every bullet must have metrics. Output plain text only.`;
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

function _normaliseBullets(text) {
  return text
    .split("\n")
    .map((line) =>
      /^(\s*)[\-\*]\s/.test(line)
        ? line.replace(/^(\s*)[\-\*]\s/, "$1• ")
        : line
    )
    .join("\n");
}

function _buildRoleContext(rd, salary) {
  const lines = [
    `Title: ${rd.title}`,
    `Category: ${rd.category}`,
    `Seniority: ${rd.seniority}`,
  ];
  if (rd.skills?.length)             lines.push(`Required skills: ${rd.skills.slice(0, 20).join(", ")}`);
  if (rd.skills_grouped?.core?.length) lines.push(`Core competencies: ${rd.skills_grouped.core.join(", ")}`);
  if (salary?.salary?.mean)           lines.push(`UK salary benchmark: £${salary.salary.mean.toLocaleString()} mean`);
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
    if (!target || !skills) {
      return res.status(400).json({ error: "Missing required params: target, skills" });
    }
    const skillList = skills.split(",").map((s) => s.trim()).filter(Boolean);
    const data = generateResumeBlueprint({
      targetRole:  target,
      skills:      skillList,
      currentRole: current  || undefined,
      yearsExp:    yearsExp ? parseInt(yearsExp, 10) : undefined,
    });
    if (!data) return res.status(404).json({ error: `Role not found: ${target}` });
    return res.status(200).json({ ok: true, data });
  }

  if (action === "compare") {
    if (!targets || !skills) {
      return res.status(400).json({ error: "Missing required params: targets, skills" });
    }
    const data = compareResumeReadiness(
      targets.split(",").map((s) => s.trim()),
      skills.split(",").map((s) => s.trim())
    );
    return res.status(200).json({ ok: true, data });
  }

  return res.status(400).json({ error: "Use POST for AI resume generation." });
}
