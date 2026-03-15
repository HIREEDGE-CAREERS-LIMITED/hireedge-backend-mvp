// ============================================================================
// api/tools/interview-prep.js
// HireEdge — Vercel Serverless API
//
// GET  ?target=data-architect&skills=SQL,Python,Excel&current=data-analyst&yearsExp=3
// ============================================================================

import { generateInterviewPrep } from "../../lib/tools/interviewEngine.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { target, skills, current, yearsExp } = req.query;

    if (!target) {
      return res.status(400).json({ error: "Missing required param: target (role slug being interviewed for)" });
    }
    if (!skills) {
      return res.status(400).json({ error: "Missing required param: skills (comma-separated)" });
    }

    const skillList = skills.split(",").map((s) => s.trim()).filter(Boolean);
    if (skillList.length === 0) {
      return res.status(400).json({ error: "Provide at least one skill" });
    }

    const data = generateInterviewPrep({
      targetRole: target,
      skills: skillList,
      currentRole: current || undefined,
      yearsExp: yearsExp ? parseInt(yearsExp, 10) : undefined,
    });

    if (!data) {
      return res.status(404).json({ error: `Target role not found: ${target}` });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error("[interview-prep]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
