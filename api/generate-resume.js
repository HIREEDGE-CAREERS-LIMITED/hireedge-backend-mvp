// /api/generate-resume.js
import OpenAI from "openai";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
  "https://hireedge.co.uk",
  "https://www.hireedge.co.uk",
];

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────────────────────
// Career Intelligence Layer helpers
// ─────────────────────────────────────────────────────────────

/**
 * Strips markdown code fences from a raw model string and trims whitespace.
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
 * Scans a job description for a recognisable role keyword and returns
 * the matching slug, or null if nothing matches.
 *
 * Ordered from most-specific to least-specific so longer phrases match
 * before their sub-phrases (e.g. "data scientist" before plain "data").
 *
 * @param {string} jobDescription
 * @returns {string|null}
 */
function detectRoleFromText(jobDescription) {
  if (!jobDescription || typeof jobDescription !== "string") return null;

  const text = jobDescription.toLowerCase();

  const ROLE_KEYWORDS = [
    // Data & AI
    ["machine learning engineer",   "machine-learning-engineer"],
    ["ml engineer",                 "machine-learning-engineer"],
    ["data scientist",              "data-scientist"],
    ["data engineer",               "data-engineer"],
    ["data analyst",                "data-analyst"],
    ["business intelligence",       "business-intelligence-analyst"],
    ["bi analyst",                  "business-intelligence-analyst"],
    ["analytics engineer",          "analytics-engineer"],
    ["ai engineer",                 "ai-engineer"],
    ["mlops engineer",              "mlops-engineer"],
    // Software Engineering
    ["software engineer",           "software-engineer"],
    ["software developer",          "software-engineer"],
    ["full stack",                  "full-stack-developer"],
    ["fullstack",                   "full-stack-developer"],
    ["frontend developer",          "frontend-developer"],
    ["front-end developer",         "frontend-developer"],
    ["backend developer",           "backend-developer"],
    ["back-end developer",          "backend-developer"],
    ["devops engineer",             "devops-engineer"],
    ["cloud engineer",              "cloud-engineer"],
    ["site reliability",            "site-reliability-engineer"],
    ["mobile developer",            "mobile-app-developer"],
    ["ios developer",               "ios-developer"],
    ["android developer",           "android-developer"],
    ["qa engineer",                 "qa-engineer"],
    // Product & Project
    ["product manager",             "product-manager"],
    ["product owner",               "product-owner"],
    ["project manager",             "project-manager"],
    ["programme manager",           "program-manager"],
    ["scrum master",                "scrum-master"],
    // Design & Creative
    ["ux designer",                 "ux-designer"],
    ["ui designer",                 "ui-designer"],
    ["product designer",            "product-designer"],
    ["graphic designer",            "graphic-designer"],
    // Marketing
    ["marketing manager",           "marketing-manager"],
    ["digital marketing",           "digital-marketing-manager"],
    ["seo specialist",              "seo-specialist"],
    ["content strategist",          "content-strategist"],
    ["growth manager",              "growth-manager"],
    // Sales
    ["sales manager",               "sales-manager"],
    ["account executive",           "account-executive"],
    ["business development",        "business-development-manager"],
    ["customer success manager",    "customer-success-manager"],
    ["solutions engineer",          "solutions-engineer"],
    // Finance & Accounting
    ["financial analyst",           "financial-analyst"],
    ["management accountant",       "management-accountant"],
    ["finance manager",             "finance-manager"],
    ["fp&a",                        "fp-and-a-analyst"],
    ["fp and a",                    "fp-and-a-analyst"],
    // HR & People
    ["hr manager",                  "hr-manager"],
    ["people operations",           "people-operations-manager"],
    ["talent acquisition",          "talent-acquisition-specialist"],
    ["recruiter",                   "recruitment-consultant"],
    // Operations
    ["operations manager",          "operations-manager"],
    ["supply chain",                "supply-chain-analyst"],
    ["procurement manager",         "procurement-specialist"],
    ["logistics",                   "logistics-coordinator"],
    // Legal & Compliance
    ["compliance officer",          "compliance-officer"],
    ["legal counsel",               "legal-counsel"],
    ["data protection officer",     "data-protection-officer"],
    // Cybersecurity
    ["security engineer",           "security-engineer"],
    ["penetration tester",          "penetration-tester"],
    ["cybersecurity analyst",       "cyber-security-analyst"],
    // Executive
    ["chief technology officer",    "chief-technology-officer"],
    ["cto",                         "chief-technology-officer"],
    ["chief data officer",          "chief-data-officer"],
    ["chief product officer",       "chief-product-officer"],
    ["head of engineering",         "head-of-engineering"],
    ["engineering manager",         "engineering-manager"],
  ];

  for (const [keyword, slug] of ROLE_KEYWORDS) {
    if (text.includes(keyword)) return slug;
  }

  return null;
}

