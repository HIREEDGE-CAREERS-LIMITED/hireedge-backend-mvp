// /api/linkedin-optimizer.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Safe parse helper (handles code fences)
function cleanJsonText(raw) {
  let t = String(raw || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return t;
}

export default async function handler(req, res) {
  // ✅ POST only
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { currentRole = "", targetRole = "", industry = "", cvText = "" } = req.body || {};

    if (!String(cvText).trim()) {
      return res.status(400).json({ ok: false, error: "cvText is required" });
    }

    // ✅ fallback if OpenAI key missing
    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        ok: true,
        headline: `${targetRole || currentRole || "Professional"} | ${industry || "Industry"}`,
        about:
          "OpenAI_API_KEY missing on backend. This is a fallback output so the app never crashes.\n\n" +
          "Add OPENAI_API_KEY in Vercel environment variables and redeploy to enable AI output.",
        summary: "Fallback output (no AI call).",
        strengths: ["communication", "teamwork", "problem-solving", "stakeholder management"],
        searchKeywords: ["sales", "customer success", "account management", "business development"],
        hashtags: ["#career", "#jobs", "#linkedin", "#sales"],
        experienceBullets: [
          "Delivered measurable results across targets and KPIs.",
          "Built strong stakeholder relationships and improved outcomes.",
        ],
      });
    }

    const systemPrompt = `
You are the "HireEdge LinkedIn Profile Optimiser".

Generate a high-conversion LinkedIn profile for job search and recruiter visibility.

Always respond with ONLY this JSON structure:

{
  "headline": string,
  "about": string,
  "summary": string,
  "strengths": string[],
  "searchKeywords": string[],
  "hashtags": string[],
  "experienceBullets": string[]
}

Rules:
- Headline max ~220 characters, focused on target role & value.
- About: 3–6 short paragraphs, friendly and professional.
- Strengths: 4–8 bullet points.
- Search keywords: recruiter search terms (no #).
- Hashtags: 5–12 best hashtags for this profile (with #).
- Experience bullets: achievement-style bullet lines.
- Do NOT include backticks or any text outside valid JSON.
`.trim();

    const userPrompt = `
CURRENT ROLE: ${currentRole || "Not specified"}
TARGET ROLE: ${targetRole || "Not specified"}
INDUSTRY: ${industry || "General"}

CANDIDATE CV / BACKGROUND:
${cvText}

Create the LinkedIn profile elements and return JSON only.
`.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    let raw = response.output?.[0]?.content?.[0]?.text ?? "";
    raw = cleanJsonText(raw);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("linkedin-optimizer JSON parse error:", raw);
      return res.status(200).json({
        ok: false,
        error: "Failed to parse AI response",
        rawText: raw,
      });
    }

    return res.status(200).json({
      ok: true,
      headline: parsed.headline || "",
      about: parsed.about || "",
      summary: parsed.summary || "",
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      searchKeywords: Array.isArray(parsed.searchKeywords) ? parsed.searchKeywords : [],
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
      experienceBullets: Array.isArray(parsed.experienceBullets) ? parsed.experienceBullets : [],
    });
  } catch (err) {
    console.error("linkedin-optimizer error:", err);
    return res.status(500).json({
      ok: false,
      error: "LinkedIn optimiser failed. Please try again.",
    });
  }
}
