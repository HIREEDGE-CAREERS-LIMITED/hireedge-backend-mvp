// /api/visa-pathway.js
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
// Career Intelligence Layer helpers
// ─────────────────────────────────────────────────────────────

/**
 * Derives the base URL for internal API calls from the incoming
 * request's headers. Works across local dev and Vercel deployments.
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
 * Scans a free-text profile string for a recognisable role slug.
 *
 * Strategy: we look for known role keywords in order of specificity.
 * The first match wins. Extend the ROLE_KEYWORDS map to cover new roles.
 * Returns a slug string (e.g. "data-analyst") or null if nothing matches.
 *
 * @param {string} profile
 * @returns {string|null}
 */
function detectRole(profile) {
  if (!profile || typeof profile !== "string") return null;

  const text = profile.toLowerCase();

  // Ordered from most-specific to least-specific so longer phrases
  // are matched before their sub-phrases (e.g. "data scientist"
  // before plain "data").
  const ROLE_KEYWORDS = [
    // Data & AI
    ["machine learning engineer",   "machine-learning-engineer"],
    ["ml engineer",                 "machine-learning-engineer"],
    ["data scientist",              "data-scientist"],
    ["data engineer",               "data-engineer"],
    ["data analyst",                "data-analyst"],
    ["business intelligence",       "business-intelligence-analyst"],
    ["bi analyst",                  "business-intelligence-analyst"],
    ["ai engineer",                 "ai-engineer"],
    ["nlp engineer",                "nlp-engineer"],
    ["mlops",                       "mlops-engineer"],
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
    ["mobile developer",            "mobile-app-developer"],
    ["ios developer",               "ios-developer"],
    ["android developer",           "android-developer"],
    ["qa engineer",                 "qa-engineer"],
    ["site reliability",            "site-reliability-engineer"],
    // Product & Project
    ["product manager",             "product-manager"],
    ["product owner",               "product-owner"],
    ["project manager",             "project-manager"],
    ["scrum master",                "scrum-master"],
    ["program manager",             "program-manager"],
    // Design & Creative
    ["ux designer",                 "ux-designer"],
    ["ui designer",                 "ui-designer"],
    ["product designer",            "product-designer"],
    ["graphic designer",            "graphic-designer"],
    // Marketing
    ["marketing manager",           "marketing-manager"],
    ["digital marketing",           "digital-marketing-manager"],
    ["seo specialist",              "seo-specialist"],
    ["content marketing",           "content-marketing-manager"],
    // Sales
    ["sales manager",               "sales-manager"],
    ["account executive",           "account-executive"],
    ["business development",        "business-development-manager"],
    ["customer success",            "customer-success-manager"],
    // Finance & Accounting
    ["financial analyst",           "financial-analyst"],
    ["data accountant",             "accountant"],
    ["accountant",                  "accountant"],
    ["finance manager",             "finance-manager"],
    // HR & People
    ["hr manager",                  "hr-manager"],
    ["people operations",           "people-operations-manager"],
    ["talent acquisition",          "talent-acquisition-specialist"],
    ["recruiter",                   "recruitment-consultant"],
    // Operations
    ["operations manager",          "operations-manager"],
    ["supply chain",                "supply-chain-analyst"],
    ["procurement",                 "procurement-specialist"],
    // Legal & Compliance
    ["compliance officer",          "compliance-officer"],
    ["legal counsel",               "legal-counsel"],
    // Cybersecurity
    ["security engineer",           "security-engineer"],
    ["penetration tester",          "penetration-tester"],
    ["cybersecurity analyst",       "cyber-security-analyst"],
    // Executive
    ["chief technology officer",    "chief-technology-officer"],
    ["cto",                         "chief-technology-officer"],
    ["chief data officer",          "chief-data-officer"],
    ["chief product officer",       "chief-product-officer"],
  ];

  for (const [keyword, slug] of ROLE_KEYWORDS) {
    if (text.includes(keyword)) return slug;
  }

  return null;
}

