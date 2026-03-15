// /pages/api/career-roadmap.js
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { getCareerContext, buildContextString, updateCareerContext } from "../utils/careerContext.js";
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
// Existing helpers
// ─────────────────────────────────────────────────────────────

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function normalizeSkills(skills) {
  if (!skills) return [];
  if (Array.isArray(skills)) {
    return skills.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof skills === "string") {
    return skills.split(/[\n,]+/g).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function stripCodeFences(s) {
  if (!s) return "";
  let text = String(s).trim();
  text = text.replace(/^```[a-zA-Z]*\s*/g, "");
  text = text.replace(/```$/g, "");
  return text.trim();
}

function tryParseJson(text) {
  const cleaned = stripCodeFences(text);
  try {
    return { ok: true, json: JSON.parse(cleaned) };
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return { ok: false, error: "No JSON object found", raw: cleaned };
    try {
      return { ok: true, json: JSON.parse(match[0]) };
    } catch {
      return { ok: false, error: "Failed to parse JSON", raw: cleaned };
    }
  }
}

async function getUserIdFromToken(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { data } = await supabase.auth.getUser(token);
    return data?.user?.id || null;
  } catch (e) {
    console.warn("getUserIdFromToken failed:", e.message);
    return null;
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
    const url = `${baseUrl}/api/role-intelligence?slug=${encodeURIComponent(slug)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (data?.error) return null;

    return data;
  } catch {
    return null;
  }
}

async function fetchRolePath(fromSlug, toSlug, baseUrl) {
  if (!fromSlug || !toSlug) return null;
  try {
    const url = `${baseUrl}/api/role-path?from=${encodeURIComponent(fromSlug)}&to=${encodeURIComponent(toSlug)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (data?.error || !data?.path) return null;

    return data;
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

function buildRoleContextSection({ currentRoleData, targetRoleData, pathData, pathRolesData }) {
  const lines = [];

  if (currentRoleData) {
    lines.push("CURRENT ROLE INTELLIGENCE (structured data):");
    lines.push(`  Title:     ${currentRoleData.title || ""}`);
    lines.push(`  Category:  ${currentRoleData.category || ""}`);
    lines.push(`  Seniority: ${currentRoleData.seniority || ""}`);
    if (currentRoleData.skills?.length) {
      lines.push(`  Skills:    ${currentRoleData.skills.join(", ")}`);
    }
    const curSalary = formatSalary(currentRoleData.salary_uk);
    if (curSalary) lines.push(`  UK Salary: ${curSalary}`);
    lines.push("");
  }

  if (targetRoleData) {
    lines.push("TARGET ROLE INTELLIGENCE (structured data):");
    lines.push(`  Title:     ${targetRoleData.title || ""}`);
    lines.push(`  Category:  ${targetRoleData.category || ""}`);
    lines.push(`  Seniority: ${targetRoleData.seniority || ""}`);
    if (targetRoleData.skills?.length) {
      lines.push(`  Required skills: ${targetRoleData.skills.join(", ")}`);
    }
    const tgtSalary = formatSalary(targetRoleData.salary_uk);
    if (tgtSalary) lines.push(`  UK Salary: ${tgtSalary}`);
    lines.push("");
  }

  if (currentRoleData?.salary_uk && targetRoleData?.salary_uk) {
    const fromMean = currentRoleData.salary_uk.mean;
    const toMean = targetRoleData.salary_uk.mean;
    if (fromMean && toMean && toMean !== fromMean) {
      const direction = toMean > fromMean ? "increase" : "decrease";
      const delta = Math.abs(toMean - fromMean).toLocaleString("en-GB");
      lines.push(`SALARY PROGRESSION: ${direction} of approximately £${delta} (mean) upon reaching target role.`);
      lines.push("");
    }
  }

  if (pathData?.path?.length) {
    lines.push("STRUCTURED CAREER PATH (from role graph):");
    lines.push(`  ${pathData.path.join(" → ")}`);
    if (pathData.steps != null) lines.push(`  Steps: ${pathData.steps}`);
    lines.push("");
  }

  if (pathRolesData.length > 0) {
    const allSkills = pathRolesData
      .filter((r) => r && Array.isArray(r.skills))
      .flatMap((r) => r.skills);

    const uniqueSkills = [...new Set(allSkills)];
    if (uniqueSkills.length) {
      lines.push("SKILLS REQUIRED ACROSS PATH ROLES:");
      lines.push(`  ${uniqueSkills.join(", ")}`);
      lines.push("");
    }

    const intermediates = pathRolesData.slice(1, -1).slice(0, 3);
    if (intermediates.length) {
      lines.push("INTERMEDIATE ROLES ON PATH:");
      intermediates.forEach((r) => {
        if (!r) return;
        const sal = formatSalary(r.salary_uk);
        lines.push(`  • ${r.title || r.slug} (${r.seniority || ""})${sal ? ` — ${sal}` : ""}`);
      });
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

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY missing in backend environment variables",
      });
    }

    const body = getBody(req);
    const baseUrl = getBaseUrl(req);

    const currentRole = body.currentRole || "Not provided";
    const targetRole = body.targetRole || "Not provided";
    const exp = body.yearsExperience ?? body.experienceYears ?? "Not provided";
    const skills = normalizeSkills(body.skills);

    // Career context
    let careerContext = null;
    let contextString = "";
    try {
      const userId = await getUserIdFromToken(req);
      if (userId) {
        careerContext = await getCareerContext(userId);
        contextString = buildContextString(careerContext);
      }
    } catch (ctxErr) {
      console.warn("career-roadmap: context fetch failed silently:", ctxErr.message);
    }

    // Career Intelligence Layer lookups
    const currentSlug = slugifyRole(currentRole);
    const targetSlug = slugifyRole(targetRole);

    const [currentRoleData, targetRoleData, pathData] = await Promise.all([
      fetchRoleIntelligence(currentSlug, baseUrl),
      fetchRoleIntelligence(targetSlug, baseUrl),
      fetchRolePath(currentSlug, targetSlug, baseUrl),
    ]);

    const pathSlugs = Array.isArray(pathData?.path) ? pathData.path : [];
    const intermediateSlugs = pathSlugs.slice(1, -1);

    const pathRolesData = intermediateSlugs.length > 0
      ? await Promise.all(
          intermediateSlugs.map((s) => fetchRoleIntelligence(slugifyRole(s), baseUrl))
        )
      : [];

    const allPathRolesData = [
      currentRoleData,
      ...pathRolesData,
      targetRoleData,
    ].filter(Boolean);

    const roleContextSection = buildRoleContextSection({
      currentRoleData,
      targetRoleData,
      pathData,
      pathRolesData: allPathRolesData,
    });

    // Visa-aware rules
    const visaRules = careerContext ? `
VISA-AWARE RULES (derived from user's previous visa engine session):
${careerContext.requires_sponsorship
  ? "- This user REQUIRES employer sponsorship. Only recommend roles and employers known to sponsor workers in the UK. Flag any role that typically does not offer sponsorship."
  : "- No sponsorship requirement detected."}
${careerContext.visa_status
  ? `- Current visa status: ${careerContext.visa_status}. Ensure all timeline recommendations are realistic within this visa status.`
  : ""}
${careerContext.visa_expiry
  ? `- Visa expiry: ${careerContext.visa_expiry}. If expiry is within 6 months, prioritise fast-track actions and flag urgency in milestones.`
  : ""}
${careerContext.skill_gaps?.length
  ? `- Previously identified skill gaps: ${careerContext.skill_gaps.join(", ")}. Prioritise these in skills_in_order.`
  : ""}
${careerContext.last_skills_summary
  ? `- Previous skills analysis summary: ${careerContext.last_skills_summary}`
  : ""}
`.trim() : "";

    const systemPrompt = `
You are the "HireEdge Career Roadmap Engine".

Return JSON ONLY (no markdown, no backticks, no commentary) in EXACT structure:

{
  "summary": string,
  "timeframe_months": number,
  "target_roles": string[],
  "skills_in_order": string[],
  "projects_to_prove_capability": [
    { "name": string, "what_you_build": string, "evidence_link_or_output": string }
  ],
  "milestones_to_stay_on_track": string[],
  "sponsorship_note": string or null,
  "visa_note": string or null,
  "monthly_progression_plan": [
    {
      "month": number,
      "focus": string,
      "skills_to_build": string[],
      "projects": string[],
      "milestones": string[]
    }
  ]
}

Rules:
- timeframe_months MUST be between 6 and 18.
- monthly_progression_plan MUST have exactly timeframe_months items (month 1..N).
- skills_in_order MUST be at least 10 items and ordered from foundational to advanced.
- projects_to_prove_capability MUST be at least 6 items.
- milestones_to_stay_on_track MUST be at least 10 items.
- sponsorship_note: if user requires sponsorship, list 3-5 UK employers in the target role known to sponsor. Otherwise null.
- visa_note: if visa constraints exist, summarise impact on timeline. Otherwise null.
- Use structured role intelligence and path data where provided to ground your recommendations in real market data.

${visaRules}

JSON ONLY.
`.trim();

    const userPrompt = `
Current role: ${currentRole}
Target role: ${targetRole}
Experience (years): ${exp}
Current skills: ${skills.join(", ")}
${contextString ? `\n${contextString}` : ""}
${roleContextSection ? `\n${roleContextSection}` : ""}
`.trim();

    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_output_tokens: 1800,
    });

    const text = (response.output_text || "").trim();

    if (!text) {
      console.error("career-roadmap: Empty output_text", response);
      return res.status(500).json({ ok: false, error: "Empty response from AI" });
    }

    const parsed = tryParseJson(text);
    if (!parsed.ok) {
      return res.status(200).json({
        ok: false,
        error: parsed.error || "Invalid AI response",
        rawText: parsed.raw || text,
      });
    }

    try {
      const userId = await getUserIdFromToken(req);
      if (userId && parsed.json?.summary) {
        await updateCareerContext(userId, {
          last_roadmap_summary: parsed.json.summary,
          target_roles: parsed.json.target_roles?.length
            ? parsed.json.target_roles
            : careerContext?.target_roles,
          career_goal: body.targetRole || careerContext?.career_goal,
        });
      }
    } catch (ctxErr) {
      console.warn("career-roadmap: context save failed silently:", ctxErr.message);
    }

    const responseBody = {
      ok: true,
      roadmap: parsed.json,
    };

    if (pathData?.path?.length) {
      responseBody.role_path = {
        from: currentRoleData?.title || currentRole,
        to: targetRoleData?.title || targetRole,
        path: pathData.path,
        steps: pathData.steps ?? pathData.path.length - 1,
      };
    }

    return res.status(200).json(responseBody);

  } catch (err) {
    const status = err?.status || err?.response?.status;
    const message = err?.message || "Unknown error";
    console.error("career-roadmap error:", { status, message });
    return res.status(500).json({
      ok: false,
      error: "Server error while generating roadmap",
    });
  }
}
