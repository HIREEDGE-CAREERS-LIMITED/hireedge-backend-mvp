// /api/career-pack.js
import OpenAI from "openai";

// Allow Webflow, custom domain, both Vercel apps, backend & localhost
const ALLOWED_ORIGINS = [
  // Custom domain
  "https://hireedge.co.uk",
  "https://www.hireedge.co.uk",

  // Next.js apps on Vercel
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-mvp-c3z4ksfm6-srinath-senthilkumars-projects.vercel.app",

  // Webflow staging
  "https://hireedge-2d4baa.webflow.io",

  // Backend (if ever called directly from same origin)
  "https://hireedge-backend-mvp.vercel.app",

  // Local dev
  "http://localhost:3000",
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
    "missing": string[]
  },
  "roadmap": {
    "immediate": string[],
    "short_term": string[],
    "long_term": string[]
  },
  "linkedin": {
    "headline": string,
    "summary": string,
    "skills": string[]
  },
  "interview": {
    "tips": string[],
    "example_questions": string[]
  },
  "visa": {
    "status": string,
    "recommendation": string
  }
}

Do NOT include any extra keys.
Do NOT include explanations, markdown or comments.
ONLY return JSON.
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

    const content = response.output[0]?.content?.[0]?.text ?? "";
    let jsonText = content.trim();

    // Strip ```json fences if model adds them
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
    }

    let data;
    try {
      data = JSON.parse(jsonText);
    } catch {
      // Last attempt: extract first {...} block
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
