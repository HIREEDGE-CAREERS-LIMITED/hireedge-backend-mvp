// api/skills-matching.js

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const ROLE_INTELLIGENCE_PATH = "/api/role-intelligence";

// ─────────────────────────────────────────────────────────────
// Small pure helpers
// ─────────────────────────────────────────────────────────────

/**
 * Converts a free-text role name or existing slug into a
 * normalised kebab-case slug suitable for role-intelligence lookup.
 *
 * "Senior Data Analyst"  →  "senior-data-analyst"
 * "  UX Designer "       →  "ux-designer"
 * "data-analyst"         →  "data-analyst"  (already a slug)
 *
 * @param {string} value
 * @returns {string}
 */
function slugifyRole(value) {
  if (!value || typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")   // strip punctuation
    .replace(/\s+/g, "-")            // spaces → hyphens
    .replace(/-+/g, "-")             // collapse multiple hyphens
    .replace(/^-+|-+$/g, "");        // trim leading / trailing hyphens
}

/**
 * Attempts to fetch role intelligence from the local
 * role-intelligence endpoint, using the request's own host so
 * it works across local dev and Vercel deployments.
 *
 * Returns the parsed role object on success, or null on any failure.
 * Never throws.
 *
 * @param {string}  slug
 * @param {Request} req   - Incoming request (used to derive base URL)
 * @returns {Promise<object|null>}
 */
async function fetchRoleIntelligence(slug, req) {
  if (!slug) return null;
  try {
    const proto = req.headers["x-forwarded-proto"] || "http";
    const host  = req.headers["x-forwarded-host"]  || req.headers.host || "localhost:3000";
    const url   = `${proto}://${host}${ROLE_INTELLIGENCE_PATH}?slug=${encodeURIComponent(slug)}`;

    const response = await fetch(url, {
      method:  "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) return null;

    const data = await response.json();
    // role-intelligence returns { error: "..." } on not-found / bad input
    if (data?.error) return null;

    return data;
  } catch {
    return null;
  }
}

/**
 * Builds a structured fallback response when no OpenAI key is present.
 * If role intelligence is available it uses the real skills list and
 * provides category / seniority context in the summary.
 *
 * @param {string}      targetRole
 * @param {string}      jobDescription
 * @param {object|null} roleCtx  - Parsed role-intelligence object or null
 * @returns {object}
 */
function buildFallbackFromRole(targetRole, jobDescription, roleCtx) {
  const hasRole      = !!roleCtx;
  const roleSkills   = hasRole && Array.isArray(roleCtx.skills) ? roleCtx.skills : [];
  const displayTitle = hasRole ? (roleCtx.title || targetRole) : targetRole;
  const category     = hasRole ? (roleCtx.category  || "")    : "";
  const seniority    = hasRole ? (roleCtx.seniority || "")    : "";

  const contextLine = [seniority, category].filter(Boolean).join(" · ");

  const missingSkills = roleSkills.length > 0
    ? roleSkills.slice(0, 6)
    : ["stakeholder management", "SQL", "project planning"];

  return {
    ok: true,
    overallFit: 40,
    gapSummary: [
      `OpenAI API key is not configured — returning a structured fallback.`,
      displayTitle   ? `Target role: ${displayTitle}.` : null,
      contextLine    ? `Context: ${contextLine}.`      : null,
      roleSkills.length > 0
        ? `The following skills are typically required for this role and may represent gaps to address.`
        : null,
    ].filter(Boolean).join(" "),
    matchedSkills:       ["communication", "teamwork"],
    partialMatchSkills:  ["analysis"],
    missingSkills,
    learningPlan: missingSkills.slice(0, 2).map((skill) => ({
      skill,
      actions: [
        `Study the fundamentals of ${skill}`,
        `Complete a short online course or certification in ${skill}`,
        `Add a concrete ${skill} achievement to your CV`,
      ],
    })),
    ...(hasRole ? {
      roleContext: {
        slug:      roleCtx.slug,
        title:     displayTitle,
        category,
        seniority,
        salary_uk: roleCtx.salary_uk ?? null,
      },
    } : {}),
    debug: {
      targetRole,
      hasJobDescription: !!jobDescription?.trim(),
      roleIntelligenceFetched: hasRole,
    },
  };
}

/**
 * Formats salary context as a short readable string for the AI prompt.
 * Returns null if no useful data is available.
 *
 * @param {object|null} salary_uk
 * @returns {string|null}
 */
function formatSalaryContext(salary_uk) {
  if (!salary_uk || typeof salary_uk !== "object") return null;
  const { min, max, mean } = salary_uk;
  if (!min && !max && !mean) return null;
  const parts = [];
  if (mean) parts.push(`typical £${mean.toLocaleString("en-GB")}`);
  if (min && max) parts.push(`range £${min.toLocaleString("en-GB")}–£${max.toLocaleString("en-GB")}`);
  return parts.length ? `UK salary: ${parts.join(", ")}` : null;
}

// ─────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // ── Method guard ───────────────────────────────────────────
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const {
      jobDescription = "",
      cvText         = "",
      targetRole     = "",
    } = req.body || {};

    // ── Input validation ──────────────────────────────────────
    if (!cvText.trim()) {
      return res.status(400).json({ ok: false, error: "cvText is required" });
    }

    // ── Role Intelligence lookup ──────────────────────────────
    //
    //  Attempt to enrich the request with structured role data.
    //  This always resolves — failures return null gracefully.
    //
    const roleSlug = slugifyRole(targetRole);
    const roleCtx  = roleSlug
      ? await fetchRoleIntelligence(roleSlug, req)
      : null;

    // ── No OpenAI key: structured fallback ───────────────────
    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json(
        buildFallbackFromRole(targetRole, jobDescription, roleCtx)
      );
    }

    // ── Build enriched prompt ─────────────────────────────────
    //
    //  Role intelligence sections are injected when available so
    //  the model can produce more precise skill gap analysis.
    //
    const roleIntelligenceSection = roleCtx ? [
      `Role Intelligence (structured data):`,
      `  Title:     ${roleCtx.title     || targetRole}`,
      `  Category:  ${roleCtx.category  || ""}`,
      `  Seniority: ${roleCtx.seniority || ""}`,
      roleCtx.skills?.length
        ? `  Required skills: ${roleCtx.skills.join(", ")}`
        : null,
      formatSalaryContext(roleCtx.salary_uk)
        ? `  ${formatSalaryContext(roleCtx.salary_uk)}`
        : null,
      roleCtx.career_paths?.next_roles?.length
        ? `  Typical next roles: ${roleCtx.career_paths.next_roles.slice(0, 3).join(", ")}`
        : null,
    ].filter(Boolean).join("\n") : null;

    const prompt = `
Return STRICT JSON only (no markdown, no explanation) matching this exact schema:
{
  "ok": true,
  "overallFit": number (0–100),
  "gapSummary": string,
  "matchedSkills": string[],
  "partialMatchSkills": string[],
  "missingSkills": string[],
  "learningPlan": [{ "skill": string, "actions": string[] }]
}

Instructions:
- matchedSkills: skills clearly demonstrated in the CV that match the target role
- partialMatchSkills: skills present but not at the required level
- missingSkills: skills required for the role that are absent from the CV
- learningPlan: one entry per missing skill (up to 5), with 2–3 specific, actionable steps each
- overallFit: a realistic percentage based on matched vs required skills
- gapSummary: 2–3 sentence summary of the candidate's readiness for this role
${roleIntelligenceSection
  ? `\n${roleIntelligenceSection}\n`
  : `\nTarget role: ${targetRole}\n`
}
${jobDescription.trim()
  ? `Job Description:\n${jobDescription}\n`
  : ""
}
CV Text:
${cvText}
`.trim();

    // ── Call OpenAI ───────────────────────────────────────────
    const openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model:       process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role:    "system",
            content: "You are an expert skills gap analyst. You always return strict JSON matching the requested schema — no markdown, no extra commentary.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      }),
    });

    const openAiJson = await openAiRes.json();

    if (!openAiRes.ok) {
      return res.status(502).json({
        ok:    false,
        error: "OpenAI request failed",
        detail: openAiJson?.error?.message || "Upstream error",
      });
    }

    // ── Parse model response ──────────────────────────────────
    const content = openAiJson?.choices?.[0]?.message?.content || "";

    // Strip accidental markdown fences before parsing
    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

    let out;
    try {
      out = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({
        ok:    false,
        error: "Model returned invalid JSON",
        raw:   content.slice(0, 500),
      });
    }

    // ── Attach roleContext if available ───────────────────────
    //
    //  Appended as an optional enrichment field — does not alter
    //  any existing keys so the response shape stays stable.
    //
    if (roleCtx) {
      out.roleContext = {
        slug:      roleCtx.slug,
        title:     roleCtx.title     || targetRole,
        category:  roleCtx.category  || null,
        seniority: roleCtx.seniority || null,
        salary_uk: roleCtx.salary_uk ?? null,
      };
    }

    return res.status(200).json(out);

  } catch {
    // Never leak raw stack traces
    return res.status(500).json({
      ok:    false,
      error: "An unexpected error occurred",
    });
  }
}
