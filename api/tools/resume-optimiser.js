// ============================================================================
// api/tools/resume-optimiser.js
// HireEdge Backend — Unified Resume Optimiser + Generator
//
// Previously: GET only, returned keyword/score tips from resumeEngine.js
// Now:        POST, runs two parallel AI calls:
//               1. ATS analysis + structured rewrite (api/generate-resume logic)
//               2. Full plain-text resume (api/tools/resume-writer logic)
//             Combined into a single structured response the frontend renders.
//
// POST /api/tools/resume-optimiser
// Body: {
//   cvText:          string   — paste or extracted text (may be empty for generate mode)
//   targetRole:      string   — slug e.g. "product-manager"
//   targetRoleTitle: string   — human title e.g. "Product Manager"
//   currentRole:     string   — slug e.g. "sales-manager"
//   skills:          string   — comma-separated
//   yearsExp:        number
//   jobDescription:  string   — optional, improves ATS scoring
// }
//
// Returns: {
//   ok: true,
//   mode: "optimise" | "generate",
//   summary: { currentATS, improvedATS, topGaps, positioningStrategy },
//   resume: { professionalSummary, coreSkills, experience, suggestedStructure, fullText },
//   keywords: { matched, missing, priority },
//   improvements: { changesMade, stillMissing }
// }
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

  // ── Legacy GET support (blueprint only — keeps old Career Pack working) ──
  if (req.method === "GET") {
    return _handleLegacyGet(req, res);
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ ok: false, error: "OPENAI_API_KEY is not configured." });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON in request body." });
  }

  const {
    cvText        = "",
    targetRole    = "",
    targetRoleTitle = "",
    currentRole   = "",
    skills        = "",
    yearsExp      = null,
    jobDescription = "",
  } = body;

  if (!targetRole && !targetRoleTitle) {
    return res.status(400).json({ ok: false, error: "targetRole or targetRoleTitle is required." });
  }

  const mode     = cvText.trim().length > 50 ? "optimise" : "generate";
  const roleData = getRoleBySlug(targetRole) || null;
  const roleTitle = targetRoleTitle || roleData?.title || _slugToTitle(targetRole);
  const currentTitle = _slugToTitle(currentRole);
  const skillsList = typeof skills === "string"
    ? skills.split(",").map((s) => s.trim()).filter(Boolean)
    : (Array.isArray(skills) ? skills : []);

  // ── Build role context from dataset ──────────────────────────────────────
  let roleContext = "";
  if (roleData) {
    const salary = _safe(() => getSalaryIntelligence(targetRole));
    roleContext = _buildRoleContext(roleData, salary);
  }

  // ── Prompt: ATS analysis + structured rewrite ─────────────────────────────
  const analysisPrompt = _buildAnalysisPrompt({
    mode, cvText, roleTitle, currentTitle, skillsList,
    yearsExp, jobDescription, roleContext,
  });

  // ── Prompt: full plain-text resume ────────────────────────────────────────
  const writerPrompt = _buildWriterPrompt({
    mode, cvText, roleTitle, currentTitle, skillsList,
    yearsExp, jobDescription, roleContext,
  });

  // ── Run both AI calls in parallel ─────────────────────────────────────────
  let analysisResult, writerResult;
  try {
    [analysisResult, writerResult] = await Promise.all([
      _callOpenAI(analysisPrompt.system, analysisPrompt.user),
      _callOpenAIText(writerPrompt.system, writerPrompt.user),
    ]);
  } catch (err) {
    console.error("[resume-optimiser] AI call failed:", err.message);
    return res.status(500).json({ ok: false, error: "AI service unavailable. Please try again." });
  }

  // ── Parse analysis JSON ───────────────────────────────────────────────────
  let parsed;
  try {
    parsed = JSON.parse(_cleanJson(analysisResult));
  } catch {
    const m = analysisResult.match(/\{[\s\S]*\}/);
    try {
      parsed = JSON.parse(m?.[0] || "{}");
    } catch {
      parsed = {};
    }
  }

  // ── Build final response ──────────────────────────────────────────────────
  const currentATS  = parsed.currentATS  ?? (mode === "generate" ? null : 0);
  const improvedATS = parsed.improvedATS ?? parsed.atsScore ?? null;

  return res.status(200).json({
    ok:   true,
    mode,
    summary: {
      currentATS,
      improvedATS,
      topGaps:             parsed.topGaps            || parsed.missingKeywords?.slice(0, 5) || [],
      positioningStrategy: parsed.positioningStrategy || parsed.summary || "",
    },
    resume: {
      professionalSummary: parsed.professionalSummary || parsed.resume?.professionalSummary || "",
      coreSkills:          parsed.coreSkills          || parsed.resume?.coreSkills          || skillsList,
      experience:          parsed.experience          || parsed.resume?.experience          || [],
      suggestedStructure:  parsed.suggestedStructure  || [],
      fullText:            writerResult || "",
    },
    keywords: {
      matched:  parsed.keywords?.matched  || parsed.matchedKeywords || [],
      missing:  parsed.keywords?.missing  || parsed.missingKeywords || [],
      priority: parsed.keywords?.priority || [],
    },
    improvements: {
      changesMade:  parsed.improvements?.changesMade  || parsed.suggestions || [],
      stillMissing: parsed.improvements?.stillMissing || [],
    },
  });
}

