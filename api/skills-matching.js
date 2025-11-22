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
    const { jobDescription, cvText } = req.body;

    if (!jobDescription || !cvText) {
      return res
        .status(400)
        .json({ ok: false, error: "jobDescription and cvText are required" });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `
You are the "HireEdge Skills & Gap Engine".

Compare the JOB DESCRIPTION and the CANDIDATE CV.
Extract skills, classify them, and return ONLY this JSON:

{
  "overallFit": number,              // 0–100 overall fit score
  "matchedSkills": string[],         // skills clearly present in CV
  "partialMatchSkills": string[],    // skills somewhat present / implied
  "missingSkills": string[],         // important skills missing
  "gapSummary": string,              // 2–3 line explanation of key gaps
  "learningPlan": [                  // short plan to close gaps
    {
      "skill": string,
      "actions": string[]            // concrete steps or resources
    }
  ]
}

Do NOT return anything outside valid JSON.
          `.trim(),
        },
        {
          role: "user",
          content: `
JOB DESCRIPTION:
${jobDescription}

CANDIDATE CV:
${cvText}

Analyse skills and gaps and return JSON only.
          `.trim(),
        },
      ],
    });

    const raw = response.output[0].content[0].text;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("skills-matching JSON parse error:", raw);
      return res.status(500).json({
        ok: false,
        error: "Failed to parse AI response",
        raw,
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
    return res
      .status(500)
      .json({ ok: false, error: "Skills engine failed. Please try again." });
  }
}
