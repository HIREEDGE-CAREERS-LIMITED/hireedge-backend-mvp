// api/skills-matching.js

// ✅ No imports needed here unless your old engine logic needs them.
// If your current backend already has OpenAI / Gemini / etc imports, keep them in this file as-is.

export default async function handler(req, res) {
  // ✅ Basic CORS safety (even though we will use web proxy, this won't hurt)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    // ✅ Accept both payload styles (old + new)
    const jobDescription = String(body.jobDescription || "").trim();
    const cvText = String(body.cvText || body.cvSnapshot || "").trim();
    const targetRole = String(body.targetRole || "").trim(); // optional

    if (!jobDescription || !cvText) {
      return res.status(400).json({
        ok: false,
        error: "Missing inputs: jobDescription and cvText are required.",
      });
    }

    // ✅ Run your core analysis
    const out = await runSkillsMatchingLogic({
      jobDescription,
      cvText,
      targetRole,
    });

    // ✅ Normalise output so UI never breaks
    const normalized = normalizeSkillsOutput(out);

    return res.status(200).json({ ok: true, ...normalized });
  } catch (err) {
    console.error("skills-matching error:", err);
    return res.status(500).json({
      ok: false,
      error: "Skills engine failed. Please try again.",
    });
  }
}

/**
 * ✅ PASTE YOUR EXISTING “OLD LOGIC” INSIDE THIS FUNCTION
 * Do NOT change its return keys.
 *
 * Must return:
 *  - overallFit (number 0–100)
 *  - gapSummary (string)
 *  - matchedSkills (array of strings)
 *  - partialMatchSkills (array of strings)
 *  - missingSkills (array of strings)
 *  - learningPlan (array of { skill: string, actions: string[] })
 */
async function runSkillsMatchingLogic({ jobDescription, cvText, targetRole }) {
  // ============================================================
  // ✅ PASTE YOUR OLD ENGINE LOGIC HERE (ONLY HERE)
  // ============================================================
  // Example placeholder (REMOVE when you paste your logic)
  return {
    overallFit: 72,
    gapSummary:
      "Strong alignment on core responsibilities and tools. Build depth in a few missing capabilities to improve role-fit.",
    matchedSkills: ["Stakeholder management", "CRM", "Sales strategy"],
    partialMatchSkills: ["Data analysis", "Automation"],
    missingSkills: ["SQL", "A/B testing", "Lifecycle marketing"],
    learningPlan: [
      {
        skill: "SQL",
        actions: [
          "Complete an intermediate SQL course (joins, window functions).",
          "Practice on real datasets (Sales/CRM exports) weekly.",
          "Build a small portfolio query set for reporting.",
        ],
      },
    ],
  };
}

/**
 * ✅ Ensures UI always receives safe, correctly-typed output
 */
function normalizeSkillsOutput(out) {
  const safeNum = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };

  const safeArr = (v) => (Array.isArray(v) ? v : []);
  const safeStr = (v, d = "") => (typeof v === "string" ? v : d);

  // support alternate key names just in case old logic returns them
  const overallFit =
    out?.overallFit ??
    out?.matchPercent ??
    out?.skillsMatch ??
    out?.score ??
    null;

  const matchedSkills = out?.matchedSkills ?? out?.matched ?? [];
  const partialMatchSkills =
    out?.partialMatchSkills ?? out?.partialSkills ?? out?.partial ?? [];
  const missingSkills = out?.missingSkills ?? out?.gaps ?? out?.missing ?? [];

  let learningPlan = out?.learningPlan ?? out?.roadmap ?? [];
  learningPlan = safeArr(learningPlan).map((x) => ({
    skill: safeStr(x?.skill, ""),
    actions: safeArr(x?.actions).map((a) => safeStr(a, "")).filter(Boolean),
  }));

  return {
    overallFit: safeNum(overallFit, 0),
    gapSummary: safeStr(
      out?.gapSummary,
      "The engine analysed your skills against the role and generated matched, partial, and missing skills."
    ),
    matchedSkills: safeArr(matchedSkills).map(String).filter(Boolean),
    partialMatchSkills: safeArr(partialMatchSkills).map(String).filter(Boolean),
    missingSkills: safeArr(missingSkills).map(String).filter(Boolean),
    learningPlan,
  };
}
