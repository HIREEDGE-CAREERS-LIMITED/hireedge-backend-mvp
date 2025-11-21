// POST /api/skills-matching
// Body: { cvText: string, jobDescription: string }
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let body = "";

    req.on("data", chunk => {
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

      // TODO: replace with real NLP/AI skill extraction
      const mockCvSkills = ["Communication", "Teamwork", "Problem Solving"];
      const mockJobSkills = ["Teamwork", "Stakeholder Management", "Leadership"];

      const matchedSkills = mockCvSkills.filter(s =>
        mockJobSkills.includes(s)
      );
      const missingSkills = mockJobSkills.filter(
        s => !mockCvSkills.includes(s)
      );

      const fitScore =
        Math.round(
          (matchedSkills.length / (mockJobSkills.length || 1)) * 100
        ) || 0;

      return res.status(200).json({
        ok: true,
        fitScore,
        matchedSkills,
        missingSkills,
        explanation:
          "This is a placeholder engine. In the real system we will parse both CV and job description to extract and compare skills."
      });
    });
  } catch (err) {
    console.error("skills-matching error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
