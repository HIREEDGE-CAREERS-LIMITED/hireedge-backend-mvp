// /api/skills-matching.js
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

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  // ----- END CORS -----

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { jobDescription, cvText, targetRole } = req.body || {};

    if (!jobDescription || !cvText) {
      return res.status(200).json({
        ok: false,
        error: "jobDescription and cvText are required",
      });
    }

    const systemPrompt = `
You are the "HireEdge Skills & Gap Engine".

Compare the JOB DESCRIPTION and the CANDIDATE CV.
Extract skills, classify them, and return ONLY this JSON:

{
  "overallFit": number,
  "matchedSkills": string[],
  "partialMatchSkills": string[],
  "missingSkills": string[],
  "gapSummary": string,
  "learningPlan": [
    {
      "skill": string,
      "actions": string[]
    }
  ]
}

Do NOT return anything outside valid JSON.
    `.trim();

    const userPrompt = `
TARGET ROLE:
${targetRole || "Not specified"}

JOB DESCRIPTION:
${jobDescription}

CANDIDATE CV:
${cvText}

Analyse skills and gaps and return JSON only.
    `.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    let raw = response.output?.[0]?.content?.[0]?.text?.trim() ?? "";

    // strip ```json fences if model adds them
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("skills-matching JSON parse error:", raw);
      return res.status(200).json({
        ok: false,
        error: "Failed to parse AI response",
        rawText: raw,
      });
    }

    const result = {
      ok: true,
      overallFit: parsed.overallFit ?? null,
      matchedSkills: parsed.matchedSkills || [],
      partialMatchSkills: parsed.partialMatchSkills || [],
      missingSkills: parsed.missingSkills || [],
      gapSummary: parsed.gapSummary || "",
      learningPlan: parsed.learningPlan || [],
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("skills-matching error:", err);
    return res.status(200).json({
      ok: false,
      error: "Skills engine failed. Please try again.",
    });
  }
}
