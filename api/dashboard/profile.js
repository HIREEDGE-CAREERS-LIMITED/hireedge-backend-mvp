// ============================================================================
// api/dashboard/profile.js
// HireEdge — Vercel Serverless API
//
// GET  /api/dashboard/profile?role=data-analyst&skills=SQL,Python,Excel&yearsExp=3&target=data-architect
// POST /api/dashboard/profile  { role, target, skills, yearsExp }
// ============================================================================

import { buildDashboardProfile } from "../../lib/dashboard/profileEngine.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    let role, target, skills, yearsExp;

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      role = body.role;
      target = body.target;
      skills = Array.isArray(body.skills) ? body.skills : (body.skills || "").split(",").map((s) => s.trim()).filter(Boolean);
      yearsExp = body.yearsExp !== undefined ? parseInt(body.yearsExp, 10) : undefined;
    } else if (req.method === "GET") {
      role = req.query.role;
      target = req.query.target;
      skills = req.query.skills ? req.query.skills.split(",").map((s) => s.trim()).filter(Boolean) : [];
      yearsExp = req.query.yearsExp ? parseInt(req.query.yearsExp, 10) : undefined;
    } else {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!role) return res.status(400).json({ error: "Missing required param: role" });
    if (!skills || skills.length === 0) return res.status(400).json({ error: "Missing required param: skills" });

    const result = buildDashboardProfile({ role, target, skills, yearsExp });

    if (!result.ok) return res.status(404).json(result);
    return res.status(200).json(result);
  } catch (err) {
    console.error("[dashboard/profile]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
