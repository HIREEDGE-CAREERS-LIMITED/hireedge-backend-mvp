// POST /api/generate-resume
// Body: { rawText: string, jobTitle?: string }
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let body = "";

    // Collect request body (Vercel Node function style)
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

      const { rawText, jobTitle } = data;

      if (!rawText || typeof rawText !== "string") {
        return res.status(400).json({ error: "rawText is required" });
      }

      // TODO: replace with real AI call (OpenAI, etc.)
      const generatedResume = {
        summary: `Optimised resume for: ${jobTitle || "Target Role"}`,
        sections: [
          {
            title: "Profile",
            bullets: [
              "Results-driven professional with experience tailored to the target role.",
              "Skilled in communication, problem-solving, and continuous learning."
            ]
          },
          {
            title: "Key Skills",
            bullets: [
              "Adaptability",
              "Stakeholder Management",
              "Analytical Thinking"
            ]
          }
        ],
        raw_output: `This is a placeholder generated resume based on the input.\n\nOriginal Text:\n${rawText.slice(
          0,
          500
        )}...`
      };

      return res.status(200).json({
        ok: true,
        generatedResume
      });
    });
  } catch (err) {
    console.error("generate-resume error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
