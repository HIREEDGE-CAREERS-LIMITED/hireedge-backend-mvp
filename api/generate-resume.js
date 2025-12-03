// /api/generate-resume.js
import OpenAI from "openai";

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
  "https://hireedge.co.uk",
  "https://www.hireedge.co.uk"
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
    const { jobDescription, cvText } = req.body || {};

    if (!jobDescription || !cvText) {
      return res.status(200).json({
        ok: false,
        error: "jobDescription and cvText are required",
      });
    }

    const systemPrompt = `
You are the "HireEdge AI Resume & ATS Engine".

Your job:
- Analyse the job description and the candidate's CV.
- Optimise the CV for ATS and recruiter readability.
- Score ATS match from 0–100.
- Identify matched and missing keywords.
- Return ONLY valid JSON matching this EXACT structure:

{
  "atsScore": number,
  "matchedKeywords": string[],
  "missingKeywords": string[],
  "optimisedResume": string,
  "summary": string,
  "suggestions": string[]
}

NO markdown, NO backticks, NO text outside JSON.
    `.trim();

    const userPrompt = `
JOB DESCRIPTION:
${jobDescription}

CANDIDATE CV:
${cvText}

Analyse and return JSON only.
    `.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    // ---- Safe parsing of AI output ----
    let raw = response.output?.[0]?.content?.[0]?.text?.trim() ?? "";

    if (raw.startsWith("```")) {
      raw = raw.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          console.error("JSON parse error (inner) for resume engine:", raw);
          return res.status(200).json({
            ok: false,
            error: "Failed to parse AI response",
            rawText: raw,
          });
        }
      } else {
        console.error("JSON parse error for resume engine:", raw);
        return res.status(200).json({
          ok: false,
          error: "Failed to parse AI response",
          rawText: raw,
        });
      }
    }
    // -------------------------------

    const result = {
      ok: true,
      atsScore: parsed.atsScore ?? null,
      matchedKeywords: parsed.matchedKeywords || [],
      missingKeywords: parsed.missingKeywords || [],
      optimisedResume: parsed.optimisedResume || "",
      summary: parsed.summary || "",
      suggestions: parsed.suggestions || [],
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("generate-resume error:", err);
    return res.status(200).json({
      ok: false,
      error: "Resume engine failed. Please try again.",
    });
  }
}
