// ============================================================================
// api/career-pack/export.js
// HireEdge — Vercel Serverless API
//
// GET  /api/career-pack/export?role=data-analyst&target=data-architect&skills=SQL,Python,Excel&yearsExp=3
//
// Returns a downloadable JSON file (Content-Disposition: attachment).
// Identical payload to /build, but served as a file download.
// ============================================================================

import { buildCareerPack } from "../../lib/career-pack/careerPackEngine.js";
import { enforceBilling } from "../../lib/billing/billingMiddleware.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (enforceBilling(req, res, "career-pack-export")) return;
    const { role, target, skills, yearsExp } = req.query;

    if (!role) return res.status(400).json({ error: "Missing required param: role" });
    if (!target) return res.status(400).json({ error: "Missing required param: target" });
    if (!skills) return res.status(400).json({ error: "Missing required param: skills" });

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

    // ── Serve as a downloadable JSON file ──────────────────────────────────
    const filename = `hireedge-career-pack_${role}_to_${target}_${Date.now()}.json`;
    const body = JSON.stringify(pack, null, 2);

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", Buffer.byteLength(body, "utf-8"));

    return res.status(200).send(body);
  } catch (err) {
    console.error("[career-pack/export]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
