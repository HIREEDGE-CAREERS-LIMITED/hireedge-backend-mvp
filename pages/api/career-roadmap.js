// /pages/api/career-roadmap.js  (BACKEND repo)
import OpenAI from "openai";

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

function stripCodeFences(s) {
  if (!s) return "";
  let text = String(s).trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "");
  }
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

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    const currentRole = body.currentRole || "Not provided";
    const targetRole = body.targetRole || "Not provided";
    const skills = Array.isArray(body.skills) ? body.skills : [];
    const exp = body.yearsExperience ?? body.experienceYears ?? "Not provided";

    const systemPrompt = `
You are the "HireEdge Career Roadmap Engine".

Return JSON ONLY (no markdown, no commentary) in EXACT structure:

{
  "summary": string,
  "timeframe_months": number,
  "target_roles": string[],
  "skills_in_order": string[],
  "projects_to_prove_capability": [
    { "name": string, "what_you_build": string, "evidence_link_or_output": string }
  ],
  "milestones_to_stay_on_track": string[],
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

JSON ONLY.
`.trim();

    const userPrompt = `
Current role: ${currentRole}
Target role: ${targetRole}
Experience (years): ${exp}
Current skills: ${skills.join(", ")}
`.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      // Helps reduce short answers
      max_output_tokens: 1800,
    });

    const text = response.output?.[0]?.content?.[0]?.text?.trim() ?? "";

    const parsed = tryParseJson(text);
    if (!parsed.ok) {
      return res.status(200).json({
        ok: false,
        error: parsed.error || "Invalid AI response",
        rawText: parsed.raw || text,
      });
    }

    return res.status(200).json({ ok: true, roadmap: parsed.json });
  } catch (err) {
    console.error("career-roadmap error:", err);
    return res.status(200).json({ ok: false, error: "Server error while generating roadmap" });
  }
}
