// POST /api/generate-resume
// Body: { cvText: string, jobDescription: string }

module.exports = async (req, res) => {
  // ---- CORS HEADERS ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  // ----------------------

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let body = "";

    // Collect request body (Vercel Node function style)
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

      // ---- Simple ATS-style keyword extraction ----
      const words = jobDescription
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3);

      const uniqueKeywords = [...new Set(words)];
      const cvLower = cvText.toLowerCase();

      const matchedKeywords = uniqueKeywords.filter((k) =>
        cvLower.includes(k)
      );
      const missingKeywords = uniqueKeywords.filter(
        (k) => !cvLower.includes(k)
      );

      const atsScore =
        uniqueKeywords.length === 0
          ? 0
          : Math.round((matchedKeywords.length / uniqueKeywords.length) * 100);

      // ---- Simple "optimised" resume draft (placeholder for real AI) ----
      const optimisedResume =
        `ATS-Optimised Resume (Draft)\n\n` +
        `Targeted to this job description. Focuses on key skills and keywords.\n\n` +
        `Summary:\n` +
        `- Experienced professional aligned with the role requirements.\n` +
        `- Highlights strengths in ${matchedKeywords.slice(0, 8).join(", ") || "core role skills"}.\n\n` +
        `Original CV (trimmed):\n` +
        cvText.slice(0, 800) +
        (cvText.length > 800 ? "\n..." : "");

      return res.status(200).json({
        ok: true,
        atsScore,
        matchedKeywords,
        missingKeywords,
        optimisedResume
      });
    });
  } catch (err) {
    console.error("generate-resume error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
