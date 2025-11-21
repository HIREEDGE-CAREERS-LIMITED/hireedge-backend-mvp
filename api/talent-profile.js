// POST /api/talent-profile
// Body: { name: string, headline?: string, skills: string[], experience: any[] }
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

      const {
        name,
        headline = "Ambitious professional open to new opportunities",
        skills = [],
        experience = []
      } = data;

      if (!name) {
        return res.status(400).json({ error: "name is required" });
      }

      const profileId = Buffer.from(
        `${name}-${Date.now()}`
      ).toString("base64");

      const profile = {
        id: profileId,
        name,
        headline,
        skills,
        experience,
        summary: `${name} is a motivated professional with strengths in ${skills
          .slice(0, 5)
          .join(", ")}.`,
        shareUrl: `https://hireedge-talent-profile.vercel.app/profile/${profileId}` // placeholder
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
