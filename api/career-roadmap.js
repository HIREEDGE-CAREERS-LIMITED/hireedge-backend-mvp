// POST /api/career-roadmap
// Body: { currentRole: string, skills?: string[], targetIndustry?: string }

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

      const { currentRole, skills = [], targetIndustry = "General" } = data;

      if (!currentRole) {
        return res.status(400).json({ error: "currentRole is required" });
      }

      const skillSummary =
        skills && skills.length
          ? skills.slice(0, 8).join(", ")
          : "core professional skills";

      const roadmap = [
        {
          step: 1,
          horizon: "0–6 months",
          title: "Short-Term Focus",
          suggestedRole: `Stronger ${currentRole}`,
          actions: [
            "Strengthen foundations in your current responsibilities.",
            "Own at least one measurable project from start to finish.",
            "Collect evidence: metrics, achievements, success stories."
          ]
        },
        {
          step: 2,
          horizon: "6–18 months",
          title: "Mid-Term Move",
          suggestedRole: `Team Lead / Senior ${currentRole} in ${targetIndustry}`,
          actions: [
            "Take informal leadership: mentoring, training, or coaching others.",
            "Increase exposure to stakeholders and cross-functional teams.",
            "Add 2–3 advanced skills to your profile: " + skillSummary + "."
          ]
        },
        {
          step: 3,
          horizon: "18–36 months",
          title: "Long-Term Growth",
          suggestedRole: `Manager / Strategic role in ${targetIndustry}`,
          actions: [
            "Focus on strategy, planning and business impact (not just tasks).",
            "Build personal brand via LinkedIn, events, and networking.",
            "Consider formal certification or specialised training relevant to your path."
          ]
        }
      ];

      return res.status(200).json({
        ok: true,
        currentRole,
        targetIndustry,
        skills,
        roadmap,
        note:
          "This is the first version of the roadmap engine. It builds a clear 3-stage career journey based on your role and skills."
      });
    });
  } catch (err) {
    console.error("career-roadmap error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
