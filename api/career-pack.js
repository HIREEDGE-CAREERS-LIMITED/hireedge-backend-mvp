// api/career-pack.js
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

    // Minimal validation – same fields as frontend sends
    if (!cvText || !currentRole || !targetRole) {
      return res.status(400).json({
        ok: false,
        error: "currentRole, targetRole and cvText are required"
      });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      max_output_tokens: 1200,
      input: [
        {
          role: "system",
          content: `
You are HireEdge's One-Click Career Pack Engine.

You receive:
- currentRole
- targetRole
- experienceYears
- sector
- jobDescription (optional)
- cvText (full CV text)

Return a SINGLE valid JSON object ONLY, no explanation, with this exact shape:

{
  "ats": {
    "score": number,
    "strengths": [string],
    "risks": [string]
  },
  "skillsMatch": {
    "overallFit": number,
    "matched": [string],
    "gaps": [string],
    "learningPlan": [
      {
        "area": string,
        "actions": [string]
      }
    ]
  },
  "roadmap": {
    "summary": string,
    "months": number,
    "stages": [
      {
        "name": string,
        "timeframe": string,
        "focus": [string]
      }
    ]
  },
  "linkedin": {
    "headline": string,
    "about": string,
    "keywords": [string]
  },
  "interview": {
    "summary": string,
    "questions": [
      {
        "question": string,
        "sampleAnswerBulletPoints": [string]
      }
    ]
  },
  "visa": {
    "note": string,
    "ukRoutes": [string]
  }
}

Rules:
- JSON MUST be valid and parseable.
- Use numbers for scores (0–100).
- Keep text concise but useful for a real candidate.
- Tailor everything to the provided data.
`
        },
        {
          role: "user",
          content: `
Current role: ${currentRole}
Target role: ${targetRole}
Years of experience: ${experienceYears || "Not specified"}
Sector: ${sector || "Not specified"}

Job description (if any):
${jobDescription || "Not provided"}

Candidate CV:
${cvText}
`
        }
      ]
    });

    const raw =
      response.output?.[0]?.content?.[0]?.text ??
      response.output_text ??
      "";

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.error("career-pack JSON parse error:", err, raw);
      return res.status(500).json({
        ok: false,
        error: "Failed to parse AI response"
      });
    }

    return res.status(200).json({
      ok: true,
      ...data
    });
  } catch (err) {
    console.error("career-pack error:", err);
    return res.status(500).json({
      ok: false,
      error: "Career pack generation failed"
    });
  }
}
