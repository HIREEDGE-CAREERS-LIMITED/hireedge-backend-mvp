// POST /api/career-roadmap
// Body: { currentRole: string, skills: string[], targetIndustry?: string }
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

      const { currentRole, skills = [], targetIndustry = "General" } = data;

      if (!currentRole) {
        return res
          .status(400)
          .json({ error: "currentRole is required" });
      }

      // TODO: replace with real AI roadmap using labour market data
      const mockRoadmap = [
        {
          step: 1,
          title: "Short-Term (0–6 months)",
          suggestedRole: `Senior ${currentRole}`,
          actions: [
            "Complete 1–2 advanced online courses.",
            "Lead at least one small project or initiative.",
            "Collect measurable achievements and metrics."
          ]
        },
        {
          step: 2,
          title: "Mid-Term (6–18 months)",
          suggestedRole: `Team Lead / Manager in ${targetIndustry}`,
          actions: [
            "Build leadership and stakeholder management skills.",
            "Mentor junior colleagues.",
            "Contribute to cross-functional projects."
          ]
        },
        {
          step: 3,
          title: "Long-Term (18–36 months)",
          suggestedRole: `Strategic Lead / Head of Function`,
          actions: [
            "Focus on strategy and business impact.",
            "Develop personal brand via LinkedIn and networking.",
            "Consider formal certifications or executive education."
          ]
        }
      ];

      return res.status(200).json({
        ok: true,
        currentRole,
        targetIndustry,
        skills,
        roadmap: mockRoadmap,
        note:
          "This is a placeholder roadmap. The production version will use AI + market data to generate personalised journeys."
      });
    });
  } catch (err) {
    console.error("career-roadmap error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
