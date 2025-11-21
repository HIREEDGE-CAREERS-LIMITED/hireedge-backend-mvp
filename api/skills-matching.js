// POST /api/skills-matching
// Body: { cvText: string, jobDescription: string }

module.exports = async (req, res) => {
  // ---- CORS HEADERS ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  // ----------------------

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      let data = {};
      try {
        data = JSON.parse(body || "{}");
      } catch (e) {
        return res.status(400).json({ error: "Invalid JSON body" });
      }

      const { cvText, jobDescription } = data;

      if (!cvText || !jobDescription) {
        return res
          .status(400)
          .json({ error: "cvText and jobDescription are required" });
      }

      // ---- Very simple "skill" extraction from job description ----
      const words = jobDescription
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3);

      const uniqueSkills = [...new Set(words)];
      const cvLower = cvText.toLowerCase();

      const matchedSkills = uniqueSkills.filter((s) => cvLower.includes(s));
      const missingSkills = uniqueSkills.filter((s) => !cvLower.includes(s));

      const fitScore =
        uniqueSkills.length === 0
          ? 0
          : Math.round((matchedSkills.length / uniqueSkills.length) * 100);

      return res.status(200).json({
        ok: true,
        fitScore,
        matchedSkills,
        missingSkills,
        explanation:
          "This is a first version Skills Matching engine. It extracts important words from the job description and checks if they appear in the CV."
      });
    });
  } catch (err) {
    console.error("skills-matching error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
