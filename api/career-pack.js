// /api/career-pack.js
import OpenAI from "openai";

// Fixed domains we always allow
const FIXED_ORIGINS = [
  "https://hireedge.co.uk",
  "https://www.hireedge.co.uk",
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
];

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  // ----- CORS -----
  const origin = req.headers.origin || "";
  let allowedOrigin = FIXED_ORIGINS[0];

  // Allow:
  //   - any of the fixed origins above
  //   - ANY vercel.app preview / deployment
  if (
    origin &&
    (FIXED_ORIGINS.includes(origin) || origin.endsWith(".vercel.app"))
  ) {
    allowedOrigin = origin;
  }

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
    const {
      currentRole,
      targetRole,
      yearsExperience,
      sector,
      jobDescription,
      jobText, // in case Webflow sends jobText instead of jobDescription
      cvText,
    } = req.body || {};

    if (!cvText) {
      return res
        .status(400)
        .json({ ok: false, error: "cvText is required for analysis" });
    }

    const safeCurrentRole = currentRole || "Not specified";
    const safeTargetRole = targetRole || "Not specified";
    const safeYears = yearsExperience || "Not specified";
    const safeSector = sector || "Not specified";
    const safeJobDesc = jobDescription || jobText || "Not provided";

    // 🔹 9 engines + master Career Pack JSON
    const systemPrompt = `
You are HireEdge's One-Click Career Pack Engine.

You MUST return a valid JSON object only, with this exact structure and keys:

{
  "ok": true,
  "ats": {
    "match": boolean,
    "gaps": string[],
    "recommendations": string[]
  },
  "skills": {
    "explicit": string[],
    "missing": string[],
    "development_plan": string[]
  },
  "roadmap": {
    "immediate": string[],
    "short_term": string[],
    "long_term": string[]
  },
  "linkedin": {
    "headline": string,
    "summary": string,
    "skills": string[],
    "experience_bullets": string[]
  },
  "interview": {
    "tips": string[],
    "example_questions": string[],
    "sample_answers": string[]
  },
  "visa": {
    "status": string,
    "best_fit_route": string,
    "alternative_routes": string[],
    "next_steps": string[]
  },
  "profile": {
    "headline": string,
    "summary": string,
    "strengths": string[],
    "sectors": string[],
    "ideal_roles": string[],
    "key_contributions": string[]
  },
  "gap": {
    "scenario": string,
    "cv_line": string,
    "interview_answer": string,
    "email_to_recruiter": string
  },
  "resume": {
    "summary": string,
    "improvements": string[],
    "ats_score_before": number,
    "ats_score_after": number,
    "keywords_added": string[],
    "rewritten_resume": string
  }
}

IMPORTANT RULES:
- Do NOT include any extra top-level keys.
- Do NOT wrap the JSON in markdown.
- Do NOT add comments or explanations.
- ONLY return JSON.
    `.trim();

    const userPrompt = `
Current role: ${safeCurrentRole}
Target role: ${safeTargetRole}
Years of experience: ${safeYears}
Sector: ${safeSector}

Job description (optional):
${safeJobDesc}

Candidate CV text:
${cvText}
    `.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    let jsonText = response.output?.[0]?.content?.[0]?.text?.trim() ?? "";

    // Strip ```json fences if the model adds them
    if (jsonText.startsWith("```")) {
      jsonText = jsonText
        .replace(/^```[a-zA-Z]*\n?/, "")
        .replace(/```$/, "");
    }

    let data;
    try {
      data = JSON.parse(jsonText);
    } catch {
      const match = jsonText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          data = JSON.parse(match[0]);
        } catch {
          return res.status(200).json({
            ok: false,
            error: "Failed to parse AI response",
            rawText: jsonText,
          });
        }
      } else {
        return res.status(200).json({
          ok: false,
          error: "Failed to parse AI response",
          rawText: jsonText,
        });
      }
    }

    if (typeof data.ok !== "boolean") {
      data.ok = true;
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("career-pack error", err);
    return res.status(200).json({
      ok: false,
      error: "Server error while generating career pack",
    });
  }
}
