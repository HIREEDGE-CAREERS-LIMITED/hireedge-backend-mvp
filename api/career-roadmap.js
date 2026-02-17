// /pages/api/career-roadmap.js
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

// ✅ Robust body parsing (Next sometimes gives req.body as string)
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

// ✅ Normalize skills (UI can send string or array)
function normalizeSkills(skills) {
  if (!skills) return [];
  if (Array.isArray(skills))
    return skills.map((s) => String(s).trim()).filter(Boolean);

  if (typeof skills === "string") {
    return skills
      .split(/[\n,]+/g) // split by new lines OR commas
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return [];
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = getBody(req);

    const currentRole = body.currentRole || "Not provided";
    const targetRole = body.targetRole || "Not provided";
    const exp = body.yearsExperience ?? body.experienceYears ?? "Not provided";
    const skills = normalizeSkills(body.skills);

    const systemPrompt = `
You are the "HireEdge Career Roadmap Engine".

Return a SINGLE valid JSON object ONLY (no markdown, no backticks, no commentary)
in EXACT structure:

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
        {
          role: "system",
          content: [{ type: "text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [{ type: "text", text: userPrompt }],
        },
      ],

      // ✅ BEST: structured output that returns parsed JSON directly
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "career_roadmap",
          schema: {
            type: "object",
            additionalProperties: true,
          },
        },
      },

      max_output_tokens: 1800,
    });

    // ✅ parsed output directly (no JSON.parse needed)
    const roadmap = response.output_parsed;

    if (!roadmap) {
      console.error("No parsed output returned:", response);
      return res.status(500).json({
        ok: false,
        error: "AI returned empty structured output",
      });
    }

    return res.status(200).json({ ok: true, roadmap });
  } catch (err) {
    console.error("career-roadmap error:", err);
    return res.status(500).json({
      ok: false,
      error: "Server error while generating roadmap",
    });
  }
}
