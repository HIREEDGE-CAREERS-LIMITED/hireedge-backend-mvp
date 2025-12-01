// /api/linkedin-optimizer.js
import OpenAI from "openai";

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

  if (req.method === "OPTIONS") return res.status(200).end();
  // ----- END CORS -----

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { currentRole, targetRole, industry, cvText } = req.body || {};

    if (!cvText) {
      return res.status(200).json({
        ok: false,
        error: "cvText is required for optimisation",
      });
    }

    const systemPrompt = `
You are the "HireEdge LinkedIn Profile Optimiser".

Generate a high-conversion LinkedIn profile for job search and recruiter visibility.

Always respond with ONLY this JSON structure:

{
  "headline": string,
  "about": string,
  "summary": string,
  "strengths": string[],
  "searchKeywords": string[],
  "hashtags": string[],
  "experienceBullets": string[]
}

Rules:
- Headline max ~220 characters, focused on target role & value.
- About: 3–6 short paragraphs, friendly and professional.
- Strengths: 4–8 bullet points.
- Search keywords: recruiter search terms (no #).
- Hashtags: 5–12 best hashtags for this profile (with #).
- Experience bullets: achievement-style bullet lines that user can paste into Experience section.
- Do NOT include backticks or any text outside valid JSON.
    `.trim();

    const userPrompt = `
CURRENT ROLE: ${currentRole || "Not specified"}
TARGET ROLE: ${targetRole || "Not specified"}
INDUSTRY: ${industry || "General"}

CANDIDATE CV / BACKGROUND:
${cvText}

Create the LinkedIn profile elements and return JSON only.
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
      console.error("linkedin-optimizer JSON parse error:", raw);
      return res.status(200).json({
        ok: false,
        error: "Failed to parse AI response",
        rawText: raw,
      });
    }

    const result = {
      ok: true,
      headline: parsed.headline || "",
      about: parsed.about || "",
      summary: parsed.summary || "",
      strengths: parsed.strengths || [],
      searchKeywords: parsed.searchKeywords || [],
      hashtags: parsed.hashtags || [],
      experienceBullets: parsed.experienceBullets || [],
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("linkedin-optimizer error:", err);
    return res.status(200).json({
      ok: false,
      error: "LinkedIn optimiser failed. Please try again.",
    });
  }
}
