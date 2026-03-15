// /api/interview-prep.js
import OpenAI from "openai";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
];

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────────────────────
// Existing helpers  (unchanged)
// ─────────────────────────────────────────────────────────────

/**
 * Strips markdown fences and safely parses JSON from a raw model string.
 * Returns { ok: true, data } or { ok: false, error, rawText }.
 * Never throws.
 */
function safeJsonParse(raw) {
  if (!raw) return { ok: false, error: "Empty AI response" };

  let text = String(raw).trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, error: "JSON parse failed", rawText: text };
  }
}

/**
 * Ensures the behavioural Q&A list is exactly n items by padding with
 * sensible STAR fallbacks. Unchanged from original.
 */
function ensureBehaviouralCount(list, targetRole, n = 10) {
  const role = targetRole || "this role";

  const cleaned = (Array.isArray(list) ? list : [])
    .map((x) => ({
      question: typeof x?.question === "string" ? x.question.trim() : "",
      answer:   typeof x?.answer   === "string" ? x.answer.trim()   : "",
    }))
    .filter((x) => x.question);

  const fallback = [
    {
      question: `Tell me about a time you handled a difficult stakeholder in ${role}.`,
      answer:   "STAR: Situation + Task + Action (how you communicated and aligned expectations) + Result (measurable impact).",
    },
    {
      question: `Describe a time you led a team through pressure or tight deadlines in ${role}.`,
      answer:   "STAR: Set priorities, delegated, tracked progress, removed blockers, and delivered outcome with metrics.",
    },
    {
      question: "Tell me about a time you made a mistake. What did you do?",
      answer:   "STAR: Own it early, communicate, fix fast, prevent recurrence (process change), share learning.",
    },
    {
      question: "Describe a time you had conflict with a colleague and how you resolved it.",
      answer:   "STAR: Focus on facts, listen, find common goal, agree actions, confirm outcome and relationship improved.",
    },
    {
      question: "Give an example of when you improved a process.",
      answer:   "STAR: Identify bottleneck, propose change, implement, measure before/after, sustain with documentation.",
    },
    {
      question: "Tell me about a time you influenced someone without authority.",
      answer:   "STAR: Build rapport, use data, align incentives, propose small pilot, gain buy-in, deliver result.",
    },
    {
      question: "Describe a time you dealt with an unhappy customer/client.",
      answer:   "STAR: Empathise, clarify issue, propose options, take ownership, follow up, restore trust with result.",
    },
    {
      question: "Tell me about a time you handled multiple priorities at once.",
      answer:   "STAR: Triage, define urgency/impact, communicate timelines, execute, review and adjust as needed.",
    },
    {
      question: "Describe a time you received critical feedback.",
      answer:   "STAR: Listen, clarify, agree improvement plan, apply change, show improved outcome later.",
    },
    {
      question: "Tell me about a time you used data to make a decision.",
      answer:   "STAR: Define metric, collect/compare, choose approach, implement, track impact, share insight.",
    },
  ];

  let out = cleaned.slice(0, n);
  let i = 0;
  while (out.length < n && i < fallback.length) {
    const item = fallback[i++];
    if (!out.some((x) => x.question === item.question)) out.push(item);
  }
  while (out.length < n) {
    out.push({
      question: `Tell me about a time you demonstrated leadership relevant to ${role}.`,
      answer:   "STAR: Context + your responsibility + what you did + measurable result + what you learned.",
    });
  }

  return out.slice(0, n);
}

// ─────────────────────────────────────────────────────────────
// Career Intelligence Layer helpers
// ─────────────────────────────────────────────────────────────

/**
 * Converts a free-text role name into a normalised kebab-case slug.
 * "Senior Data Analyst" → "senior-data-analyst"
 *
 * @param {string} value
 * @returns {string}
 */
