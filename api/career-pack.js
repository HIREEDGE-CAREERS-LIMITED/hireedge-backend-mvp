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

  // Allow fixed origins + any *.vercel.app deployment
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

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const {
      // core career info (already used today)
      fullName,
      currentRole,
      targetRole,
      yearsExperience,
      sector,
      location,
      jobDescription,
      jobText,
      cvText,

      // extra inputs so Pack can mimic other engines
      // (you can wire these from your /pack form step-by-step)
      careerGoal,          // e.g. "Sales Manager in UK retail within 6–12 months"
      visaStatus,          // e.g. "Student visa, expiring 2026"
      targetCountry,       // e.g. "UK"
      visaMainGoal,        // e.g. "Work and settle long term"
      gapDetails,          // plain text: type of gap, dates, reason, what you did
      profileHighlights,   // bullet points of strengths / achievements
      preferredSectors,    // comma-separated or text
      salaryRange,         // optional text
    } = req.body || {};

    if (!cvText) {
      return res
        .status(400)
        .json({ ok: false, error: "cvText is required for analysis" });
    }

    const safeFullName   = fullName || "Candidate";
    const safeCurrent    = currentRole || "Not specified";
    const safeTarget     = targetRole || "Not specified";
    const safeYears      = yearsExperience || "Not specified";
    const safeSector     = sector || "Not specified";
    const safeLocation   = location || "Not specified";
    const safeJobDesc    = jobDescription || jobText || "Not provided";
    const safeGoal       = careerGoal || "Not specified";
    const safeVisaStatus = visaStatus || "Not specified";
    const safeTargetCtry = targetCountry || "UK";
    const safeVisaGoal   = visaMainGoal || "Work on a sponsored skilled role";
    const safeGapDetails = gapDetails || "Candidate has no major career gaps or prefers not to highlight them.";
    const safeHighlights = profileHighlights || "Use the CV to infer strengths, achievements and impact.";
    const safePrefSectors = preferredSectors || safeSector;
    const safeSalary     = salaryRange || "Not specified";

    // 🔹 One prompt that drives all 8 engines + pack
    const systemPrompt = `
You are HireEdge's One-Click Career Pack Engine.

Your job is to behave like ALL 8 HireEdge AI engines at once and output a
single JSON object that powers the One-Click Career Pack page AND the
individual engine pages.

You MUST return ONLY valid JSON with this EXACT structure and keys:

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
    "summary": string,
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
    "role_summary": string,
    "tips": string[],
    "example_questions": string[],
    "sample_answers": string[]
  },

  "visa": {
    "status": string,
    "best_fit_route": string,
    "key_requirements": string[],
    "risks": string[],
    "next_steps": string[],
    "alternative_routes": string[]
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

MAPPING TO ENGINES (IMPORTANT):

- "ats"       -> ATS Resume Optimiser section on /resume and inside Pack.
- "skills"    -> Skills Match & Gap section and skills-gap engine.
- "roadmap"   -> 3-stage AI Career Roadmap engine.
- "linkedin"  -> LinkedIn Profile Optimiser engine.
- "interview" -> AI Interview Prep Coach engine.
- "visa"      -> AI Visa Pathway Finder engine.
- "profile"   -> AI Talent Profile Generator engine.
- "gap"       -> Career Gap Explainer engine.
- "resume"    -> Full ATS-friendly rewrites and scores for the CV.

RULES:
- Use ALL the structured inputs and the full CV + job description.
- Be concrete, UK-job-market realistic and endorsement-friendly.
- Do NOT invent impossible visa routes or legal guarantees.
- Do NOT include ANY keys outside the schema above.
- Do NOT wrap the JSON in markdown.
- Do NOT write comments or explanations.
    `.trim();

    const userPrompt = `
CANDIDATE CORE INFO
- Name: ${safeFullName}
- Current role: ${safeCurrent}
- Target role: ${safeTarget}
- Years of experience: ${safeYears}
- Sector: ${safeSector}
- Location: ${safeLocation}
- Career goal: ${safeGoal}
- Preferred sectors: ${safePrefSectors}
- Target salary range: ${safeSalary}

VISA CONTEXT (for visa engine)
- Current visa / status: ${safeVisaStatus}
- Target country: ${safeTargetCtry}
- Main visa goal: ${safeVisaGoal}

CAREER GAP CONTEXT (for gap engine)
${safeGapDetails}

PROFILE HIGHLIGHTS (for talent profile engine)
${safeHighlights}

JOB DESCRIPTION (for ATS, skills, roadmap, LinkedIn, interview)
${safeJobDesc}

FULL CV TEXT
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