// ===========================================================================
// Prompt builders
// ===========================================================================

function _buildAnalysisPrompt({ mode, cvText, roleTitle, currentTitle, skillsList, yearsExp, jobDescription, roleContext }) {
  const system = `You are an expert UK career coach and ATS specialist working inside the EDGEX career intelligence platform.
Your output is consumed programmatically — return ONLY valid JSON, no markdown, no backticks, no prose outside the JSON object.

Return this EXACT structure:
{
  "currentATS": number (0-100, null if no CV provided),
  "improvedATS": number (0-100, projected after optimisation),
  "topGaps": string[] (top 5 missing keywords/skills),
  "positioningStrategy": string (2-3 sentence strategy for this specific transition),
  "professionalSummary": string (3-4 line ATS-optimised summary for the target role),
  "coreSkills": string[] (12-16 skills to feature, ordered by relevance to target),
  "experience": [
    {
      "role": string (job title),
      "bullets": string[] (3-6 achievement bullets, quantified where possible)
    }
  ],
  "suggestedStructure": string[] (ordered section list e.g. ["Professional Summary", "Core Skills", ...]),
  "keywords": {
    "matched": string[] (skills/keywords already present),
    "missing": string[] (important keywords absent from CV),
    "priority": string[] (top 8 keywords to add immediately)
  },
  "improvements": {
    "changesMade": string[] (specific changes made in this rewrite),
    "stillMissing": string[] (gaps that need real-world experience to close)
  }
}`;

  const user = mode === "optimise"
    ? `TASK: Analyse and rewrite this resume for the target role.

TARGET ROLE: ${roleTitle}
CURRENT ROLE: ${currentTitle || "Not specified"}
YEARS EXPERIENCE: ${yearsExp || "Not specified"}
SKILLS: ${skillsList.join(", ") || "Not specified"}
${jobDescription ? `\nJOB DESCRIPTION:\n${jobDescription}` : ""}
${roleContext ? `\nROLE INTELLIGENCE (HireEdge dataset):\n${roleContext}` : ""}

CURRENT RESUME:
${cvText}

Analyse the current resume, calculate the currentATS score, then rewrite every section to maximise ATS compatibility and human appeal for ${roleTitle}. Return JSON only.`

    : `TASK: Generate a complete professional resume from scratch.

TARGET ROLE: ${roleTitle}
CURRENT ROLE: ${currentTitle || "Not specified"}
YEARS EXPERIENCE: ${yearsExp || "Not specified"}
SKILLS: ${skillsList.join(", ") || "Not specified"}
${jobDescription ? `\nJOB DESCRIPTION:\n${jobDescription}` : ""}
${roleContext ? `\nROLE INTELLIGENCE (HireEdge dataset):\n${roleContext}` : ""}

Generate a complete, ATS-optimised resume targeting ${roleTitle}. Use realistic but generic placeholder details for dates/company names where real data is unavailable. Set currentATS to null. Return JSON only.`;

  return { system, user };
}