function slugifyRole(value) {
  if (!value || typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Derives the base URL for internal API calls from the incoming
 * request's headers. Works identically on local dev and Vercel.
 *
 * @param {object} req
 * @returns {string}
 */
function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host  = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  return `${proto}://${host}`;
}

/**
 * Fetches role intelligence for a single slug.
 * Returns parsed data or null on any failure. Never throws.
 *
 * @param {string} slug
 * @param {string} baseUrl
 * @returns {Promise<object|null>}
 */
async function fetchRoleIntelligence(slug, baseUrl) {
  if (!slug) return null;
  try {
    const res = await fetch(
      `${baseUrl}/api/role-intelligence?slug=${encodeURIComponent(slug)}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.error ? null : data;
  } catch {
    return null;
  }
}

/**
 * Builds the role intelligence prompt section for the interview engine.
 * Only emits blocks when data is actually present — never injects empty strings.
 * Includes interview-specific guidance so the model can tailor:
 *   - roleSpecificQuestions to actual required skills
 *   - focusAreas to the role category / seniority
 *   - openingPitch with accurate role context
 *   - finalTips calibrated to the seniority level
 *
 * @param {object|null} roleData  — parsed role-intelligence response
 * @returns {string}              — ready-to-embed prompt block, or ""
 */
function buildRoleIntelligenceSection(roleData) {
  if (!roleData) return "";

  const lines = [
    "ROLE INTELLIGENCE (structured data from HireEdge dataset):",
    `  Title:     ${roleData.title     || ""}`,
    `  Category:  ${roleData.category  || ""}`,
    `  Seniority: ${roleData.seniority || ""}`,
  ];

  if (roleData.skills?.length) {
    lines.push(`  Required skills: ${roleData.skills.join(", ")}`);
  }

  if (roleData.career_paths?.next_roles?.length) {
    lines.push(`  Typical next roles: ${roleData.career_paths.next_roles.slice(0, 3).join(", ")}`);
  }

  if (roleData.career_paths?.previous_roles?.length) {
    lines.push(`  Common entry routes: ${roleData.career_paths.previous_roles.slice(0, 3).join(", ")}`);
  }

  lines.push(
    "",
    "Interview guidance from this data:",
    "  - roleSpecificQuestions MUST test the Required skills listed above.",
    "  - focusAreas should reflect the role Category and Seniority.",
    "  - openingPitch (roleSummary) should reference the exact role Title and Seniority.",
    "  - finalTips (tips) should be calibrated to the Seniority level: " +
      (roleData.seniority
        ? `this is a ${roleData.seniority}-level role.`
        : "adjust to the role level.")
  );

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // ── CORS  (unchanged) ─────────────────────────────────────
  const origin = req.headers.origin;
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { jobDescription, cvText, targetRole } = req.body || {};

    if (!jobDescription && !targetRole) {
      return res.status(200).json({
        ok:    false,
        error: "Please provide jobDescription or targetRole for interview prep",
      });
    }

    // ── Career Intelligence Layer lookup ──────────────────
    //
    //  Fetch role intelligence only when a targetRole is present.
    //  On any failure the engine continues with roleData = null
    //  and the prompts fall back to the original behaviour.
    //
    const baseUrl  = getBaseUrl(req);
    const roleSlug = slugifyRole(targetRole || "");
    const roleData = roleSlug ? await fetchRoleIntelligence(roleSlug, baseUrl) : null;

    const roleSection = buildRoleIntelligenceSection(roleData);

    // ── System prompt  (schema unchanged, enriched instruction) ──
    const systemPrompt = `
You are the "HireEdge Interview Prep Coach".

You create focused interview prep for one specific role.
${roleSection
  ? "Use the structured Role Intelligence data provided in the user message to make your output highly specific to this role's actual required skills, seniority level, and category."
  : ""}
ALWAYS respond with ONLY this JSON shape:

{
  "roleSummary": string,
  "focusAreas": string[],
  "behaviouralQuestions": [
    { "question": string, "answer": string }
  ],
  "roleSpecificQuestions": [
    { "question": string, "answer": string }
  ],
  "strengthQuestions": [
    { "question": string, "answer": string }
  ],
  "closingQuestions": string[],
  "tips": string[]
}

Rules:
- Behavioural answers should follow STAR style where relevant.
- Keep answers concise but practical.
- Do NOT include backticks or any text outside JSON.

Output constraints (IMPORTANT):
- Return EXACTLY 10 behaviouralQuestions (each with question + answer).
  • 4 leadership/decision-making
  • 3 teamwork/collaboration
  • 2 conflict/failure handling
  • 1 pressure/time-management
- Return EXACTLY 6 roleSpecificQuestions (each with question + answer).
- Return EXACTLY 4 strengthQuestions (each with question + answer).
- Return EXACTLY 6 closingQuestions (strings).
- Return EXACTLY 8 tips (strings).
- Make roleSpecificQuestions tightly aligned to the provided jobDescription/targetRole.
- Make strengthQuestions reflect the candidate CV where provided.
`.trim();

    // ── User prompt  (enriched with role intelligence) ────
    const userPrompt = `
TARGET ROLE: ${targetRole || "Not specified"}

JOB DESCRIPTION:
${jobDescription || "Not provided"}

CANDIDATE CV / BACKGROUND:
${cvText || "Not provided"}
${roleSection ? `\n${roleSection}\n` : ""}
Create targeted interview prep and return JSON only.
`.trim();

    // ── OpenAI call ───────────────────────────────────────
    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
    });

    // ── Robust text extraction  (unchanged) ──────────────
    const raw =
      (typeof response.output_text === "string" && response.output_text.trim()) ||
      response.output?.[0]?.content?.[0]?.text?.trim() ||
      "";

    const parsedRes = safeJsonParse(raw);
    if (!parsedRes.ok) {
      console.error("❌ interview-prep JSON parse error:", parsedRes.rawText || raw);
      return res.status(200).json({
        ok:      false,
        error:   "Failed to parse AI response",
        rawText: parsedRes.rawText || raw,
      });
    }

    const parsed = parsedRes.data || {};

    // ── Normalise to frontend schema  (unchanged) ────────

    // Opening Pitch
    const openingPitch = String(parsed.roleSummary || "").trim();

    // Core Interview Questions (role + strengths combined)
    const MIN_CORE = 7;
    const MAX_CORE = 10;

    let coreQuestions = []
      .concat(Array.isArray(parsed.roleSpecificQuestions) ? parsed.roleSpecificQuestions : [])
      .concat(Array.isArray(parsed.strengthQuestions)     ? parsed.strengthQuestions     : [])
      .map((x) => {
        if (typeof x === "string") return x.trim();
        if (x && typeof x === "object") return String(x.question || "").trim();
        return "";
      })
      .filter(Boolean);

    coreQuestions = coreQuestions.slice(0, MAX_CORE);

    if (coreQuestions.length < MIN_CORE) {
      const role = targetRole || "this role";
      const fallback = [
        `Walk me through your experience relevant to ${role}.`,
        `Why do you want ${role} and why now?`,
        `What are your top strengths for ${role}?`,
        `What's one development area you're actively improving?`,
        "Tell me about a time you handled a challenging situation at work.",
        "How do you prioritise when everything is urgent?",
        `What would you do in your first 30/60/90 days in ${role}?`,
        "How do you handle feedback or disagreement with a stakeholder?",
        "What metrics do you use to measure success in your work?",
        "Describe a time you improved a process or delivered measurable results.",
      ];
      for (const q of fallback) {
        if (coreQuestions.length >= MIN_CORE) break;
        if (!coreQuestions.includes(q)) coreQuestions.push(q);
      }
      coreQuestions = coreQuestions.slice(0, MAX_CORE);
    }

    // Behavioural STAR Q&A (force exactly 10 for UI)
    const behaviouralQuestions = ensureBehaviouralCount(
      parsed.behaviouralQuestions,
      targetRole,
      10
    );

    // Questions to Ask Interviewer
    const questionsForInterviewer = (Array.isArray(parsed.closingQuestions)
      ? parsed.closingQuestions : []
    ).map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);

    // Final Tips
    const finalTips = (Array.isArray(parsed.tips) ? parsed.tips : [])
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);

    // ── Response  (all keys unchanged) ───────────────────
    return res.status(200).json({
      ok: true,

      // frontend-standard keys
      openingPitch,
      coreQuestions,
      behaviouralQuestions,
      questionsForInterviewer,
      finalTips,

      // original keys (kept for safety)
      roleSummary:           parsed.roleSummary           || "",
      focusAreas:            Array.isArray(parsed.focusAreas)            ? parsed.focusAreas            : [],
      roleSpecificQuestions: Array.isArray(parsed.roleSpecificQuestions) ? parsed.roleSpecificQuestions : [],
      strengthQuestions:     Array.isArray(parsed.strengthQuestions)     ? parsed.strengthQuestions     : [],
      closingQuestions:      Array.isArray(parsed.closingQuestions)      ? parsed.closingQuestions      : [],
      tips:                  Array.isArray(parsed.tips)                  ? parsed.tips                  : [],
    });

  } catch (err) {
    console.error("❌ interview-prep error:", err?.message || err);
    return res.status(200).json({
      ok:    false,
      error: "Interview prep engine failed",
    });
  }
}
