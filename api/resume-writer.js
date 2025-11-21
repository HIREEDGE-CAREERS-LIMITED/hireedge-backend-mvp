// /api/resume-writer.js
// Full AI resume writer from CV + Job Description

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  if (!OPENAI_API_KEY) {
    return res
      .status(500)
      .json({ error: "OPENAI_API_KEY is not set in environment" });
  }

  try {
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));

    req.on("end", async () => {
      let data = {};
      try {
        data = JSON.parse(body || "{}");
      } catch {
        return res.status(400).json({ error: "Invalid JSON body" });
      }

      const { cvText, jobDescription } = data;

      if (!cvText || !jobDescription) {
        return res.status(400).json({
          error: "cvText and jobDescription are required"
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
`;

      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.6
          })
        }
      );

      if (!response.ok) {
        const text = await response.text();
        console.error("OpenAI error:", text);
        return res.status(500).json({ error: "OpenAI API error" });
      }

      const json = await response.json();
      const resumeText = json.choices?.[0]?.message?.content?.trim() || "";

      return res.status(200).json({
        ok: true,
        resumeText
      });
    });
  } catch (err) {
    console.error("resume-writer error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
