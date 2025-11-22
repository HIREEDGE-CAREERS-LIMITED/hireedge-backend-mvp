// api/career-engine-report.js
const fetch = global.fetch; // Node 18+ on Vercel

module.exports = async (req, res) => {
  // CORS + method checks …

  const { cvText, jobDescription, userProfile } = await readBody(req);

  try {
    const basePayload = { cvText, jobDescription, userProfile };

    // Call all tools in parallel
    const [
      resumeResult,
      atsResult,
      skillsResult,
      roadmapResult,
      linkedinResult,
      interviewResult,
      gapResult
    ] = await Promise.all([
      callInternal("/api/resume-writer", basePayload),
      callInternal("/api/generate-resume", basePayload),
      callInternal("/api/skills-matching", basePayload),
      callInternal("/api/career-roadmap", basePayload),
      callInternal("/api/linkedin-optimiser", basePayload),
      callInternal("/api/interview-questions", basePayload),
      callInternal("/api/gap-explainer", basePayload)
    ]);

    return res.status(200).json({
      ok: true,
      meta: {
        generatedAt: new Date().toISOString(),
        engineVersion: "v1.0.0"
      },
      resume: resumeResult,
      ats: atsResult,
      skills: skillsResult,
      roadmap: roadmapResult,
      linkedin: linkedinResult,
      interview: interviewResult,
      gap: gapResult
    });
  } catch (err) {
    console.error("career-engine-report error", err);
    return res.status(500).json({ ok: false, error: "Internal error" });
  }
};

async function callInternal(path, body) {
  const baseUrl = process.env.INTERNAL_API_BASE || "https://your-backend-url";
  const res = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Error calling ${path}: ${text}`);
  }
  return res.json();
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