function _buildWriterPrompt({ mode, cvText, roleTitle, currentTitle, skillsList, yearsExp, jobDescription, roleContext }) {
  const system = `You are an expert UK CV writer. Output ONLY the final resume as clean plain text.
No markdown, no JSON, no backticks. Use these CAPS section headings:
PROFESSIONAL SUMMARY
CORE SKILLS
EXPERIENCE
EDUCATION
ADDITIONAL

Under EXPERIENCE: Job Title | Company | Dates on one line, then bullet points starting with "- ".
Use UK spelling. No explanations — output only the resume text.`;

  const user = mode === "optimise"
    ? `Rewrite this resume targeting the role of ${roleTitle}.
${currentTitle ? `Current role: ${currentTitle}.` : ""}
${yearsExp ? `${yearsExp} years of experience.` : ""}
${skillsList.length ? `Key skills: ${skillsList.join(", ")}.` : ""}
${jobDescription ? `\nJob description to optimise for:\n${jobDescription}` : ""}
${roleContext ? `\nRole intelligence context:\n${roleContext}` : ""}

Original resume:
${cvText}

Produce the complete optimised resume as plain text only.`

    : `Generate a complete professional resume for ${roleTitle}.
${currentTitle ? `Transitioning from: ${currentTitle}.` : ""}
${yearsExp ? `${yearsExp} years of experience.` : ""}
${skillsList.length ? `Skills: ${skillsList.join(", ")}.` : ""}
${jobDescription ? `\nTarget job description:\n${jobDescription}` : ""}
${roleContext ? `\nRole context:\n${roleContext}` : ""}

Generate a realistic, complete UK-format resume as plain text only.`;

  return { system, user };
}

// ===========================================================================
// OpenAI helpers
// ===========================================================================

async function _callOpenAI(systemPrompt, userPrompt) {
  const response = await openai.responses.create({
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt   },
    ],
  });
  return response.output?.[0]?.content?.[0]?.text?.trim() ?? "";
}

async function _callOpenAIText(systemPrompt, userPrompt) {
  const response = await openai.responses.create({
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt   },
    ],
  });
  let text = response.output?.[0]?.content?.[0]?.text?.trim() ?? "";
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return text;
}

// ===========================================================================
// Legacy GET handler (keeps /api/tools/resume-optimiser?action=blueprint working)
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
      targetRole: target, skills: skillList,
      currentRole: current || undefined,
      yearsExp: yearsExp ? parseInt(yearsExp, 10) : undefined,
    });
    if (!data) return res.status(404).json({ error: `Role not found: ${target}` });
    return res.status(200).json({ ok: true, data });
  }

  if (action === "compare") {
    if (!targets || !skills) {
      return res.status(400).json({ error: "Missing required params: targets, skills" });
    }
    const targetList = targets.split(",").map((s) => s.trim()).filter(Boolean);
    const skillList  = skills.split(",").map((s) => s.trim()).filter(Boolean);
    const data = compareResumeReadiness(targetList, skillList);
    return res.status(200).json({ ok: true, data });
  }

  return res.status(400).json({ error: "Invalid action. Use POST for AI resume generation." });
}

// ===========================================================================
// Utilities
// ===========================================================================

function _buildRoleContext(roleData, salary) {
  const lines = [
    `Title: ${roleData.title}`,
    `Category: ${roleData.category}`,
    `Seniority: ${roleData.seniority}`,
  ];
  if (roleData.skills?.length) {
    lines.push(`Required skills: ${roleData.skills.slice(0, 20).join(", ")}`);
  }
  if (salary?.salary?.mean) {
    lines.push(`UK salary benchmark: £${salary.salary.mean.toLocaleString()} mean`);
  }
  return lines.join("\n");
}

function _cleanJson(raw) {
  let t = (raw || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return t;
}

function _slugToTitle(slug) {
  if (!slug) return "";
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function _safe(fn) {
  try { return fn(); } catch { return null; }
}
