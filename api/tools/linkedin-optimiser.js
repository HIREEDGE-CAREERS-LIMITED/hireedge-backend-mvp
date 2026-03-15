// ============================================================================
// api/tools/linkedin-optimiser.js
// HireEdge — Vercel Serverless API
//
// GET  ?role=data-analyst&skills=SQL,Python,Excel,Statistics&yearsExp=3&target=data-architect&industry=technology
// ============================================================================

import { generateLinkedInOptimisation } from "../../lib/tools/linkedinEngine.js";
import { enforceBilling } from "../../lib/billing/billingMiddleware.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (enforceBilling(req, res, "linkedin-optimiser")) return;

    const { role, skills, yearsExp, target, industry } = req.query;

    if (!role) {
      return res.status(400).json({ error: "Missing required param: role (current role slug)" });
    }
    if (!skills) {
      return res.status(400).json({ error: "Missing required param: skills (comma-separated)" });
    }

    const skillList = skills.split(",").map((s) => s.trim()).filter(Boolean);
    if (skillList.length === 0) {
      return res.status(400).json({ error: "Provide at least one skill" });
    }

    const data = generateLinkedInOptimisation({
      currentRole: role,
      skills: skillList,
      yearsExp: yearsExp ? parseInt(yearsExp, 10) : undefined,
      targetRole: target || undefined,
      industry: industry || undefined,
    });

    if (!data) {
      return res.status(404).json({ error: `Role not found: ${role}` });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error("[linkedin-optimiser]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
