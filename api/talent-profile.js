import OpenAI from "openai";

const ALLOWED_ORIGIN = "https://hireedge-mvp-web.vercel.app";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { fullName, currentRole, experienceYears, skills, cvText } = req.body;

    if (!cvText || !fullName) {
      return res
        .status(400)
        .json({ ok: false, error: "fullName and cvText are required" });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `
You are HireEdge's Talent Profile Engine.
Generate a clean, recruiter-ready talent card from the user's career data.

Return ONLY this JSON structure:

{
  "title": string,
  "bio": string,
  "skills": string[],
  "achievements": string[],
  "expertiseTags": string[],
  "linkedinHeadline": string
}

Rules:
- Title = best role position (ex: "Sales Manager", "Data Analyst").
- Bio = 3 short crisp paragraphs summarizing the user's strengths.
- Skills = 6–12 strongest skills extracted from CV.
- Achievements = 4–8 bullet achievements using STAR style.
- Expertise tags = 6–12 short tags used by recruiters.
- LinkedIn headline = 120–200 character strong headline.
- No backticks, no commentary, JSON only.
        `.trim(),
        },
        {
          role: "user",
          content: `
Full Name: ${fullName}
Current Role: ${currentRole}
Experience: ${experienceYears || "Not specified"} years
Skills: ${skills?.join(", ")}
CV Text:
${cvText}

Create the talent profile JSON.
        `.trim(),
        },
      ],
    });

    const raw = response.output[0].content[0].text;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.log("Talent profile raw:", raw);
      return res.status(500).json({
        ok: false,
        error: "Failed to parse talent profile JSON",
        raw,
      });
    }

    return res.status(200).json({
      ok: true,
      ...parsed,
    });
  } catch (err) {
    console.error("Talent Profile Engine Error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Talent profile generation failed" });
  }
}
