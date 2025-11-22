// /api/career-pack.js

import OpenAI from "openai";

const ALLOWED_ORIGIN = "https://hireedge-mvp-web.vercel.app";

export default async function handler(req, res) {
  // --- CORS ---
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
      experienceYears,
      sector,
      jobDescription,
      cvText
    } = req.body || {};

    if (!cvText || !currentRole || !targetRole) {
      return res.status(400).json({
        ok: false,
        error: "currentRole, targetRole and cvText are required"
      });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const promptPayload = {
      currentRole,
      targetRole,
      experienceYears,
      sector,
      jobDescription,
      cvText
    };

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      input: [
        {
          role: "system",
          content: `
You are HireEdge's One-Click Career Pack Engine.

You receive a candidate's CV text, job description, and career context.
Return a SINGLE JSON object with this EXACT structure:

{
  "ok": true,
  "ats": {
    "match": boolean,
    "gaps": string[],
    "recommendations": string[]
  },
  "skills": {
    "matched": string[],
    "missing": string[]
  },
  "roadmap": {
    "immediate": string[],
    "shortTerm": string[],
    "longTerm": string[]
  },
  "linkedin": {
    "headline": string,
    "summary": string,
    "skills": string[]
  },
  "interview": {
    "tips": string[],
    "questions": string[]
  },
  "visa": {
    "status": string,
    "recommendation": string
  }
}

Rules:
- Always include every field above (no null, no missing keys).
- Use short, clear bullet points in arrays.
- Tailor everything to the candidate data provided.
- Never include markdown, explanations, or extra text outside the JSON object.
        `
        },
        {
          role: "user",
          content: JSON.stringify(promptPayload)
        }
      ]
    });

    // New Responses API: text content is in output[0].content[0].text
    const raw =
      response?.output?.[0]?.content?.[0]?.text ||
      response?.output_text ||
      "";

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error("Failed to parse AI JSON:", e, raw);
      return res
        .status(500)
        .json({ ok: false, error: "Failed to parse AI response" });
    }

    // Basic safety normalisation
    const normalised = {
      ok: true,
      ats: {
        match: !!data?.ats?.match,
        gaps: Array.isArray(data?.ats?.gaps) ? data.ats.gaps : [],
        recommendations: Array.isArray(data?.ats?.recommendations)
          ? data.ats.recommendations
          : []
      },
      skills: {
        matched: Array.isArray(data?.skills?.matched)
          ? data.skills.matched
          : [],
        missing: Array.isArray(data?.skills?.missing)
          ? data.skills.missing
          : []
      },
      roadmap: {
        immediate: Array.isArray(data?.roadmap?.immediate)
          ? data.roadmap.immediate
          : [],
        shortTerm: Array.isArray(data?.roadmap?.shortTerm)
          ? data.roadmap.shortTerm
          : [],
        longTerm: Array.isArray(data?.roadmap?.longTerm)
          ? data.roadmap.longTerm
          : []
      },
      linkedin: {
        headline: data?.linkedin?.headline || "",
        summary: data?.linkedin?.summary || "",
        skills: Array.isArray(data?.linkedin?.skills)
          ? data.linkedin.skills
          : []
      },
      interview: {
        tips: Array.isArray(data?.interview?.tips)
          ? data.interview.tips
          : [],
        questions: Array.isArray(data?.interview?.questions)
          ? data.interview.questions
          : []
      },
      visa: {
        status: data?.visa?.status || "",
        recommendation: data?.visa?.recommendation || ""
      }
    };

    return res.status(200).json(normalised);
  } catch (err) {
    console.error("career-pack error", err);
    return res
      .status(500)
      .json({ ok: false, error: "Career pack generation failed" });
  }
}
