// POST /api/talent-profile
// Body: { name, headline, skills, experience }

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

      const { name, headline, skills = [], experience = "" } = data;

      if (!name || !headline) {
        return res.status(400).json({
          error: "name and headline are required"
        });
      }

      const skillList =
        skills && skills.length ? skills.join(", ") : "core professional skills";

      const profile = {
        name,
        headline,
        skills,
        summary: `Professional with strengths in ${skillList}. Experienced in delivering results through adaptability, teamwork, and stakeholder communication.`,
        experience: experience || "Experience details coming soon.",
        profileSections: {
          about: `${name} is a driven professional with strong capabilities in ${skillList}. Known for problem-solving, ownership, and consistent execution.`,
          highlights: [
            "Strong communication & leadership capabilities",
            "Ability to manage multiple responsibilities",
            "Experience working in fast-paced environments",
            "Enthusiastic learner with a growth mindset"
          ],
          skills: skills,
          finalNote:
            "This is an auto-generated Talent Profile. The engine will become more advanced in future versions."
        }
      };

      return res.status(200).json({
        ok: true,
        profile
      });
    });
  } catch (err) {
    console.error("talent-profile error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
