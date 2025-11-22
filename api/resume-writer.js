// /api/resume-writer.js
// Full AI resume writer from CV + Job Description (improved prompt)

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

Your job is to REWRITE the user's CV into a clean, ATS-friendly resume that is
tailored to the job description BUT ALWAYS stays honest and consistent with
the CV.

JOB DESCRIPTION:
${jobDescription}

CURRENT CV:
${cvText}

VERY IMPORTANT RULES (MUST FOLLOW ALL):
- DO NOT invent experience, industries, tools or domains that are NOT clearly present
  in the CURRENT CV. If the job mentions something (for example, "gun trade",
  "shooting industry", "blockchain") but the CV does NOT mention it, do NOT claim
  the candidate has experience in that area.
- You MAY slightly adjust wording to be closer to the job description, but keep all
  facts true to the original CV.
- If the job mentions a special domain not in the CV, you can at most say the
  candidate is "keen to learn" or "open to developing experience in" that area –
  never say they are already an expert if it's not in the CV.

STRUCTURE RULES:
- Use plain text only (NO markdown, no tables, no bullet symbols like ⭐).
- Structure the resume clearly with these headings in CAPS, in this order:

  PROFILE
  KEY SKILLS
  EXPERIENCE
  EDUCATION
  ADDITIONAL

- Under PROFILE:
  - 3–5 lines summarising background, years of experience, key strengths and
    what type of roles the person is targeting, using UK spelling.

- Under KEY SKILLS:
  - 8–14 skills as a simple list using "- " bullets.
  - Only include skills that are consistent with the CV (e.g. sales, customer
    service, CRM, data analysis, team leadership, etc).
  - You may include a SMALL number of job-related keywords if they logically fit
    the CV, but do not randomly add industry-specific items that do not match.

- Under EXPERIENCE:
  - List roles in reverse-chronological order (most recent first).
  - For EACH role:
    - First line: "Job Title, Company, Location, Dates"
      (Dates can be in format "MM/YYYY – MM/YYYY" or "YYYY – YYYY").
    - Then 3–6 bullet points starting with "- ".
    - Focus bullet points on achievements, responsibilities and outcomes.
    - Keep it factual and consistent with the information in the CV.

- Under EDUCATION:
  - List highest qualifications first.
  - If the CV repeats the same degree/institution (e.g. MBA + PGPM same school,
    same year), MERGE into a single line to avoid duplication.
  - Example merge:
    Instead of:
      "MBA, ICFAI Business School, 2019"
      "Post-Graduate Programme in Management, ICFAI Business School, 2019"
    Use:
      "MBA / Post-Graduate Programme in Management, ICFAI Business School, 2019"

- Under ADDITIONAL:
  - Only include items that appear or are clearly implied in the CV
    (e.g. driving licence, languages, technical tools, LinkedIn link).
  - Do NOT invent certificates or licences.

GENERAL STYLE RULES:
- Use UK spelling and a professional but clear tone.
- Optimise language for ATS and the job description, but keep everything natural
  (no keyword stuffing).
- Do NOT mention "CV", "job description" or "this document" in the final text.
- Do NOT add any explanation or commentary – output ONLY the final resume text.

Now produce the final resume text following exactly these rules.
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
            temperature: 0.5
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
