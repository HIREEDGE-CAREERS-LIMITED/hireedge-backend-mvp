// /api/talent-profile.js
import OpenAI from "openai";

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
];

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- small utilities ---
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

function extractJsonObject(text) {
  if (!text) return null;
  const t = text.trim();

  // Remove code fences if any
  const unfenced = t
    .replace(/^```[a-zA-Z]*\n?/, "")
    .replace(/```$/, "")
    .trim();

  // Quick path: direct JSON
  try {
    return JSON.parse(unfenced);
  } catch {}

  // Fallback: try to find the first {...} block
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = unfenced.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  return null;
}

function normalizeOutput(parsed) {
  const out = parsed && typeof parsed === "object" ? parsed : {};

  const title = cleanStr(out.title || out.roleTitle || out.headline, 120);
  const bio = cleanStr(out.bio || out.summary, 2500);

  const skills = ensureStringArray(out.skills, 20);
  const achievements = ensureStringArray(out.achievements, 15);
  const expertiseTags = ensureStringArray(out.expertiseTags || out.tags, 20);

  const linkedinHeadline = cleanStr(out.linkedinHeadline, 220);

  // Optional field, keep if present
  const seniority = cleanStr(out.seniority, 80);

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

export default async function handler(req, res) {
  // ----- CORS -----
  const origin = req.headers.origin;
  const allowedOrigin = pickAllowedOrigin(origin);

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(200).end();
  // ----- END CORS -----

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    // Accept both old and new inputs safely
    const fullName = cleanStr(body.fullName, 120);
    const cvText = cleanStr(body.cvText, 30000);

    const targetDirection = cleanStr(body.targetDirection, 200);
    const locationPreference = cleanStr(body.locationPreference, 120);

    const currentRole = cleanStr(body.currentRole, 120);
    const experienceYears = cleanStr(body.experienceYears, 30);
    const skillsInput = Array.isArray(body.skills) ? body.skills : null;

    if (!fullName || !cvText) {
      return res.status(200).json({
        ok: false,
        error: "fullName and cvText are required",
      });
    }

    // ✅ Higher-quality system prompt (forces recruiter-grade output)
    const systemPrompt = `
You are HireEdge's Smart Talent Profile Engine.
Create a recruiter-ready talent profile card from a CV.

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

    // ✅ Better user prompt with optional context
    const userPrompt = `
Full Name: ${fullName}
Target Direction (optional): ${targetDirection || "Not specified"}
Location Preference (optional): ${locationPreference || "Not specified"}

Current Role (optional): ${currentRole || "Not specified"}
Experience Years (optional): ${experienceYears || "Not specified"}
Skills (optional): ${skillsInput ? skillsInput.join(", ") : "Not specified"}

CV Text:
${cvText}

Generate the JSON now.
    `.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      // keep deterministic for consistent JSON
      temperature: 0.3,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const rawText = response.output?.[0]?.content?.[0]?.text?.trim() ?? "";
    const parsed = extractJsonObject(rawText);

    if (!parsed) {
      console.log("Talent profile raw:", rawText);
      return res.status(200).json({
        ok: false,
        error: "Failed to parse talent profile JSON",
        rawText: rawText.slice(0, 4000),
      });
    }

    const normalized = normalizeOutput(parsed);

    // Basic sanity checks (prevents empty “ok:true”)
    if (!normalized.title || !normalized.bio || !normalized.linkedinHeadline) {
      return res.status(200).json({
        ok: false,
        error: "Generated output missing required fields",
        rawText: rawText.slice(0, 4000),
      });
    }

    return res.status(200).json({
      ok: true,
      ...normalized,
    });
  } catch (err) {
    console.error("Talent Profile Engine Error:", err);
    return res.status(200).json({
      ok: false,
      error: "Talent profile generation failed",
    });
  }
}
