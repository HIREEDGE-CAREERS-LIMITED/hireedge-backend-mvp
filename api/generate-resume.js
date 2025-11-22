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

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `
You are the "HireEdge AI Resume & ATS Engine".

Your job:
- Analyse the job description and the candidate's CV.
- Optimise the CV for ATS and recruiter readability.
- Score ATS match from 0–100.
- Identify matched and missing keywords.
- Return ONLY valid JSON matching this EXACT structure:

{
  "atsScore": number,              // 0–100
  "matchedKeywords": string[],     // keywords found in CV that match JD
  "missingKeywords": string[],     // important keywords missing in CV
  "optimisedResume": string,       // full improved resume text
  "summary": string,               // 2–3 line summary of the match
  "suggestions": string[]          // bullet improvement suggestions
}

DO NOT include backticks, explanations, or text outside the JSON.
        `.trim(),
        },
        {
          role: "user",
          content: `
JOB DESCRIPTION:
${jobDescription}

CANDIDATE CV:
${cvText}

Analyse and return JSON only.
          `.trim(),
        },
      ],
    });

    const raw = response.output[0].content[0].text;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("JSON parse error for resume engine:", raw);
      return res.status(500).json({
        ok: false,
        error: "Failed to parse AI response",
        raw,
      });
    }

    // Normalise fields for frontend
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
    return res
      .status(500)
      .json({ ok: false, error: "Resume engine failed. Please try again." });
  }
}
