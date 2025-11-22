import OpenAI from "openai";

const ALLOWED_ORIGIN = "https://hireedge-mvp-web.vercel.app";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { 
      jobDescription,
      cvText,
      currentRole,
      targetRole,
      sector,
      experienceYears 
    } = req.body;

    if (!cvText) {
      return res.status(400).json({ ok: false, error: "cvText is required" });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `
You are HireEdge’s One-Click Career Pack Engine.
Return ONLY a single VALID JSON object with this structure:

{
  "ok": true,
  "ats": { ... },
  "skills": { ... },
  "roadmap": { ... },
  "linkedin": { ... },
  "interview": { ... },
  "visa": { ... }
}

No explanations, no notes, no markdown.
          `
        },
        {
          role: "user",
          content: `
Job description:
${jobDescription || "N/A"}

CV:
${cvText}

Current Role: ${currentRole}
Target Role: ${targetRole}
Sector: ${sector}
Experience: ${experienceYears}
          `
        }
      ]
    });

    let raw = response.output_text;
    
    // Force strip markdown/filler
    raw = raw.trim();
    raw = raw.replace(/^```json/i, "").replace(/```$/, "");

    let json;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: "Invalid AI JSON response",
        raw
      });
    }

    return res.status(200).json(json);
  } catch (err) {
    console.error("Career pack error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
