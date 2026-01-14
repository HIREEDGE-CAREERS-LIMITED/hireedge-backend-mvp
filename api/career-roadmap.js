// /pages/api/career-roadmap.js (backend repo)
import OpenAI from "openai";

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
];

// CORS helper
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

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const {
      currentRole = "Not provided",
      targetRole = "Not provided",
      skills = [],
      yearsExperience = "Not provided", // ✅ match frontend key
    } = req.body || {};

    const systemPrompt = `
You are the "HireEdge Career Roadmap Engine".

Return JSON ONLY with this structure:

{
  "summary": string,
  "timeframe_months": number,
  "monthly_plan": [
    {
      "month": number,
      "focus": string,
      "skills_to_build": string[],
      "projects_to_prove": string[],
      "milestones": string[]
    }
  ],
  "skills_progression": string[],
  "portfolio_projects": [
    { "name": string, "goal": string, "deliverables": string[] }
  ],
  "milestones_overview": string[],
  "target_roles": string[]
}

Rules:
- timeframe_months must be 12 or 18 (choose based on the profile).
- monthly_plan length must equal timeframe_months.
- Keep items practical and UK job-market friendly.
- NO explanations. NO markdown. JSON ONLY.
`.trim();

    const userPrompt = `
Current role: ${currentRole}
Target role: ${targetRole}
Experience (years): ${yearsExperience}
Current skills: ${Array.isArray(skills) ? skills.join(", ") : skills}
`.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    let text = response.output?.[0]?.content?.[0]?.text?.trim() ?? "";

    if (text.startsWith("```")) {
      text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "");
    }

    let roadmap;
    try {
      roadmap = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        return res.status(200).json({ ok: false, error: "Invalid AI response", rawText: text });
      }
      try {
        roadmap = JSON.parse(match[0]);
      } catch {
        return res.status(200).json({ ok: false, error: "Failed to parse AI JSON", rawText: text });
      }
    }

    return res.status(200).json({ ok: true, roadmap });
  } catch (err) {
    console.error("roadmap error", err);
    return res.status(200).json({ ok: false, error: "Server error while generating roadmap" });
  }
}
