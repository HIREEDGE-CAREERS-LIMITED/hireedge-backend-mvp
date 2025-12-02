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

  // Allow fixed domains + any *.vercel.app
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
      jobText, // sometimes sent as jobText
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

    // ---------- 9-ENGINE SYSTEM PROMPT ----------
    const systemPrompt = `
You are HireEdge's 9-Engine One-Click Career Pack Engine.

You MUST return a valid JSON object ONLY, with EXACTLY these top-level keys:

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
    "skills_summary": string
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
  },
  "talent_profile": {
    "one_line_summary": string,
    "strengths": string[],
    "risk_flags": string[]
  },
  "salary": {
    "estimated_range": string,
    "commentary": string
  },
  "builder": {
    "recommended_flow": string[],
    "notes": string
  }
}

MAP each section to one of HireEdge's AI engines:

- "ats"              → ATS Resume Optimiser
- "skills"           → Skills Match & Gap
- "roadmap"          → Career Roadmap
- "linkedin"         → LinkedIn Engine
- "interview"        → Interview Q&A Engine
- "visa"             → Visa & Eligibility Engine (high-level only, no legal advice)
- "talent_profile"   → Smart Talent Profile Engine
- "salary"           → Salary & Market Signals Engine (high-level, no exact numbers)
- "builder"          → AI Builder (suggests which engines to chain and in what order)

RULES:
- Do NOT add or remove top-level keys.
- Do NOT include explanations, markdown, or comments.
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

    // Strip ```json fences if added
    if (jsonText.startsWith("```")) {
      jsonText = jsonText
        .replace(/^```[a-zA-Z]*\n?/, "")
        .replace(/```$/, "")
        .trim();
    }

    let data;
    try {
      data = JSON.parse(jsonText);
    } catch {
      // Try to salvage the first {...} block
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
