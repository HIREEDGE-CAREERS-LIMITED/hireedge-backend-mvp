// /api/career-roadmap.js
import OpenAI from "openai";

// Allow both your Webflow + Vercel sites + localhost
const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000"
];

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  // ----- CORS -----
  const origin = req.headers.origin;
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  // ----- END CORS -----

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const {
      currentRole = "Not provided",
      targetRole = "Not provided",
      skills = [],
      experienceYears = "Not provided"
    } = req.body || {};

    const systemPrompt = `
You are the "HireEdge Career Roadmap Engine".
Return JSON ONLY with this structure:

{
  "summary": string,
  "timeframe_months": number,
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

NO explanations. NO markdown. JSON ONLY.
    `.trim();

    const userPrompt = `
Current role: ${currentRole}
Target role: ${targetRole}
Experience (years): ${experienceYears}
Current skills: ${Array.isArray(skills) ? skills.join(", ") : skills}
    `.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    // -------- Parse AI output safely --------
    let text = response.output?.[0]?.content?.[0]?.text?.trim() ?? "";

    // Remove ```json fencing if present
    if (text.startsWith("```")) {
      text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
    }

    let roadmap;
    try {
      roadmap = JSON.parse(text);
    } catch (err) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          roadmap = JSON.parse(match[0]);
        } catch {
          return res.status(200).json({
            ok: false,
            error: "Failed to parse AI JSON",
            rawText: text
          });
        }
      } else {
        return res.status(200).json({
          ok: false,
          error: "Invalid AI response",
          rawText: text
        });
      }
    }
    // ----------------------------------------

    return res.status(200).json({
      ok: true,
      roadmap
    });

  } catch (err) {
    console.error("roadmap error", err);
    return res.status(200).json({
      ok: false,
      error: "Server error while generating roadmap"
    });
  }
}
