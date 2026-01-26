// pages/api/interview-prep.js
import OpenAI from "openai";

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
];

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ small helper (safer than crashing on non-JSON)
function safeJsonParse(raw) {
  if (!raw) return { ok: false, error: "Empty AI response" };

  let text = String(raw).trim();

  // strip ```json fences if model adds them
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, error: "JSON parse failed", rawText: text };
  }
}

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
- Keep answers concise but practical.
- Do NOT include backticks or any text outside JSON.

Output constraints (IMPORTANT):
- Return EXACTLY 10 behaviouralQuestions (each with question + answer).
- Return EXACTLY 6 roleSpecificQuestions (each with question + answer).
- Return EXACTLY 4 strengthQuestions (each with question + answer).
- Return EXACTLY 6 closingQuestions (strings).
- Return EXACTLY 8 tips (strings).
- Make roleSpecificQuestions tightly aligned to the provided jobDescription/targetRole.
- Make strengthQuestions reflect the candidate CV where provided.
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

    // robust extraction
    const raw =
      (typeof response.output_text === "string" && response.output_text.trim()) ||
      response.output?.[0]?.content?.[0]?.text?.trim() ||
      "";

    const parsedRes = safeJsonParse(raw);
    if (!parsedRes.ok) {
      console.error("❌ interview-prep JSON parse error:", parsedRes.rawText || raw);
      return res.status(200).json({
        ok: false,
        error: "Failed to parse AI response",
        rawText: parsedRes.rawText || raw,
      });
    }

    const parsed = parsedRes.data || {};

    // ---------- NORMALISE TO FRONTEND SCHEMA ----------

    // Opening Pitch
    const openingPitch = String(parsed.roleSummary || "").trim();

    // Core Interview Questions (role + strengths combined)
    const MIN_CORE = 7;
    const MAX_CORE = 10;

    let coreQuestions = []
      .concat(
        Array.isArray(parsed.roleSpecificQuestions) ? parsed.roleSpecificQuestions : []
      )
      .concat(Array.isArray(parsed.strengthQuestions) ? parsed.strengthQuestions : [])
      .map((x) => {
        if (typeof x === "string") return x.trim();
        if (x && typeof x === "object") return String(x.question || "").trim();
        return "";
      })
      .filter(Boolean);

    // cap to max
    coreQuestions = coreQuestions.slice(0, MAX_CORE);

    // pad to min (rare, but keeps UI consistent)
    if (coreQuestions.length < MIN_CORE) {
      const role = targetRole || "this role";
      const fallback = [
        `Walk me through your experience relevant to ${role}.`,
        `Why do you want ${role} and why now?`,
        `What are your top strengths for ${role}?`,
        `What’s one development area you’re actively improving?`,
        `Tell me about a time you handled a challenging situation at work.`,
        `How do you prioritise when everything is urgent?`,
        `What would you do in your first 30/60/90 days in ${role}?`,
        `How do you handle feedback or disagreement with a stakeholder?`,
        `What metrics do you use to measure success in your work?`,
        `Describe a time you improved a process or delivered measurable results.`,
      ];

      for (const q of fallback) {
        if (coreQuestions.length >= MIN_CORE) break;
        if (!coreQuestions.includes(q)) coreQuestions.push(q);
      }

      coreQuestions = coreQuestions.slice(0, MAX_CORE);
    }

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
      focusAreas: Array.isArray(parsed.focusAreas) ? parsed.focusAreas : [],
      roleSpecificQuestions: Array.isArray(parsed.roleSpecificQuestions)
        ? parsed.roleSpecificQuestions
        : [],
      strengthQuestions: Array.isArray(parsed.strengthQuestions)
        ? parsed.strengthQuestions
        : [],
      closingQuestions: Array.isArray(parsed.closingQuestions) ? parsed.closingQuestions : [],
      tips: Array.isArray(parsed.tips) ? parsed.tips : [],
    });
  } catch (err) {
    console.error("❌ interview-prep error:", err);
    return res.status(200).json({
      ok: false,
      error: "Interview prep engine failed",
    });
  }
}