/**
 * Fetches role intelligence for a detected slug.
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
 * Builds the role intelligence prompt section.
 * Only emitted when data is actually available — never injects empty strings.
 *
 * @param {object} roleData  - Parsed role-intelligence response
 * @returns {string}
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
    lines.push(`  Key skills: ${roleData.skills.join(", ")}`);
  }

  const salary = formatSalary(roleData.salary_uk);
  if (salary) {
    lines.push(`  UK Salary:  ${salary}`);
  }

  if (roleData.career_paths?.next_roles?.length) {
    lines.push(`  Typical next roles: ${roleData.career_paths.next_roles.slice(0, 3).join(", ")}`);
  }

  lines.push(
    "",
    "Use the salary and category above to assess whether this role qualifies for",
    "points-based or skilled worker routes, and to strengthen specific visa recommendations."
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
    const { profile, targetCountry, goal } = req.body || {};

    if (!profile) {
      return res.status(200).json({ ok: false, error: "Profile summary is required" });
    }

    // ── Career Intelligence Layer lookup ──────────────────
    //
    //  Try to detect a role from the profile text, then fetch
    //  structured intelligence for it. Both steps fail silently
    //  — if either returns null the prompts fall back to the
    //  original behaviour unchanged.
    //
    const baseUrl        = getBaseUrl(req);
    const detectedSlug   = detectRole(profile);
    const roleData       = await fetchRoleIntelligence(detectedSlug, baseUrl);
    const roleSection    = buildRoleIntelligenceSection(roleData);

    // ── System prompt  (unchanged) ───────────────────────
    const systemPrompt = `
You are the "HireEdge Visa Pathway Engine".
Task:
- Analyse a candidate's profile and high-level goals.
- Suggest realistic visa / immigration pathways.
- Focus on clarity & practicality (NOT legal advice).
${roleSection
  ? "Where role intelligence data is provided, use the salary, category, and skills to reason more accurately about visa route eligibility (e.g. salary thresholds for Skilled Worker, SOC codes for points-based systems)."
  : ""}
Always respond ONLY with this JSON:
{
  "targetCountry": string,
  "goal": string,
  "bestRoute": {
    "name": string,
    "summary": string,
    "whyGoodFit": string,
    "keyRequirements": string[],
    "risksOrLimitations": string[],
    "nextSteps": string[]
  },
  "alternativeRoutes": [
    {
      "name": string,
      "summary": string,
      "whenToUse": string,
      "keyRequirements": string[]
    }
  ],
  "disclaimer": string
}
Guidelines:
- Use country-specific visa names when possible (e.g. UK Skilled Worker, UK Graduate, UK Innovator Founder, Canada Express Entry etc.), but only where they fit.
- Don't invent impossible paths.
- Disclaimer must say this is information only, not legal advice.
- Do NOT include backticks or any extra explanation outside JSON.
`.trim();

    // ── User prompt  (enriched with role intelligence) ────
    const userPrompt = `
CANDIDATE PROFILE:
${profile}

TARGET COUNTRY:
${targetCountry || "UK"}

GOAL (work, study, startup, family etc.):
${goal || "work"}
${roleSection ? `\n${roleSection}\n` : ""}
Return JSON only.
`.trim();

    // ── OpenAI call  (model fixed to gpt-4o-mini) ─────────
    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
    });

    // ── Parse response  (unchanged logic) ────────────────
    let raw = response.output?.[0]?.content?.[0]?.text?.trim() ?? "";
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("visa-pathway JSON parse error:", raw);
      return res.status(200).json({
        ok:      false,
        error:   "Failed to parse AI response",
        rawText: raw,
      });
    }

    // ── Response  (shape unchanged) ───────────────────────
    const result = {
      ok:               true,
      targetCountry:    parsed.targetCountry    || targetCountry || "UK",
      goal:             parsed.goal             || goal          || "",
      bestRoute:        parsed.bestRoute        || null,
      alternativeRoutes: parsed.alternativeRoutes || [],
      disclaimer:       parsed.disclaimer       ||
        "This is general information only and is not legal or immigration advice.",
    };

    return res.status(200).json(result);

  } catch (err) {
    console.error("visa-pathway error:", err?.message || err);
    return res.status(200).json({
      ok:    false,
      error: "Visa pathway engine failed",
    });
  }
}
