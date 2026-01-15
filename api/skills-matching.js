// api/skills-matching.js
export default async function handler(req, res) {
  try {
    // Only allow POST
    if (req.method !== "POST") {
      res.setHeader("Allow", ["POST"]);
      return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    const { jobDescription = "", cvText = "", targetRole = "" } = req.body || {};

    if (!cvText.trim()) {
      return res.status(400).json({ ok: false, error: "cvText is required" });
    }

    // ✅ If no OpenAI key, return a safe fallback so it never crashes
    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        ok: true,
        overallFit: 40,
        gapSummary:
          "OpenAI_API_KEY missing on backend. Returning fallback response (no AI call).",
        matchedSkills: ["communication", "teamwork"],
        partialMatchSkills: ["analysis"],
        missingSkills: ["stakeholder management", "SQL", "project planning"],
        learningPlan: [
          {
            skill: "stakeholder management",
            actions: [
              "Learn stakeholder mapping (power/interest grid)",
              "Use RACI to define ownership in projects",
              "Add 1 CV bullet showing stakeholder outcomes",
            ],
          },
        ],
        debug: { targetRole, hasJobDescription: !!jobDescription.trim() },
      });
    }

    const prompt = `
Return STRICT JSON only (no markdown) with this schema:
{
  "ok": true,
  "overallFit": number,
  "gapSummary": string,
  "matchedSkills": string[],
  "partialMatchSkills": string[],
  "missingSkills": string[],
  "learningPlan": { "skill": string, "actions": string[] }[]
}

Target role:
${targetRole}

Job Description:
${jobDescription}

CV Text:
${cvText}
`.trim();

    // ✅ Call OpenAI chat completions
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are an expert skills gap analyst." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      }),
    });

    const j = await r.json();

    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        error: "OpenAI request failed",
        detail: j?.error?.message || JSON.stringify(j).slice(0, 500),
      });
    }

    const content = j?.choices?.[0]?.message?.content || "";
    let out;
    try {
      out = JSON.parse(content);
    } catch {
      return res.status(500).json({
        ok: false,
        error: "Model returned invalid JSON",
        raw: content.slice(0, 500),
      });
    }

    return res.status(200).json(out);
  } catch (err) {
    console.error("skills-matching fatal:", err);
    return res.status(500).json({
      ok: false,
      error: "Server crashed",
      detail: String(err?.message || err),
    });
  }
}
