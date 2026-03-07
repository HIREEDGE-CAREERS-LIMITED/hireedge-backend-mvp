import OpenAI from "openai";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const FIXED_ORIGINS = [
  "https://hireedge.co.uk",
  "https://www.hireedge.co.uk",
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
];

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  let allowedOrigin = FIXED_ORIGINS[0];

  if (origin && (FIXED_ORIGINS.includes(origin) || origin.endsWith(".vercel.app"))) {
    allowedOrigin = origin;
  }

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
}

// ─────────────────────────────────────────────────────────────
// JSON parsing helper
// ─────────────────────────────────────────────────────────────

function safeParseJson(raw) {
  let text = (raw || "").trim();

  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return { ok: true, data: JSON.parse(match[0]) };
      } catch {
        return { ok: false, raw: text };
      }
    }
    return { ok: false, raw: text };
  }
}

// ─────────────────────────────────────────────────────────────
// Career Intelligence Layer helpers
// ─────────────────────────────────────────────────────────────

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

async function fetchSkillsMatching(payload, baseUrl, authHeader) {
  try {
    const res = await fetch(`${baseUrl}/api/skills-matching`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data?.ok ? data : null;
  } catch {
    return null;
  }
}

async function fetchCareerRoadmap(payload, baseUrl, authHeader) {
  try {
    const res = await fetch(`${baseUrl}/api/career-roadmap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data?.ok ? data : null;
  } catch {
    return null;
  }
}

function formatSalary(salary_uk) {
  if (!salary_uk || typeof salary_uk !== "object") return null;
  const { min, max, mean } = salary_uk;
  if (!min && !max && !mean) return null;

  const parts = [];
  if (mean) parts.push(`typical £${mean.toLocaleString("en-GB")}`);
  if (min && max) parts.push(`range £${min.toLocaleString("en-GB")}–£${max.toLocaleString("en-GB")}`);

  return parts.length ? parts.join(", ") : null;
}

function buildPackContextSection({ roleData, skillsData, roadmapData }) {
  const lines = [];

  if (roleData) {
    lines.push("TARGET ROLE INTELLIGENCE (structured data from HireEdge dataset):");
    lines.push(`  Title:     ${roleData.title || ""}`);
    lines.push(`  Category:  ${roleData.category || ""}`);
    lines.push(`  Seniority: ${roleData.seniority || ""}`);
    if (roleData.skills?.length) {
      lines.push(`  Required skills: ${roleData.skills.join(", ")}`);
    }
    const sal = formatSalary(roleData.salary_uk);
    if (sal) lines.push(`  UK Salary: ${sal}`);
    if (roleData.career_paths?.next_roles?.length) {
      lines.push(`  Typical next roles: ${roleData.career_paths.next_roles.slice(0, 4).join(", ")}`);
    }
    if (roleData.career_paths?.previous_roles?.length) {
      lines.push(`  Common entry routes: ${roleData.career_paths.previous_roles.slice(0, 3).join(", ")}`);
    }
    lines.push("");
  }

  if (skillsData) {
    lines.push("SKILLS GAP ANALYSIS (from HireEdge Skills Matching engine):");
    if (skillsData.overallFit != null) {
      lines.push(`  Overall fit: ${skillsData.overallFit}%`);
    }
    if (skillsData.gapSummary) {
      lines.push(`  Summary: ${skillsData.gapSummary}`);
    }
    if (skillsData.matchedSkills?.length) {
      lines.push(`  Matched skills: ${skillsData.matchedSkills.join(", ")}`);
    }
    if (skillsData.partialMatchSkills?.length) {
      lines.push(`  Partial matches: ${skillsData.partialMatchSkills.join(", ")}`);
    }
    if (skillsData.missingSkills?.length) {
      lines.push(`  Missing skills: ${skillsData.missingSkills.join(", ")}`);
    }
    lines.push("");
  }

  if (roadmapData?.roadmap) {
    const rm = roadmapData.roadmap;
    lines.push("CAREER ROADMAP (from HireEdge Roadmap engine):");
    if (rm.summary) lines.push(`  Summary: ${rm.summary}`);
    if (rm.timeframe_months) lines.push(`  Timeframe: ${rm.timeframe_months} months`);
    if (rm.skills_in_order?.length) {
      lines.push(`  Key skills in order: ${rm.skills_in_order.slice(0, 8).join(", ")}`);
    }
    if (rm.target_roles?.length) {
      lines.push(`  Target roles: ${rm.target_roles.join(", ")}`);
    }
    lines.push("");

    if (roadmapData.role_path?.path?.length) {
      lines.push(`STRUCTURED PATH: ${roadmapData.role_path.path.join(" → ")}`);
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

// ─────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    const {
      fullName,
      currentRole,
      targetRole,
      yearsExperience,
      sector,
      location,
      jobDescription,
      jobText,
      cvText,
      careerGoal,
      visaStatus,
      targetCountry,
      visaMainGoal,
      gapDetails,
      profileHighlights,
      preferredSectors,
      salaryRange,
    } = body;

    if (!cvText) {
      return res.status(400).json({
        ok: false,
        error: "cvText is required for analysis",
      });
    }

    const safeFullName = fullName || "Candidate";
    const safeCurrent = currentRole || "Not specified";
    const safeTarget = targetRole || "Not specified";
    const safeYears = yearsExperience || "Not specified";
    const safeSector = sector || "Not specified";
    const safeLocation = location || "Not specified";
    const safeJobDesc = jobDescription || jobText || "Not provided";
    const safeGoal = careerGoal || "Not specified";
    const safeVisaStatus = visaStatus || "Not specified";
    const safeTargetCtry = targetCountry || "UK";
    const safeVisaGoal = visaMainGoal || "Work on a sponsored skilled role";
    const safeGapDetails =
      gapDetails || "Candidate has no major career gaps or prefers not to highlight them.";
    const safeHighlights =
      profileHighlights || "Use the CV to infer strengths, achievements and impact.";
    const safePrefSectors = preferredSectors || safeSector;
    const safeSalary = salaryRange || "Not specified";

    const baseUrl = getBaseUrl(req);
    const authHeader = req.headers.authorization || "";
    const targetSlug = slugifyRole(safeTarget);

    const derivedSkills =
      Array.isArray(body.skills) && body.skills.length
        ? body.skills
        : [safeCurrent, safeSector].filter((s) => s && s !== "Not specified");

    const [roleData, skillsData, roadmapData] = await Promise.all([
      fetchRoleIntelligence(targetSlug, baseUrl),
      cvText
        ? fetchSkillsMatching(
            {
              targetRole: safeTarget,
              cvText,
              jobDescription: safeJobDesc,
            },
            baseUrl,
            authHeader
          )
        : Promise.resolve(null),
      safeCurrent !== "Not specified" && safeTarget !== "Not specified"
        ? fetchCareerRoadmap(
            {
              currentRole: safeCurrent,
              targetRole: safeTarget,
              yearsExperience: safeYears,
              skills: derivedSkills,
            },
            baseUrl,
            authHeader
          )
        : Promise.resolve(null),
    ]);

    const enginesUsed = [
      roleData ? "role-intelligence" : null,
      skillsData ? "skills-matching" : null,
      roadmapData ? "career-roadmap" : null,
    ].filter(Boolean);

    const intelligenceSection = buildPackContextSection({
      roleData,
      skillsData,
      roadmapData,
    });

    const systemPrompt = `
You are HireEdge's One-Click Career Pack Engine.

Behave like ALL 8 HireEdge AI engines at once AND the One-Click Career Pack
summary. You must output a SINGLE JSON object that powers:

- The /pack page (combined view)
- The individual engine pages
- The dashboard summary

You MUST return ONLY valid JSON with this EXACT structure and keys:

{
  "ok": true,

  "pack": {
    "title": string,
    "subtitle": string,
    "highlights": string[],
    "next_steps": string[]
  },

  "ats": {
    "match": boolean,
    "gaps": string[],
    "recommendations": string[]
  },

  "skills": {
    "explicit": string[],
    "missing": string[],
    "development_plan": string[]
  },

  "roadmap": {
    "summary": string,
    "immediate": string[],
    "short_term": string[],
    "long_term": string[]
  },

  "linkedin": {
    "headline": string,
    "summary": string,
    "skills": string[],
    "experience_bullets": string[]
  },

  "interview": {
    "role_summary": string,
    "tips": string[],
    "example_questions": string[],
    "sample_answers": string[]
  },

  "visa": {
    "status": string,
    "best_fit_route": string,
    "key_requirements": string[],
    "risks": string[],
    "next_steps": string[],
    "alternative_routes": string[]
  },

  "profile": {
    "headline": string,
    "summary": string,
    "strengths": string[],
    "sectors": string[],
    "ideal_roles": string[],
    "key_contributions": string[]
  },

  "gap": {
    "scenario": string,
    "cv_line": string,
    "interview_answer": string,
    "email_to_recruiter": string
  },

  "resume": {
    "summary": string,
    "improvements": string[],
    "ats_score_before": number,
    "ats_score_after": number,
    "keywords_added": string[],
    "rewritten_resume": string
  }
}

ENGINE MAPPING:
- "pack"     -> One-Click Career Pack main summary (top of /pack page).
- "ats"      -> ATS Resume Optimiser (/resume + pack section).
- "skills"   -> Skills Match & Gap (/skills + pack section).
- "roadmap"  -> 3-stage AI Career Roadmap (/roadmap + pack section).
- "linkedin" -> LinkedIn Profile Optimiser (/linkedin + pack section).
- "interview"-> AI Interview Prep Coach (/interview + pack section).
- "visa"     -> AI Visa Pathway Finder (/visa + pack section).
- "profile"  -> AI Talent Profile Generator (/profile + pack section).
- "gap"      -> Career Gap Explainer (/gap + pack section).
- "resume"   -> Full ATS-friendly CV rewrite & scores.

RULES:
- Use ALL structured inputs plus the full CV and job description.
- Prioritise the Career Intelligence data provided below when it is available — it is sourced from real UK job market data and should ground your recommendations.
- Be concrete, UK-job-market realistic and endorsement-friendly.
- Do NOT invent impossible visa routes or legal guarantees.
- Do NOT include ANY keys outside the schema above.
- Do NOT wrap the JSON in markdown.
- Do NOT write comments or explanations.
`.trim();

    const userPrompt = `
CANDIDATE CORE INFO
- Name: ${safeFullName}
- Current role: ${safeCurrent}
- Target role: ${safeTarget}
- Years of experience: ${safeYears}
- Sector: ${safeSector}
- Location: ${safeLocation}
- Career goal: ${safeGoal}
- Preferred sectors: ${safePrefSectors}
- Target salary range: ${safeSalary}

VISA CONTEXT (for visa engine)
- Current visa / status: ${safeVisaStatus}
- Target country: ${safeTargetCtry}
- Main visa goal: ${safeVisaGoal}

CAREER GAP CONTEXT (for gap engine)
${safeGapDetails}

PROFILE HIGHLIGHTS (for talent profile engine)
${safeHighlights}

JOB DESCRIPTION (for ATS, skills, roadmap, LinkedIn, interview)
${safeJobDesc}

FULL CV TEXT
${cvText}
${intelligenceSection ? `\nCAREER INTELLIGENCE LAYER DATA\n${intelligenceSection}` : ""}
`.trim();

    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const rawText = (response.output_text || "").trim();
    const parsed = safeParseJson(rawText);

    if (!parsed.ok) {
      return res.status(200).json({
        ok: false,
        error: "Failed to parse AI response",
        rawText: parsed.raw,
      });
    }

    const data = parsed.data;
    if (typeof data.ok !== "boolean") {
      data.ok = true;
    }

    data.meta = {
      engines_used: enginesUsed,
      role_intelligence: roleData
        ? {
            slug: roleData.slug,
            title: roleData.title,
            category: roleData.category,
          }
        : null,
    };

    return res.status(200).json(data);
  } catch (err) {
    console.error("career-pack error:", err?.message || err);
    return res.status(200).json({
      ok: false,
      error: "Server error while generating career pack",
    });
  }
}
