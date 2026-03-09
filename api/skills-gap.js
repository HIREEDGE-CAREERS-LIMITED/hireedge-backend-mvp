import OpenAI from "openai";

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
  "https://hireedge.co.uk",
  "https://www.hireedge.co.uk",
];

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function pickAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function cleanStr(v, max = 10000) {
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}

function normalizeSkills(skills) {
  if (!skills) return [];
  if (Array.isArray(skills)) {
    return [...new Set(skills.map((s) => cleanStr(s, 120)).filter(Boolean))];
  }
  if (typeof skills === "string") {
    return [
      ...new Set(
        skills
          .split(/[\n,]+/g)
          .map((s) => cleanStr(s, 120))
          .filter(Boolean)
      ),
    ];
  }
  return [];
}

function cleanJsonText(raw) {
  let text = cleanStr(raw, 50000);
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return text;
}

function safeParseJson(raw) {
  const text = cleanJsonText(raw);
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { ok: false, rawText: text };
    try {
      return { ok: true, data: JSON.parse(match[0]) };
    } catch {
      return { ok: false, rawText: text };
    }
  }
}

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

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  return `${proto}://${host}`;
}

async function fetchRoleIntelligence(slug, baseUrl) {
  if (!slug) return null;
  try {
    const res = await fetch(
      `${baseUrl}/api/role-intelligence?slug=${encodeURIComponent(slug)}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.error ? null : data;
  } catch {
    return null;
  }
}

function normalizeForCompare(value) {
  return cleanStr(value, 200)
    .toLowerCase()
    .replace(/[&/()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAliasMap() {
  return {
    sql: ["sql", "mysql", "postgresql", "postgres", "tsql"],
    excel: ["excel", "microsoft excel", "advanced excel"],
    python: ["python", "python scripting"],
    tableau: ["tableau"],
    "power bi": ["power bi", "powerbi"],
    statistics: ["statistics", "statistical analysis", "statistical methods"],
    "data visualization": ["data visualization", "data visualisation", "visualization", "visualisation"],
    "data storytelling": ["data storytelling", "storytelling", "data story telling"],
    dashboards: ["dashboard", "dashboards", "dashboarding"],
    "stakeholder communication": [
      "stakeholder communication",
      "stakeholder management",
      "stakeholder engagement",
      "communicating with stakeholders",
    ],
    bigquery: ["bigquery", "google bigquery"],
    snowflake: ["snowflake"],
    "a/b testing": ["a/b testing", "ab testing", "split testing", "experimentation"],
    "machine learning": ["machine learning", "ml"],
    etl: ["etl", "data pipelines", "pipeline automation", "data pipeline"],
    "data warehousing": ["data warehousing", "data warehouse", "warehouse"],
  };
}

function skillPresent(skill, text, providedSkills = []) {
  const normSkill = normalizeForCompare(skill);
  const aliases = buildAliasMap()[normSkill] || [normSkill];

  const normProvided = providedSkills.map(normalizeForCompare);
  const normText = normalizeForCompare(text);

  const matchedProvided = aliases.some((a) => normProvided.includes(normalizeForCompare(a)));
  const matchedText = aliases.some((a) => normText.includes(normalizeForCompare(a)));

  return matchedProvided || matchedText;
}

function classifySkills(requiredSkills, cvText, providedSkills) {
  const matched = [];
  const missing = [];
  const partial = [];

  for (const skill of requiredSkills) {
    const normSkill = normalizeForCompare(skill);
    const inProvidedExact = providedSkills
      .map(normalizeForCompare)
      .includes(normSkill);

    const present = skillPresent(skill, cvText, providedSkills);

    if (inProvidedExact) {
      matched.push(skill);
    } else if (present) {
      partial.push(skill);
    } else {
      missing.push(skill);
    }
  }

  return {
    matchedSkills: [...new Set(matched)],
    partialMatchSkills: [...new Set(partial)],
    missingSkills: [...new Set(missing)],
  };
}

function calculateFitScore(requiredSkills, matchedSkills, partialMatchSkills) {
  if (!requiredSkills.length) return 0;
  const matchedWeight = matchedSkills.length;
  const partialWeight = partialMatchSkills.length * 0.5;
  const score = ((matchedWeight + partialWeight) / requiredSkills.length) * 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildDeterministicActions(missingSkills) {
  return missingSkills.slice(0, 6).map((skill) => ({
    skill,
    actions: [
      `Take a focused course or guided learning path in ${skill}.`,
      `Build a small portfolio project demonstrating ${skill}.`,
      `Add evidence of ${skill} in CV, LinkedIn, or case-study format once completed.`,
    ],
  }));
}

function buildFallbackSummary(targetRole, fit, matchedSkills, missingSkills) {
  if (fit >= 75) {
    return `The candidate is a strong fit for ${targetRole}, with most core skills already present. Focus on strengthening the remaining gaps to become fully competitive.`;
  }
  if (fit >= 45) {
    return `The candidate has partial alignment for ${targetRole}. There is a solid foundation, but several important skill gaps should be addressed before becoming fully competitive.`;
  }
  return `The candidate currently has limited alignment for ${targetRole}. Significant skill development is needed across the key requirements before they will be strongly matched for this role.`;
}

function formatSalary(salary_uk) {
  if (!salary_uk || typeof salary_uk !== "object") return null;
  const { min, max, mean } = salary_uk;
  if (!min && !max && !mean) return null;
  const parts = [];
  if (mean) parts.push(`typical £${mean.toLocaleString("en-GB")}`);
  if (min && max) parts.push(`range £${min.toLocaleString("en-GB")}–£${max.toLocaleString("en-GB")}`);
  return parts.join(", ");
}

// ─────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin;
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

    const targetRole = cleanStr(body.targetRole, 150);
    const cvText = cleanStr(body.cvText, 30000);
    const providedSkills = normalizeSkills(body.skills);

    if (!targetRole) {
      return res.status(200).json({
        ok: false,
        error: "targetRole is required",
      });
    }

    if (!cvText && providedSkills.length === 0) {
      return res.status(200).json({
        ok: false,
        error: "Provide cvText or skills for skills gap analysis",
      });
    }

    // Fetch structured role intelligence
    const baseUrl = getBaseUrl(req);
    const slug = slugifyRole(targetRole);
    const roleData = await fetchRoleIntelligence(slug, baseUrl);

    if (!roleData || !Array.isArray(roleData.skills) || roleData.skills.length === 0) {
      return res.status(200).json({
        ok: false,
        error: `No structured role intelligence found for "${targetRole}"`,
      });
    }

    const requiredSkills = roleData.skills;
    const { matchedSkills, partialMatchSkills, missingSkills } = classifySkills(
      requiredSkills,
      cvText,
      providedSkills
    );

    const overallFit = calculateFitScore(requiredSkills, matchedSkills, partialMatchSkills);
    const salaryContext = formatSalary(roleData.salary_uk);

    // Fallback deterministic result if no OpenAI key
    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        ok: true,
        targetRole: roleData.title || targetRole,
        category: roleData.category || "",
        seniority: roleData.seniority || "",
        salaryContext,
        overallFit,
        requiredSkills,
        matchedSkills,
        partialMatchSkills,
        missingSkills,
        gapSummary: buildFallbackSummary(roleData.title || targetRole, overallFit, matchedSkills, missingSkills),
        recommendations: buildDeterministicActions(missingSkills),
      });
    }

    const systemPrompt = `
You are the "HireEdge Skills Match & Gap Engine".

Return ONLY valid JSON in this exact structure:

{
  "gapSummary": string,
  "overallFit": number,
  "matchedSkills": string[],
  "partialMatchSkills": string[],
  "missingSkills": string[],
  "recommendations": [
    {
      "skill": string,
      "actions": string[]
    }
  ]
}

Rules:
- Use the structured role intelligence data as the source of truth for required skills.
- overallFit must be a number from 0 to 100.
- matchedSkills should only include skills clearly evidenced.
- partialMatchSkills should include skills indirectly evidenced or adjacent.
- missingSkills should include important required skills not clearly present.
- recommendations should prioritise the biggest gaps first.
- Keep it practical, UK job-market relevant, and concise.
- No markdown, no backticks, no commentary outside JSON.
`.trim();

    const userPrompt = `
TARGET ROLE:
${roleData.title || targetRole}

ROLE INTELLIGENCE:
Category: ${roleData.category || "Not specified"}
Seniority: ${roleData.seniority || "Not specified"}
Required skills: ${requiredSkills.join(", ")}
${salaryContext ? `Salary context: ${salaryContext}` : ""}

CANDIDATE PROVIDED SKILLS:
${providedSkills.length ? providedSkills.join(", ") : "Not provided"}

CANDIDATE CV TEXT:
${cvText || "Not provided"}

Deterministic comparison result already computed:
Matched skills: ${matchedSkills.join(", ") || "None"}
Partial match skills: ${partialMatchSkills.join(", ") || "None"}
Missing skills: ${missingSkills.join(", ") || "None"}
Initial fit score: ${overallFit}

Return JSON only.
`.trim();

    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw =
      (typeof response.output_text === "string" && response.output_text.trim()) ||
      response.output?.[0]?.content?.[0]?.text?.trim() ||
      "";

    const parsedRes = safeParseJson(raw);

    if (!parsedRes.ok) {
      return res.status(200).json({
        ok: true,
        targetRole: roleData.title || targetRole,
        category: roleData.category || "",
        seniority: roleData.seniority || "",
        salaryContext,
        overallFit,
        requiredSkills,
        matchedSkills,
        partialMatchSkills,
        missingSkills,
        gapSummary: buildFallbackSummary(roleData.title || targetRole, overallFit, matchedSkills, missingSkills),
        recommendations: buildDeterministicActions(missingSkills),
      });
    }

    const parsed = parsedRes.data || {};

    return res.status(200).json({
      ok: true,
      targetRole: roleData.title || targetRole,
      category: roleData.category || "",
      seniority: roleData.seniority || "",
      salaryContext,
      overallFit:
        typeof parsed.overallFit === "number" ? parsed.overallFit : overallFit,
      requiredSkills,
      matchedSkills: Array.isArray(parsed.matchedSkills) ? parsed.matchedSkills : matchedSkills,
      partialMatchSkills: Array.isArray(parsed.partialMatchSkills)
        ? parsed.partialMatchSkills
        : partialMatchSkills,
      missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills : missingSkills,
      gapSummary: cleanStr(parsed.gapSummary, 1200) || buildFallbackSummary(roleData.title || targetRole, overallFit, matchedSkills, missingSkills),
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations.slice(0, 8)
        : buildDeterministicActions(missingSkills),
    });
  } catch (err) {
    console.error("skills-gap error:", err?.message || err);
    return res.status(200).json({
      ok: false,
      error: "Skills gap engine failed",
    });
  }
}
