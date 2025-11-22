import OpenAI from "openai";

const ALLOWED_ORIGIN = "https://hireedge-mvp-web.vercel.app";

export default async function handler(req, res) {
  // Basic CORS
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
    const {
      jobDescription,
      cvText,
      currentRole,
      targetRole,
      experienceYears,
      sector
    } = req.body || {};

    if (!cvText) {
      return res
        .status(400)
        .json({ ok: false, error: "cvText is required for analysis" });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      input: [
        {
          role: "system",
          content: `
You are HireEdge's One-Click Career Pack engine.

You receive a candidate profile (CV text, job description, role, sector)
and MUST return a SINGLE JSON object with this EXACT structure:

{
  "ats": {
    "score": number,                    // 0-100
    "matchedKeywords": string[],
    "missingKeywords": string[],
    "summary": string
  },
  "skills": {
    "overallFit": number,               // 0-100
    "matchedSkills": string[],
    "partialMatchSkills": string[],
    "missingSkills": string[],
    "gapSummary": string
  },
  "roadmap": {
    "summary": string,
    "timeframeMonths": number,
    "stages": [
      {
        "name": string,
        "durationWeeks": number,
        "focus": string,
        "actions": string[]
      }
    ]
  },
  "linkedin": {
    "headline": string,
    "about": string,
    "strengths": string[],
    "hashtags": string[]
  },
  "interview": {
    "generalQuestions": string[],
    "roleSpecificQuestions": string[],
    "behaviouralQuestions": string[]
  },
  "visaHint": {
    "ukRoute": string,                  // e.g. "Skilled Worker", "Graduate", "Innovator Founder (high-level)"
    "summary": string,
    "flags": string[]
  }
}

Rules:
- Keep text concise and practical.
- Use UK wording when talking about visas and roles.
- Never mention that you are an AI model.
- If job description is empty, base ATS & skills on targetRole + sector + cvText.
        `.trim()
        },
        {
          role: "user",
          content: JSON.stringify({
            jobDescription: jobDescription || "",
            cvText,
            currentRole: currentRole || "",
            targetRole: targetRole || "",
            experienceYears: experienceYears || "",
            sector: sector || ""
          })
        }
      ]
    });

    const raw =
      response.output?.[0]?.content?.[0]?.text ||
      response.output_text ||
      "";

    let pack;
    try {
      pack = JSON.parse(raw);
    } catch (e) {
      console.error("career-pack JSON parse error:", e, raw);
      return res
        .status(500)
        .json({ ok: false, error: "Failed to parse AI response" });
    }

    return res.status(200).json({
      ok: true,
      pack
    });
  } catch (err) {
    console.error("career-pack error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Career pack generation failed" });
  }
}
