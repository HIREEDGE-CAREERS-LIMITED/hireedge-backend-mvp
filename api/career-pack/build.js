// ============================================================================
// api/career-pack/build.js
// HireEdge — Vercel Serverless API
//
// GET  /api/career-pack/build?role=data-analyst&target=data-architect&skills=SQL,Python,Excel&yearsExp=3
// ============================================================================

import { buildCareerPack } from "../../lib/career-pack/careerPackEngine.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { role, target, skills, yearsExp } = req.query;

    if (!role) return res.status(400).json({ error: "Missing required param: role (current role slug)" });
    if (!target) return res.status(400).json({ error: "Missing required param: target (target role slug)" });
    if (!skills) return res.status(400).json({ error: "Missing required param: skills (comma-separated)" });

    const skillList = skills.split(",").map((s) => s.trim()).filter(Boolean);
    if (skillList.length === 0) {
      return res.status(400).json({ error: "Provide at least one skill" });
    }

    const pack = buildCareerPack({
      role,
      target,
      skills: skillList,
      yearsExp: yearsExp ? parseInt(yearsExp, 10) : undefined,
    });

    if (!pack.ok) {
      return res.status(400).json({ ok: false, errors: pack.errors });
    }

    return res.status(200).json(pack);
  } catch (err) {
    console.error("[career-pack/build]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
