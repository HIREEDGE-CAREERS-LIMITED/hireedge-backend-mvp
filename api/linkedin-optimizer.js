// /api/linkedin-optimizer.js
import OpenAI from "openai";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────────────────────
// Existing helpers  (unchanged)
// ─────────────────────────────────────────────────────────────

/**
 * Strips markdown code fences from a raw model string.
 * Unchanged from original.
 *
 * @param {string} raw
 * @returns {string}
 */
function cleanJsonText(raw) {
  let t = String(raw || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return t;
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
 * Formats a salary_uk object into a brief readable string.
 * Returns null if no usable data is present.
 *
 * @param {object|null} salary_uk
 * @returns {string|null}
 */
function formatSalary(salary_uk) {
  if (!salary_uk || typeof salary_uk !== "object") return null;
  const { min, max, mean } = salary_uk;
  if (!min && !max && !mean) return null;
  const parts = [];
  if (mean) parts.push(`typical £${mean.toLocaleString("en-GB")}`);
  if (min && max) parts.push(`range £${min.toLocaleString("en-GB")}–£${max.toLocaleString("en-GB")}`);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Builds the role intelligence prompt section for the LinkedIn optimiser.
 * Only emits blocks when data is actually present.
 *
 * Includes LinkedIn-specific guidance so the model can use the data to:
 *   - headline: reference exact title, seniority and key skills
 *   - about: include industry category and career progression context
 *   - searchKeywords: use required skills as recruiter search terms
 *   - hashtags: derive from category and skills
 *   - experienceBullets: align achievements to required skills
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

  const salary = formatSalary(roleData.salary_uk);
  if (salary) {
    lines.push(`  UK Salary benchmark: ${salary}`);
  }

  if (roleData.career_paths?.next_roles?.length) {
    lines.push(`  Typical next roles: ${roleData.career_paths.next_roles.slice(0, 3).join(", ")}`);
  }

  if (roleData.career_paths?.previous_roles?.length) {
    lines.push(`  Common entry routes: ${roleData.career_paths.previous_roles.slice(0, 3).join(", ")}`);
  }

  lines.push(
    "",
    "LinkedIn guidance from this data:",
    `  - headline: use the exact Title "${roleData.title || ""}" and highlight top Required skills.`,
    "  - about: frame the candidate's career story around the Category and typical progression path.",
    "  - searchKeywords: must include all Required skills — these are real recruiter search terms.",
    `  - hashtags: derive from Category ("${roleData.category || ""}") and top Required skills.`,
    "  - experienceBullets: frame achievements around Required skills to pass ATS filters.",
    `  - strengths: draw from Required skills and calibrate to ${roleData.seniority || "the"} seniority level.`
  );

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // ── POST only  (unchanged) ────────────────────────────────
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const {
      currentRole = "",
      targetRole  = "",
      industry    = "",
      cvText      = "",
    } = req.body || {};

    if (!String(cvText).trim()) {
      return res.status(400).json({ ok: false, error: "cvText is required" });
    }

    // ── No OpenAI key: fallback  (unchanged) ──────────────
    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        ok:       true,
        headline: `${targetRole || currentRole || "Professional"} | ${industry || "Industry"}`,
        about:
          "OpenAI_API_KEY missing on backend. This is a fallback output so the app never crashes.\n\n" +
          "Add OPENAI_API_KEY in Vercel environment variables and redeploy to enable AI output.",
        summary:  "Fallback output (no AI call).",
        strengths:         ["communication", "teamwork", "problem-solving", "stakeholder management"],
        searchKeywords:    ["sales", "customer success", "account management", "business development"],
        hashtags:          ["#career", "#jobs", "#linkedin", "#sales"],
        experienceBullets: [
          "Delivered measurable results across targets and KPIs.",
          "Built strong stakeholder relationships and improved outcomes.",
        ],
      });
    }

    // ── Career Intelligence Layer lookup ──────────────────
    //
    //  Attempt to enrich the prompt with structured role data.
    //  On any failure roleData stays null and the prompt falls
    //  back to the original behaviour unchanged.
    //
    const baseUrl  = getBaseUrl(req);
    const roleSlug = slugifyRole(targetRole || currentRole);
    const roleData = roleSlug ? await fetchRoleIntelligence(roleSlug, baseUrl) : null;

    const roleSection = buildRoleIntelligenceSection(roleData);

    // ── System prompt  (schema unchanged, enriched guidance) ─
    const systemPrompt = `
You are the "HireEdge LinkedIn Profile Optimiser".

Generate a high-conversion LinkedIn profile for job search and recruiter visibility.
${roleSection
  ? "Use the structured Role Intelligence data provided in the user message to make every output field highly specific: headline should reference the exact role title and key skills; searchKeywords must include all required skills; hashtags should reflect the role category; experienceBullets should align with required skills to pass ATS filters."
  : ""}
Always respond with ONLY this JSON structure:

{
  "headline": string,
  "about": string,
  "summary": string,
  "strengths": string[],
  "searchKeywords": string[],
  "hashtags": string[],
  "experienceBullets": string[]
}

Rules:
- Headline max ~220 characters, focused on target role & value.
- About: 3–6 short paragraphs, friendly and professional.
- Strengths: 4–8 bullet points.
- Search keywords: recruiter search terms (no #).
- Hashtags: 5–12 best hashtags for this profile (with #).
- Experience bullets: achievement-style bullet lines.
- Do NOT include backticks or any text outside valid JSON.
`.trim();

    // ── User prompt  (enriched with role intelligence) ────
    const userPrompt = `
CURRENT ROLE: ${currentRole || "Not specified"}
TARGET ROLE: ${targetRole  || "Not specified"}
INDUSTRY: ${industry       || "General"}

CANDIDATE CV / BACKGROUND:
${cvText}
${roleSection ? `\n${roleSection}\n` : ""}
Create the LinkedIn profile elements and return JSON only.
`.trim();

    // ── OpenAI call ───────────────────────────────────────
    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
    });

    // ── Parse response  (unchanged logic) ────────────────
    let raw = response.output?.[0]?.content?.[0]?.text ?? "";
    raw = cleanJsonText(raw);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("linkedin-optimizer JSON parse error:", raw);
      return res.status(200).json({
        ok:      false,
        error:   "Failed to parse AI response",
        rawText: raw,
      });
    }

    // ── Response  (shape unchanged) ───────────────────────
    return res.status(200).json({
      ok:                true,
      headline:          parsed.headline          || "",
      about:             parsed.about             || "",
      summary:           parsed.summary           || "",
      strengths:         Array.isArray(parsed.strengths)         ? parsed.strengths         : [],
      searchKeywords:    Array.isArray(parsed.searchKeywords)    ? parsed.searchKeywords    : [],
      hashtags:          Array.isArray(parsed.hashtags)          ? parsed.hashtags          : [],
      experienceBullets: Array.isArray(parsed.experienceBullets) ? parsed.experienceBullets : [],
    });

  } catch (err) {
    console.error("linkedin-optimizer error:", err?.message || err);
    return res.status(500).json({
      ok:    false,
      error: "LinkedIn optimiser failed. Please try again.",
    });
  }
}
