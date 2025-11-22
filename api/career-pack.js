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
    const {
      jobDescription = "",
      cvText = "",
      currentRole = "",
      targetRole = "",
      experienceYears = "",
      sector = ""
    } = req.body;

    if (!cvText || !currentRole || !targetRole)
      return res.status(400).json({ ok: false, error: "Missing required fields" });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `
You are HireEdge’s Career Pack Engine.

Generate ONLY valid JSON.

Input:
Current role: ${currentRole}
Target role: ${targetRole}
Experience: ${experienceYears}
Sector: ${sector}
Job description: ${jobDescription}
CV text: ${cvText}

Return JSON EXACTLY like this:

{
 "ok": true,
 "ats": {
   "match": true/false,
   "gaps": ["text"],
   "recommendations": ["text"]
 },
 "skills": {
   "explicit": ["text"],
   "missing": ["text"]
 },
 "roadmap": {
   "immediate": ["text"],
   "short_term": ["text"],
   "long_term": ["text"]
 },
 "linkedin": {
   "headline": "text",
   "summary": "text",
   "skills": ["text"]
 },
 "interview": {
   "tips": ["text"],
   "example_questions": ["text"]
 },
 "visa": {
   "status": "text",
   "recommendation": "text"
 }
}
    `;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      response_format: { type: "json_object" }
    });

    const output = response.output[0].content[0].text;
    const json = JSON.parse(output);

    return res.status(200).json(json);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Server error",
      details: err.message
    });
  }
}
