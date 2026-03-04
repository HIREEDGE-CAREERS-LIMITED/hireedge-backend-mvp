// /pages/api/career-roadmap.js
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js"; // ← ADDED
import { getCareerContext, buildContextString, updateCareerContext } from "../../utils/careerContext"; // ← ADDED

// ✅ Allow both your Webflow + Vercel sites + localhost
const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
];

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ CORS helper
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

// ✅ Robust body parsing
function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

// ✅ Normalize skills
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

// ← ADDED: extracts user_id from Bearer token
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

    const currentRole = body.currentRole || "Not provided";
    const targetRole = body.targetRole || "Not provided";
    const exp = body.yearsExperience ?? body.experienceYears ?? "Not provided";
    const skills = normalizeSkills(body.skills);

    // ← ADDED: fetch career context for this user
    let careerContext = null;
    let contextString = "";
    try {
      const userId = await getUserIdFromToken(req);
      if (userId) {
        careerContext = await getCareerContext(userId);
        contextString = buildContextString(careerContext);
      }
    } catch (ctxErr) {
      // never block the engine if context fetch fails
      console.warn("career-roadmap: context fetch failed silently:", ctxErr.message);
    }
    // ← END ADDED

    // ← ADDED: build visa-aware rules to inject into system prompt
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
    // ← END ADDED

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

${visaRules}

JSON ONLY.
`.trim();

    const userPrompt = `
Current role: ${currentRole}
Target role: ${targetRole}
Experience (years): ${exp}
Current skills: ${skills.join(", ")}
${contextString}
`.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
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

    // ← ADDED: write roadmap summary back to context for other engines to use
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
    // ← END ADDED

    return res.status(200).json({ ok: true, roadmap: parsed.json });

  } catch (err) {
    const status = err?.status || err?.response?.status;
    const message = err?.message || "Unknown error";
    console.error("career-roadmap OpenAI error:", { status, message, data: err?.response?.data });
    return res.status(500).json({
      ok: false,
      error: "Server error while generating roadmap",
      debug: { status, message },
    });
  }
}
