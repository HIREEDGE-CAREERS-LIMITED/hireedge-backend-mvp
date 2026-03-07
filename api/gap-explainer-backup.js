// /api/gap-explainer.js
import OpenAI from "openai";

const ALLOWED_ORIGINS = [
  "https://hireedge-backend-mvp.vercel.app", // self
  "https://hireedge-mvp-web.vercel.app",     // old React app
  "https://hireedge-2d4baa.webflow.io",      // Webflow site
  "http://localhost:3000"                    // local dev
];

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ map frontend labels -> internal types
function normalizeGapType(input) {
  const s = String(input || "").trim().toLowerCase();

  // exact/contains mapping (covers your dropdown labels)
  if (s.includes("relocation") || s.includes("moved")) return "relocation";
  if (s.includes("study") || s.includes("cert")) return "study";
  if (s.includes("health") || s.includes("personal")) return "health";
  if (s.includes("caring") || s.includes("family")) return "family";
  if (s.includes("job search") || s.includes("redund")) return "job_search";
  if (s.includes("travel") || s.includes("sabbat")) return "travel";
  if (s.includes("career transition") || s.includes("career change")) return "career_change";

  // if user sends your old internal codes already:
  if (
    ["study","relocation","family","health","job_search","career_change","travel","other"].includes(s)
  ) return s;

  return "other";
}

function safeStr(x) {
  return typeof x === "string" ? x.trim() : "";
}

async function safeReadJsonFromModel(raw) {
  let txt = (raw || "").trim();
  if (txt.startsWith("```")) {
    txt = txt.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
  }
  return JSON.parse(txt);
}

export default async function handler(req, res) {
  // ----- CORS -----
  const origin = req.headers.origin;
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(200).end();
  // ----- END CORS -----

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    // ✅ accept BOTH naming styles (frontend + backend)
    const gapTypeRaw = body.gapType;
    const duration = safeStr(body.duration);
    const previousRole = safeStr(body.previousRole);
    const targetRole = safeStr(body.targetRole);

    // frontend sends whatDidYouDo — backend used reasonDetails earlier
    const reasonDetails = safeStr(body.reasonDetails || body.whatDidYouDo);

    const gapType = normalizeGapType(gapTypeRaw);

    if (!gapTypeRaw) {
      return res.status(200).json({ ok: false, error: "gapType is required" });
    }
    if (!reasonDetails) {
      return res.status(200).json({ ok: false, error: "Please describe what you did during the gap." });
    }

    // ✅ fast fallback templates (in case OpenAI key missing)
    const fromRole = previousRole || "my previous role";
    const toRole = targetRole || "this role";
    const dur = duration ? ` (${duration})` : "";

    const fallback = {
      cvLine: `Planned career break${dur} to focus on ${reasonDetails}, now returning to full-time work aligned with ${toRole}.`,
      interviewAnswer:
        `I took a planned break${dur} to focus on ${reasonDetails}. I stayed structured, kept learning, and I’m now ready to bring that focus back into a full-time role aligned with ${toRole}.`,
      recruiterEmail:
        `You may notice a short gap${dur}. During this time, I focused on ${reasonDetails}. I’m now fully available and actively seeking a long-term opportunity aligned with ${toRole}.`,
      guidanceNote:
        "Keep it honest, positive, and future-focused. Avoid over-explaining; emphasise what you learned and why you’re ready now.",
    };

    // ✅ If OpenAI key not configured, return fallback + extra fields
    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        ok: true,
        gapType,
        duration,
        ...fallback,

        // keep compatibility with your older key names too
        emailParagraph: fallback.recruiterEmail,
        note: fallback.guidanceNote,
      });
    }

    // ---------- AI PROMPTS (premium output) ----------
    const systemPrompt = `
You are "HireEdge Career Gap Coach".

Generate premium, recruiter-ready gap explanations.
Tone: confident, honest, positive, concise (UK job market).
Never mention "I was unemployed". Use "career break" / "planned break" / "transition period".
Avoid medical detail. Avoid personal oversharing.

Return ONLY JSON in this schema:

{
  "cvLine": string,
  "cvLineOptions": string[],
  "interviewAnswer": string,
  "interviewAnswerOptions": string[],
  "recruiterEmail": string,
  "coverLetterLine": string,
  "linkedinLine": string,
  "keyStrengthsToHighlight": string[],
  "doDont": { "do": string[], "dont": string[] },
  "tailoringTips": string[]
}

Rules:
- cvLine <= 180 chars, ATS-friendly.
- interview answers 120–180 words.
- recruiterEmail is a short paragraph (3–5 lines).
- Make it specific to the target role and what they did.
- No markdown, no backticks, JSON only.
`.trim();

    const userPrompt = `
GAP TYPE: ${gapType}
DURATION: ${duration || "Not specified"}
PREVIOUS ROLE: ${previousRole || "Not specified"}
TARGET ROLE: ${targetRole || "Not specified"}

WHAT I DID DURING THE GAP:
${reasonDetails}

Generate premium outputs for CV + interview + recruiter email + LinkedIn.
`.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = response.output?.[0]?.content?.[0]?.text ?? "";
    let parsed;
    try {
      parsed = await safeReadJsonFromModel(raw);
    } catch (e) {
      console.error("gap-explainer parse error:", raw);
      // fallback if model returns bad JSON
      return res.status(200).json({
        ok: true,
        gapType,
        duration,
        ...fallback,
        emailParagraph: fallback.recruiterEmail,
        note: fallback.guidanceNote,
      });
    }

    const result = {
      ok: true,
      gapType,
      duration,

      // ✅ keys your frontend currently renders
      cvLine: safeStr(parsed.cvLine) || fallback.cvLine,
      interviewAnswer: safeStr(parsed.interviewAnswer) || fallback.interviewAnswer,
      recruiterEmail: safeStr(parsed.recruiterEmail) || fallback.recruiterEmail,
      guidanceNote: fallback.guidanceNote,

      // ✅ premium extras (later you can show these in UI)
      cvLineOptions: Array.isArray(parsed.cvLineOptions) ? parsed.cvLineOptions.filter(Boolean) : [],
      interviewAnswerOptions: Array.isArray(parsed.interviewAnswerOptions) ? parsed.interviewAnswerOptions.filter(Boolean) : [],
      coverLetterLine: safeStr(parsed.coverLetterLine),
      linkedinLine: safeStr(parsed.linkedinLine),
      keyStrengthsToHighlight: Array.isArray(parsed.keyStrengthsToHighlight) ? parsed.keyStrengthsToHighlight.filter(Boolean) : [],
      doDont: parsed.doDont && typeof parsed.doDont === "object" ? parsed.doDont : { do: [], dont: [] },
      tailoringTips: Array.isArray(parsed.tailoringTips) ? parsed.tailoringTips.filter(Boolean) : [],

      // ✅ backward compatible old keys (if any other page uses them)
      emailParagraph: safeStr(parsed.recruiterEmail) || fallback.recruiterEmail,
      note: fallback.guidanceNote,
      durationText: duration ? `Approximate duration: ${duration}.` : "",
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error("gap-explainer error", err);
    return res.status(200).json({
      ok: false,
      error: "Server error while generating gap explanation",
    });
  }
}
