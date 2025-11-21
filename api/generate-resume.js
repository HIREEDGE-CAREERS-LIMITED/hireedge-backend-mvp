// /api/generate-resume.js
// Enhanced AI Resume Writer Engine (MVP+ Innovation)

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));

    req.on("end", async () => {
      let data = {};
      try {
        data = JSON.parse(body || "{}");
      } catch {
        return res.status(400).json({ error: "Invalid JSON" });
      }

      const { cvText, jobDescription } = data;

      if (!cvText || !jobDescription) {
        return res.status(400).json({
          error: "cvText and jobDescription are required",
        });
      }

      // --- Extract keywords ---
      const rawWords = jobDescription
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3);

      const uniqueKeywords = [...new Set(rawWords)];
      const cvLower = cvText.toLowerCase();

      const matchedKeywords = uniqueKeywords.filter((k) =>
        cvLower.includes(k)
      );
      const missingKeywords = uniqueKeywords.filter(
        (k) => !cvLower.includes(k)
      );

      const atsScore = uniqueKeywords.length
        ? Math.round(
            (matchedKeywords.length / uniqueKeywords.length) * 100
          )
        : 0;

      // ---- Generate rewritten sections ----
      const summary = `A results-driven professional with strong experience in ${matchedKeywords
        .slice(0, 6)
        .join(", ")}. Proven ability to match job requirements, deliver measurable results and adapt to dynamic business environments.`;

      const skills = [
        ...new Set([
          ...matchedKeywords.slice(0, 12),
          "communication",
          "leadership",
          "customer service",
          "problem-solving",
        ]),
      ];

      const rewrittenExperience = `
Rewritten Experience (ATS-Aligned)
• Delivered measurable results aligned to job requirements.
• Strengthened performance in areas such as: ${matchedKeywords
        .slice(0, 8)
        .join(", ")}.
• Applied strong analytical and operational skills to support business objectives.
• Collaborated with cross-functional teams to improve performance and service quality.
• Demonstrated adaptability and consistent achievement in demanding environments.
`;

      const optimisedResume = `
========================================
ATS-Optimised Resume (AI Draft)
========================================

⭐ **Professional Summary**
${summary}

⭐ **Key Skills**
${skills.join(", ")}

⭐ **Experience Highlights (AI-Rewritten)**
${rewrittenExperience}

⭐ **Original CV (First 700 characters)**
${cvText.substring(0, 700)}${cvText.length > 700 ? "..." : ""}
`;

      return res.status(200).json({
        ok: true,
        atsScore,
        matchedKeywords,
        missingKeywords,
        optimisedResume,
      });
    });
  } catch (err) {
    console.error("Resume Engine Error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
