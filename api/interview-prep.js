import OpenAI from "openai";

const ALLOWED_ORIGIN = "https://hireedge-mvp-web.vercel.app";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { jobDescription, cvText, targetRole } = req.body;

    if (!jobDescription && !targetRole) {
      return res.status(400).json({
        ok: false,
        error: "Please provide jobDescription or targetRole for interview prep",
      });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `
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
        `.trim(),
        },
        {
          role: "user",
          content: `
TARGET ROLE: ${targetRole || "Not specified"}

JOB DESCRIPTION:
${jobDescription || "Not provided"}

CANDIDATE CV / BACKGROUND:
${cvText || "Not provided"}

Create targeted interview prep and return JSON only.
        `.trim(),
        },
      ],
    });

    const raw = response.output[0].content[0].text;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("interview-prep JSON parse error:", raw);
      return res.status(500).json({
        ok: false,
        error: "Failed to parse AI response",
        raw,
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
    return res
      .status(500)
      .json({ ok: false, error: "Interview prep engine failed" });
  }
}
