// /api/interview-prep.js
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
  // ---------- CORS ----------
  const origin = req.headers.origin;
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(200).end();
  // ---------- END CORS ----------

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

    // ---------- PROMPTS ----------
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
- Do NOT include backticks or any text outside JSON.
`.trim();

    const userPrompt = `
TARGET ROLE: ${targetRole || "Not specified"}

JOB DESCRIPTION:
${jobDescription || "Not provided"}

CANDIDATE CV / BACKGROUND:
${cvText || "Not provided"}

Create targeted interview prep and return JSON only.
`.trim();

    // ---------- OPENAI CALL ----------
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
      console.error("❌ interview-prep JSON parse error:", raw);
      return res.status(200).json({
        ok: false,
        error: "Failed to parse AI response",
        rawText: raw,
      });
    }

    // ---------- NORMALISE TO FRONTEND SCHEMA ----------

    // Opening Pitch
    const openingPitch = String(parsed.roleSummary || "").trim();

    // Core Interview Questions (role + strengths combined)
    const coreQuestions = []
      .concat(Array.isArray(parsed.roleSpecificQuestions) ? parsed.roleSpecificQuestions : [])
      .concat(Array.isArray(parsed.strengthQuestions) ? parsed.strengthQuestions : [])
      .map((x) => {
        if (typeof x === "string") return x.trim();
        if (x && typeof x === "object") return String(x.question || "").trim();
        return "";
      })
      .filter(Boolean);

    // Behavioural STAR Q&A
    const behaviouralQuestions = (Array.isArray(parsed.behaviouralQuestions)
      ? parsed.behaviouralQuestions
      : []
    )
      .map((x) => ({
        question: typeof x?.question === "string" ? x.question.trim() : "",
        answer: typeof x?.answer === "string" ? x.answer.trim() : "",
      }))
      .filter((x) => x.question);

    // Questions to Ask Interviewer
    const questionsForInterviewer = (Array.isArray(parsed.closingQuestions)
      ? parsed.closingQuestions
      : []
    )
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);

    // Final Tips
    const finalTips = (Array.isArray(parsed.tips) ? parsed.tips : [])
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);

    // ---------- RESPONSE ----------
    return res.status(200).json({
      ok: true,

      // ✅ frontend-standard keys (USED BY UI)
      openingPitch,
      coreQuestions,
      behaviouralQuestions,
      questionsForInterviewer,
      finalTips,

      // 🔁 keep originals (safe for future)
      roleSummary: parsed.roleSummary || "",
      focusAreas: parsed.focusAreas || [],
      roleSpecificQuestions: parsed.roleSpecificQuestions || [],
      strengthQuestions: parsed.strengthQuestions || [],
      closingQuestions: parsed.closingQuestions || [],
      tips: parsed.tips || [],
    });
  } catch (err) {
    console.error("❌ interview-prep error:", err);
    return res.status(200).json({
      ok: false,
      error: "Interview prep engine failed",
    });
  }
}
