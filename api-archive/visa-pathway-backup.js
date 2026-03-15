
// /api/visa-pathway.js
import OpenAI from "openai";

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
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

  if (req.method === "OPTIONS") return res.status(200).end();
  // ----- END CORS -----

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { profile, targetCountry, goal } = req.body || {};

    if (!profile) {
      return res.status(200).json({
        ok: false,
        error: "Profile summary is required",
      });
    }

    const systemPrompt = `
You are the "HireEdge Visa Pathway Engine".

Task:
- Analyse a candidate's profile and high-level goals.
- Suggest realistic visa / immigration pathways.
- Focus on clarity & practicality (NOT legal advice).

Always respond ONLY with this JSON:

{
  "targetCountry": string,
  "goal": string,
  "bestRoute": {
    "name": string,
    "summary": string,
    "whyGoodFit": string,
    "keyRequirements": string[],
    "risksOrLimitations": string[],
    "nextSteps": string[]
  },
  "alternativeRoutes": [
    {
      "name": string,
      "summary": string,
      "whenToUse": string,
      "keyRequirements": string[]
    }
  ],
  "disclaimer": string
}

Guidelines:
- Use country-specific visa names when possible (e.g. UK Skilled Worker, UK Graduate, UK Innovator Founder, Canada Express Entry etc.), but only where they fit.
- Don't invent impossible paths.
- Disclaimer must say this is information only, not legal advice.
- Do NOT include backticks or any extra explanation outside JSON.
    `.trim();

    const userPrompt = `
CANDIDATE PROFILE:
${profile}

TARGET COUNTRY:
${targetCountry || "UK"}

GOAL (work, study, startup, family etc.):
${goal || "work"}

Return JSON only.
    `.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    let raw = response.output?.[0]?.content?.[0]?.text?.trim() ?? "";

    if (raw.startsWith("```")) {
      raw = raw.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("visa-pathway JSON parse error:", raw);
      return res.status(200).json({
        ok: false,
        error: "Failed to parse AI response",
        rawText: raw,
      });
    }

    const result = {
      ok: true,
      targetCountry: parsed.targetCountry || targetCountry || "UK",
      goal: parsed.goal || goal || "",
      bestRoute: parsed.bestRoute || null,
      alternativeRoutes: parsed.alternativeRoutes || [],
      disclaimer:
        parsed.disclaimer ||
        "This is general information only and is not legal or immigration advice.",
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("visa-pathway error:", err);
    return res.status(200).json({
      ok: false,
      error: "Visa pathway engine failed",
    });
  }
}
