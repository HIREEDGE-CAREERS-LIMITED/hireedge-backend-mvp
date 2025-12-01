// /api/resume-writer.js
// Full AI resume writer from CV + Job Description

import OpenAI from "openai";

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
];

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  // ----- CORS -----
  const origin = req.headers.origin;
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(200).end();
  // ----- END CORS -----

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({
      ok: false,
      error: "OPENAI_API_KEY is not set in environment",
    });
  }

  try {
    const { cvText, jobDescription } = req.body || {};

    if (!cvText || !jobDescription) {
      return res.status(200).json({
        ok: false,
        error: "cvText and jobDescription are required",
      });
    }

    const prompt = `
You are an expert UK CV writer.

Rewrite the user's CV into a clean, ATS-friendly resume that is tailored
to this job description.

JOB DESCRIPTION:
${jobDescription}

CURRENT CV:
${cvText}

Rules:
- Use plain text only (NO markdown, no tables, no bullet symbols like ⭐).
- Structure the resume clearly with these headings in CAPS:
  PROFILE
  KEY SKILLS
  EXPERIENCE
  EDUCATION
  ADDITIONAL
- Under EXPERIENCE, list roles in reverse-chronological order with:
  Job Title, Company, Location, Dates on one line,
  then 3–6 short bullet points (use "- " at the start).
- Optimise language for the job description and include relevant keywords,
  but keep it natural (no keyword stuffing).
- Use UK spelling and style.
- Do NOT write any explanation, only output the final resume text.
`.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [{ role: "user", content: prompt }],
      temperature: 0.6,
    });

    let resumeText = response.output?.[0]?.content?.[0]?.text?.trim() ?? "";

    if (resumeText.startsWith("```")) {
      resumeText = resumeText
        .replace(/^```[a-zA-Z]*\n?/, "")
        .replace(/```$/, "")
        .trim();
    }

    return res.status(200).json({
      ok: true,
      resumeText,
    });
  } catch (err) {
    console.error("resume-writer error", err);
    return res.status(200).json({
      ok: false,
      error: "Internal server error",
    });
  }
}
