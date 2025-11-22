import OpenAI from "openai";

const ALLOWED_ORIGIN = "https://hireedge-mvp-web.vercel.app";

export default async function handler(req, res) {
  // CORS headers for all requests
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight (OPTIONS) request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      currentRole,
      targetRole,
      skills = [],
      experienceYears,
    } = req.body;

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: `
You are the "HireEdge Career Roadmap Engine".
You create practical, step-by-step career roadmaps ONLY in JSON.

Always respond with this exact JSON structure:
{
  "summary": string,
  "timeframe_months": number,
  "stages": [
    {
      "name": string,
      "duration_weeks": number,
      "goals": string[],
      "skills_to_learn": string[],
      "resources": [
        { "type": string, "name": string, "provider": string, "notes": string }
      ]
    }
  ],
  "target_roles": string[]
}

Do NOT add explanations or text outside JSON.
        `.trim(),
        },
        {
          role: "user",
          content: `
Current role: ${currentRole || "Not provided"}
Target role: ${targetRole || "Not sure"}
Experience (years): ${experienceYears ?? "Not provided"}
Current skills: ${Array.isArray(skills) ? skills.join(", ") : skills}

Create a realistic roadmap for this person.
        `.trim(),
        },
      ],
    });

    const raw = response.output[0].content[0].text;
    let roadmap;

    try {
      roadmap = JSON.parse(raw);
    } catch (e) {
      roadmap = { summary: "Error parsing JSON", raw };
    }

    return res.status(200).json({ ok: true, roadmap });
  } catch (err) {
    console.error("Roadmap error:", err);
    return res.status(500).json({ ok: false, error: "Roadmap engine failed" });
  }
}
