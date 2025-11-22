// /api/career-pack.js
import OpenAI from "openai";

const ALLOWED_ORIGIN = "https://hireedge-mvp-web.vercel.app";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
    const {
      currentRole,
      targetRole,
      yearsExperience,
      sector,
      jobDescription,
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
    const safeJobDesc = jobDescription || "Not provided";

    const systemPrompt = `
You are HireEdge's One-Click Career Pack Engine.

You MUST return a **valid JSON object only**, with this exact structure and keys:

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

    // Sometimes model wraps in ```json ```
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
    }

    let data;
    try {
      data = JSON.parse(jsonText);
    } catch (parseErr) {
      // Try to recover JSON substring if anything weird came back
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

    // Ensure ok flag exists
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
