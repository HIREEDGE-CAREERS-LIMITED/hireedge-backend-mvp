// /api/talent-profile.js
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

function pickAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function cleanStr(v, max = 5000) {
  if (v == null) return "";
  const s = typeof v === "string" ? v : String(v);
  return s.trim().slice(0, max);
}

function ensureStringArray(v, maxItems = 30) {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  return arr
    .map((x) => cleanStr(x, 400))
    .filter(Boolean)
    .slice(0, maxItems);
}

/**
 * Strips markdown fences and extracts the first valid JSON object.
 * Falls back to substring extraction on a parse failure.
 * Unchanged from original.
 *
 * @param {string} text
 * @returns {object|null}
 */
function extractJsonObject(text) {
  if (!text) return null;
  const t = text.trim();

  const unfenced = t
    .replace(/^```[a-zA-Z]*\n?/, "")
    .replace(/```$/, "")
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {}

  const firstBrace = unfenced.indexOf("{");
  const lastBrace  = unfenced.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = unfenced.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  return null;
}

/**
 * Normalises the AI output into the guaranteed frontend shape.
 * Unchanged from original.
 *
 * @param {object} parsed
 * @returns {object}
 */
function normalizeOutput(parsed) {
  const out = parsed && typeof parsed === "object" ? parsed : {};

  const title            = cleanStr(out.title || out.roleTitle || out.headline, 120);
  const bio              = cleanStr(out.bio   || out.summary,                   2500);
  const skills           = ensureStringArray(out.skills,                           20);
  const achievements     = ensureStringArray(out.achievements,                     15);
  const expertiseTags    = ensureStringArray(out.expertiseTags || out.tags,         20);
  const linkedinHeadline = cleanStr(out.linkedinHeadline,                         220);
  const seniority        = cleanStr(out.seniority,                                  80);

  return {
    title,
    bio,
    skills,
    achievements,
    expertiseTags,
    linkedinHeadline,
    ...(seniority ? { seniority } : {}),
  };
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
 * Builds the role intelligence prompt section for the talent profile engine.
 * Only emits blocks when data is actually present — never injects empty strings.
 *
 * Includes profile-specific guidance so the model can use each field to:
 *   - title: align to the exact role title from the dataset
 *   - bio: reference category, seniority and required skills
 *   - skills: surface the strongest overlap between CV and role skills
 *   - achievements: align STAR bullets to the role's category and required skills
 *   - expertiseTags: use recruiter search language from the role's required skills
 *   - linkedinHeadline: use the exact role wording plus value proposition
 *   - seniority: use the dataset seniority level directly
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
    "Talent profile guidance from this data:",
    `  - title: use the exact Title "${roleData.title || ""}" unless CV strongly suggests a different level.`,
    `  - seniority: use "${roleData.seniority || ""}" as the seniority value.`,
    `  - bio: reference the Category "${roleData.category || ""}" and Seniority level; weave in Required skills naturally.`,
    "  - skills: prioritise skills that appear in BOTH the CV and the Required skills list above.",
    "  - achievements: frame STAR bullets to demonstrate impact in the context of this role's Category and Required skills.",
    "  - expertiseTags: pull recruiter search terms directly from the Required skills list; keep them 2–3 words max.",
    `  - linkedinHeadline: open with the exact Title "${roleData.title || ""}" then add strongest value proposition from CV.`
  );

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // ── CORS  (unchanged) ─────────────────────────────────────
  const origin       = req.headers.origin;
  const allowedOrigin = pickAllowedOrigin(origin);

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    // ── Input parsing  (unchanged) ────────────────────────
    const fullName           = cleanStr(body.fullName,           120);
    const cvText             = cleanStr(body.cvText,           30000);
    const targetDirection    = cleanStr(body.targetDirection,    200);
    const locationPreference = cleanStr(body.locationPreference, 120);
    const currentRole        = cleanStr(body.currentRole,        120);
    const experienceYears    = cleanStr(body.experienceYears,     30);
    const skillsInput        = Array.isArray(body.skills) ? body.skills : null;

    if (!fullName || !cvText) {
      return res.status(200).json({
        ok:    false,
        error: "fullName and cvText are required",
      });
    }

    // ── Career Intelligence Layer lookup ──────────────────
    //
    //  Use currentRole first; fall back to targetDirection.
    //  On any failure roleData stays null and prompts behave
    //  exactly as before.
    //
    const baseUrl    = getBaseUrl(req);
    const lookupText = currentRole || targetDirection;
    const roleSlug   = slugifyRole(lookupText);
    const roleData   = roleSlug ? await fetchRoleIntelligence(roleSlug, baseUrl) : null;

    const roleSection = buildRoleIntelligenceSection(roleData);

    // ── System prompt  (schema unchanged, enriched guidance) ─
    const systemPrompt = `
You are HireEdge's Smart Talent Profile Engine.
Create a recruiter-ready talent profile card from a CV.
${roleSection
  ? "Use the structured Role Intelligence data provided in the user message to align the output precisely: title and seniority should match the dataset, skills should reflect the overlap between CV and required skills, expertiseTags should use recruiter search language from the required skills list, and the linkedinHeadline should open with the exact role title."
  : ""}
Return ONLY valid JSON (no markdown, no commentary).

JSON schema (required keys):
{
  "title": string,
  "bio": string,
  "skills": string[],
  "achievements": string[],
  "expertiseTags": string[],
  "linkedinHeadline": string,
  "seniority": string (optional)
}

Rules:
- title: best-fit role title (UK market wording). Examples: "Sales Manager", "Retail Store Manager", "Data Analyst", "CRM & Lifecycle Marketing Lead".
- bio: 3 short paragraphs, crisp, no fluff. Mention domain + strengths + tools + outcomes.
- skills: 8–14 strongest skills (mix hard + soft) from CV.
- achievements: 5–9 STAR-style bullets. Prefer numbers (%, £, time saved, growth). If CV lacks numbers, infer conservatively and phrase as "helped", "supported", "contributed".
- expertiseTags: 8–14 short recruiter tags (2–3 words max each). Example: "B2B Sales", "Stakeholder Management", "Retail Operations".
- linkedinHeadline: 120–200 characters, strong and specific, include value proposition + keywords.
- Keep it UK-friendly (spelling + roles). Avoid exaggerated claims.
`.trim();

    // ── User prompt  (enriched with role intelligence) ────
    const userPrompt = `
Full Name: ${fullName}
Target Direction (optional): ${targetDirection || "Not specified"}
Location Preference (optional): ${locationPreference || "Not specified"}

Current Role (optional): ${currentRole || "Not specified"}
Experience Years (optional): ${experienceYears || "Not specified"}
Skills (optional): ${skillsInput ? skillsInput.join(", ") : "Not specified"}

CV Text:
${cvText}
${roleSection ? `\n${roleSection}\n` : ""}
Generate the JSON now.
`.trim();

    // ── OpenAI call ───────────────────────────────────────
    const response = await client.responses.create({
      model:       "gpt-4o-mini",
      temperature: 0.3,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
    });

    // ── Parse response  (unchanged logic) ────────────────
    const rawText = response.output?.[0]?.content?.[0]?.text?.trim() ?? "";
    const parsed  = extractJsonObject(rawText);

    if (!parsed) {
      console.log("Talent profile raw:", rawText);
      return res.status(200).json({
        ok:      false,
        error:   "Failed to parse talent profile JSON",
        rawText: rawText.slice(0, 4000),
      });
    }

    const normalized = normalizeOutput(parsed);

    // Sanity checks  (unchanged)
    if (!normalized.title || !normalized.bio || !normalized.linkedinHeadline) {
      return res.status(200).json({
        ok:      false,
        error:   "Generated output missing required fields",
        rawText: rawText.slice(0, 4000),
      });
    }

    // ── Response  (shape unchanged) ───────────────────────
    return res.status(200).json({
      ok: true,
      ...normalized,
    });

  } catch (err) {
    console.error("Talent Profile Engine Error:", err?.message || err);
    return res.status(200).json({
      ok:    false,
      error: "Talent profile generation failed",
    });
  }
}
