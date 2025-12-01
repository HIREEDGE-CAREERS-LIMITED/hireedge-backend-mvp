// /api/interview-prep.js
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
    const { jobDescription, cvText, targetRole } = req.body || {};

    if (!jobDescription && !targetRole) {
      return res.status(200).json({
        ok: false,
        error: "Please provide jobDescription or targetRole for interview prep",
      });
    }

    const systemPrompt = `
You are the "HireEdge Interview Prep Coach".

You create focused interview prep for one specific role.

ALWAYS respond with ONLY this JSON shape:

{
  "roleSummary": string,
  "focusAreas": string[],
  "behaviouralQuestions": [
    { "question": string, "answer": string }
  ],
  "roleSpecificQuestions": [
    { "question": string, "answer": string }
  ],
  "strengthQuestions": [
    { "question": string, "answer": string }
  ],
  "closingQuestions": string[],
  "tips": string[]
}

Rules:
- Behavioural answers should follow STAR style where relevant.
- Role-specific questions must be tailored to the job.
- Keep answers concise but practical.
- Do NOT include backticks or any extra text outside JSON.
    `.trim();

    const userPrompt = `
TARGET ROLE: ${targetRole || "Not specified"}

JOB DESCRIPTION:
${jobDescription || "Not provided"}

CANDIDATE CV / BACKGROUND:
${cvText || "Not provided"}

Create targeted interview prep and return JSON only.
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
      console.error("interview-prep JSON parse error:", raw);
      return res.status(200).json({
        ok: false,
        error: "Failed to parse AI response",
        rawText: raw,
      });
    }

    const result = {
      ok: true,
      roleSummary: parsed.roleSummary || "",
      focusAreas: parsed.focusAreas || [],
      behaviouralQuestions: parsed.behaviouralQuestions || [],
      roleSpecificQuestions: parsed.roleSpecificQuestions || [],
      strengthQuestions: parsed.strengthQuestions || [],
      closingQuestions: parsed.closingQuestions || [],
      tips: parsed.tips || [],
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("interview-prep error:", err);
    return res.status(200).json({
      ok: false,
      error: "Interview prep engine failed",
    });
  }
}
