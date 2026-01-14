// /pages/api/career-roadmap.js (backend repo)
import OpenAI from "openai";

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
];

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

function stripCodeFences(s = "") {
  let text = String(s || "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "").trim();
  }
  return text;
}

function safeJsonParse(text) {
  const cleaned = stripCodeFences(text);

  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch {}

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match?.[0]) {
    try {
      return { ok: true, value: JSON.parse(match[0]) };
    } catch {}
  }

  return { ok: false, rawText: cleaned };
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const body = req.body || {};

    const currentRole = body.currentRole || "Not provided";
    const targetRole = body.targetRole || "Not provided";
    const skills = Array.isArray(body.skills) ? body.skills : [];
    const experienceYears =
      body.experienceYears ?? body.yearsExperience ?? "Not provided";

    const systemPrompt = `
You are the "HireEdge Career Roadmap Engine".

Return JSON ONLY (no markdown, no explanations) with this structure:

{
  "summary": string,
  "timeframe_months": number,
  "monthly_progression_plan": [
    { "month": number, "focus": string, "milestones": string[], "outputs": string[] }
  ],
  "skills_to_build_in_order": string[],
  "projects_to_prove_capability": [
    { "name": string, "description": string, "deliverables": string[], "difficulty": "easy"|"medium"|"hard" }
  ],
  "milestones_to_stay_on_track": string[],
  "stages": [
    {
      "name": string,
      "duration_weeks": number,
      "goals": string[],
      "skills_to_learn": string[],
      "resources": [
        { "type": string, "name": string, "provider": string, "notes": string }
      ]
    }
  ],
  "target_roles": string[]
}

Rules:
- timeframe_months must be 12 or 18
- monthly_progression_plan must cover EVERY month (length = timeframe_months)
- skills_to_build_in_order must have 12–20 items, ordered
- projects_to_prove_capability must have 4–8 projects
- milestones_to_stay_on_track must have 8–15 items
- stages must have 4–7 stages
JSON ONLY.
`.trim();

    const userPrompt = `
Current role: ${currentRole}
Target role: ${targetRole}
Experience (years): ${experienceYears}
Current skills: ${skills.join(", ")}
`.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const text = response.output?.[0]?.content?.[0]?.text?.trim() ?? "";
    const parsed = safeJsonParse(text);

    if (!parsed.ok) {
      return res.status(200).json({
        ok: false,
        error: "Failed to parse AI JSON",
        rawText: parsed.rawText,
      });
    }

    return res.status(200).json({ ok: true, roadmap: parsed.value });
  } catch (err) {
    console.error("career-roadmap error", err);
    return res.status(200).json({
      ok: false,
      error: "Server error while generating roadmap",
    });
  }
}
