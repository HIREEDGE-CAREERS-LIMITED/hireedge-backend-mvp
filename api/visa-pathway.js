// /api/visa-pathway.js
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js"; // ← ADDED
import { updateCareerContext } from "../../utils/careerContext"; // ← ADDED

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
];

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ← ADDED: extracts user_id from the Bearer token sent by the frontend
async function getUserIdFromToken(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { data } = await supabase.auth.getUser(token);
    return data?.user?.id || null;
  } catch (e) {
    console.warn("getUserIdFromToken failed:", e.message);
    return null;
  }
}

// ← ADDED: detects visa type from the recommended route name
function extractVisaStatus(routeName) {
  if (!routeName) return null;
  const lower = routeName.toLowerCase();
  if (lower.includes("graduate")) return "Graduate Visa";
  if (lower.includes("skilled worker")) return "Skilled Worker Visa";
  if (lower.includes("student")) return "Student Visa";
  if (lower.includes("innovator")) return "Innovator Founder Visa";
  if (lower.includes("global talent")) return "Global Talent Visa";
  if (lower.includes("health and care")) return "Health and Care Visa";
  return routeName;
}

// ← ADDED: checks if the route implies sponsorship is needed
function detectsSponsorshipNeeded(route) {
  if (!route) return false;
  const text = JSON.stringify(route).toLowerCase();
  return text.includes("sponsor") || text.includes("skilled worker");
}

export default async function handler(req, res) {
  // ----- CORS -----
  const origin = req.headers.origin;
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization"); // ← ADDED Authorization
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") return res.status(200).end();
  // ----- END CORS -----

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { profile, targetCountry, goal } = req.body || {};

    if (!profile) {
      return res.status(200).json({
        ok: false,
        error: "Profile summary is required",
      });
    }

    const systemPrompt = `
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
    `.trim();

    const userPrompt = `
CANDIDATE PROFILE:
${profile}
TARGET COUNTRY:
${targetCountry || "UK"}
GOAL (work, study, startup, family etc.):
${goal || "work"}
Return JSON only.
    `.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    let raw = response.output?.[0]?.content?.[0]?.text?.trim() ?? "";
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("visa-pathway JSON parse error:", raw);
      return res.status(200).json({
        ok: false,
        error: "Failed to parse AI response",
        rawText: raw,
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

    // ← ADDED: save visa context so other engines can use it
    // This runs silently — it never blocks or breaks the response
    try {
      const userId = await getUserIdFromToken(req);
      if (userId && parsed.bestRoute) {
        await updateCareerContext(userId, {
          last_visa_route: parsed.bestRoute.name,
          visa_status: extractVisaStatus(parsed.bestRoute.name),
          requires_sponsorship: detectsSponsorshipNeeded(parsed.bestRoute),
        });
      }
    } catch (ctxErr) {
      // ← context save failing should NEVER break the engine response
      console.warn("visa-pathway: context save failed silently:", ctxErr.message);
    }
    // ← END ADDED

    return res.status(200).json(result);

  } catch (err) {
    console.error("visa-pathway error:", err);
    return res.status(200).json({
      ok: false,
      error: "Visa pathway engine failed",
    });
  }
}
