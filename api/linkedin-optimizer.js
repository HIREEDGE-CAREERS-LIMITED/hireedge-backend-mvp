// POST /api/linkedin-optimizer
// Body: { name, currentRole, targetRole?, skills?, achievements?, tone? }

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

      const {
        name,
        currentRole,
        targetRole = "",
        skills = [],
        achievements = "",
        tone = "professional"
      } = data;

      if (!name || !currentRole) {
        return res.status(400).json({
          error: "name and currentRole are required"
        });
      }

      const skillsText =
        skills && skills.length ? skills.join(" · ") : "core professional skills";

      const shortSkills =
        skills && skills.length ? skills.slice(0, 5).join(" | ") : currentRole;

      const cleanTarget =
        targetRole && targetRole.trim().length > 0
          ? targetRole.trim()
          : currentRole;

      // Headline
      const headline = `${currentRole} | ${cleanTarget} | ${shortSkills}`;

      // About section
      const about =
        `${name} is a ${tone === "friendly" ? "people-focused" : "results-driven"} ${currentRole.toLowerCase()} ` +
        `with experience in ${cleanTarget.toLowerCase()}. ` +
        `Skilled in ${skillsText}. ` +
        `Known for taking ownership, building strong relationships and delivering consistent outcomes.\n\n` +
        (achievements
          ? `Key achievements include:\n${achievements.trim()}\n\n`
          : "") +
        `On LinkedIn, ${name.split(" ")[0]} is looking to connect with ` +
        `${cleanTarget.toLowerCase()} opportunities, decision-makers and teams who value growth, learning and collaboration.`;

      // Summary bullets for "About" or "Featured"
      const highlights = [
        `Experience as ${currentRole}`,
        `Strengths in ${skillsText}`,
        "Comfortable working in fast-paced, changing environments",
        "Strong communication and stakeholder management",
        "Committed to continuous learning and improvement"
      ];

      const profile = {
        name,
        currentRole,
        targetRole: cleanTarget,
        skills,
        headline,
        about,
        highlights,
        suggestions: [
          "Add this headline directly to your LinkedIn profile.",
          "Use the About section as your LinkedIn summary (you can shorten it if needed).",
          "Turn the highlights into bullet points in your Experience and Featured sections."
        ]
      };

      return res.status(200).json({
        ok: true,
        profile
      });
    });
  } catch (err) {
    console.error("linkedin-optimizer error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