/**
 * Builds the role intelligence prompt section for the ATS/resume engine.
 * Only emits blocks when data is actually present.
 *
 * Includes ATS-specific guidance so the model can use the data to:
 *   - atsScore: weight both JD match AND role intelligence skill coverage
 *   - matchedKeywords: include role skills present in the CV
 *   - missingKeywords: flag important role skills absent from the CV
 *   - optimisedResume: use exact role title, category language, required skills
 *   - summary: explain fit in terms of role category and seniority expectations
 *   - suggestions: tie improvement actions to required skills and seniority level
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

  lines.push(
    "",
    "ATS optimisation guidance from this data:",
    "  - atsScore: factor in BOTH keyword match from the job description AND coverage of Required skills above.",
    "  - matchedKeywords: include any Required skills that also appear in the candidate CV.",
    "  - missingKeywords: flag Required skills that are absent from the CV — even if not literally in the JD.",
    `  - optimisedResume: use the exact Title "${roleData.title || ""}" and weave in Required skills as natural CV language.`,
    `  - summary: describe the candidate's fit in terms of the Category "${roleData.category || ""}" and ${roleData.seniority || "the"} seniority expectations.`,
    `  - suggestions: make improvement actions specific to Required skills and ${roleData.seniority || "the"} seniority level.`
  );

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // ── CORS  (unchanged) ─────────────────────────────────────
  const origin        = req.headers.origin;
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
    const { jobDescription, cvText } = req.body || {};

    if (!jobDescription || !cvText) {
      return res.status(200).json({
        ok:    false,
        error: "jobDescription and cvText are required",
      });
    }

    // ── Career Intelligence Layer lookup ──────────────────
    //
    //  Try to detect the target role from the job description,
    //  then fetch structured role data. Both steps fail silently —
    //  if either returns null the prompts fall back to original
    //  behaviour unchanged.
    //
    const baseUrl      = getBaseUrl(req);
    const detectedSlug = detectRoleFromText(jobDescription);
    const roleData     = await fetchRoleIntelligence(detectedSlug, baseUrl);
    const roleSection  = buildRoleIntelligenceSection(roleData);

    // ── System prompt  (schema unchanged, enriched guidance) ─
    const systemPrompt = `
You are the "HireEdge AI Resume & ATS Engine".
Your job:
- Analyse the job description and the candidate's CV.
- Optimise the CV for ATS and recruiter readability.
- Score ATS match from 0–100.
- Identify matched and missing keywords.
${roleSection
  ? "Use the structured Role Intelligence data provided to make your analysis more precise: atsScore should reflect both JD and role skill coverage; missingKeywords should include important required skills absent from the CV even if not literally in the JD; optimisedResume should use exact role title and required skills as natural CV language."
  : ""}
- Return ONLY valid JSON matching this EXACT structure:

{
  "atsScore": number,
  "matchedKeywords": string[],
  "missingKeywords": string[],
  "optimisedResume": string,
  "summary": string,
  "suggestions": string[]
}

NO markdown, NO backticks, NO text outside JSON.
`.trim();

    // ── User prompt  (enriched with role intelligence) ────
    const userPrompt = `
JOB DESCRIPTION:
${jobDescription}

CANDIDATE CV:
${cvText}
${roleSection ? `\n${roleSection}\n` : ""}
Analyse and return JSON only.
`.trim();

    // ── OpenAI call ───────────────────────────────────────
    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
    });

    // ── Safe parsing  (original two-pass logic, now uses cleanJsonText) ──
    let raw = cleanJsonText(
      response.output?.[0]?.content?.[0]?.text?.trim() ?? ""
    );

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          console.error("JSON parse error (inner) for resume engine:", raw);
          return res.status(200).json({
            ok:      false,
            error:   "Failed to parse AI response",
            rawText: raw,
          });
        }
      } else {
        console.error("JSON parse error for resume engine:", raw);
        return res.status(200).json({
          ok:      false,
          error:   "Failed to parse AI response",
          rawText: raw,
        });
      }
    }

    // ── Response  (shape unchanged) ───────────────────────
    return res.status(200).json({
      ok:               true,
      atsScore:         parsed.atsScore         ?? null,
      matchedKeywords:  parsed.matchedKeywords  || [],
      missingKeywords:  parsed.missingKeywords  || [],
      optimisedResume:  parsed.optimisedResume  || "",
      summary:          parsed.summary          || "",
      suggestions:      parsed.suggestions      || [],
    });

  } catch (err) {
    console.error("generate-resume error:", err?.message || err);
    return res.status(200).json({
      ok:    false,
      error: "Resume engine failed. Please try again.",
    });
  }
}
