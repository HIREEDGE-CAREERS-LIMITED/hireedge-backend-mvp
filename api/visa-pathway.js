import OpenAI from "openai";

const ALLOWED_ORIGIN = "https://hireedge-mvp-web.vercel.app";

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
    const { profile, targetCountry, goal } = req.body;

    if (!profile) {
      return res
        .status(400)
        .json({ ok: false, error: "Profile summary is required" });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `
You are the "HireEdge Visa Pathway Engine".

Task:
- Analyse a candidate's profile and high-level goals.
- Suggest realistic visa / immigration pathways.
- Focus on clarity & practicality (NOT legal advice).

Always respond ONLY with this JSON:

{
  "targetCountry": string,
  "goal": string,
  "bestRoute": {
    "name": string,
    "summary": string,
    "whyGoodFit": string,
    "keyRequirements": string[],
    "risksOrLimitations": string[],
    "nextSteps": string[]
  },
  "alternativeRoutes": [
    {
      "name": string,
      "summary": string,
      "whenToUse": string,
      "keyRequirements": string[]
    }
  ],
  "disclaimer": string
}

Guidelines:
- Use country-specific visa names when possible (e.g. UK Skilled Worker, UK Graduate, UK Innovator Founder, Canada Express Entry etc.), but only where they fit.
- Don't invent impossible paths.
- Disclaimer must say this is information only, not legal advice.
- Do NOT include backticks or any extra explanation outside JSON.
        `.trim(),
        },
        {
          role: "user",
          content: `
CANDIDATE PROFILE:
${profile}

TARGET COUNTRY:
${targetCountry || "UK"}

GOAL (work, study, startup, family etc.):
${goal || "work"}

Return JSON only.
        `.trim(),
        },
      ],
    });

    const raw = response.output[0].content[0].text;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("visa-pathway JSON parse error:", raw);
      return res.status(500).json({
        ok: false,
        error: "Failed to parse AI response",
        raw,
      });
    }

    const result = {
      ok: true,
      targetCountry: parsed.targetCountry || targetCountry || "UK",
      goal: parsed.goal || goal || "",
      bestRoute: parsed.bestRoute || null,
      alternativeRoutes: parsed.alternativeRoutes || [],
      disclaimer:
        parsed.disclaimer ||
        "This is general information only and is not legal or immigration advice.",
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("visa-pathway error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Visa pathway engine failed" });
  }
}
