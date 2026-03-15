// ============================================================================
// api/tools/career-roadmap.js
// HireEdge — Vercel Serverless API
//
// GET  ?action=build&from=data-analyst&to=data-architect&strategy=fastest
// GET  ?action=multi&from=data-analyst&targets=data-architect,analytics-manager,data-scientist
// ============================================================================

import { buildRoadmap, buildMultiRoadmap } from "../../lib/tools/roadmapEngine.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { action } = req.query;

    switch (action) {
      // ── Build single roadmap ─────────────────────────────────────────
      case "build": {
        const { from, to, strategy, maxDepth } = req.query;
        if (!from || !to) {
          return res.status(400).json({ error: "Missing required params: from, to" });
        }

        const validStrategies = ["fastest", "easiest", "highest_paid"];
        const strat = validStrategies.includes(strategy) ? strategy : "fastest";

        const data = buildRoadmap(from, to, {
          strategy: strat,
          maxDepth: maxDepth ? parseInt(maxDepth, 10) : 6,
        });

        if (!data) {
          return res.status(404).json({ error: "One or both roles not found" });
        }

        return res.status(200).json({ ok: true, data });
      }

      // ── Compare roadmaps to multiple targets ────────────────────────
      case "multi": {
        const { from, targets, strategy } = req.query;
        if (!from || !targets) {
          return res.status(400).json({
            error: "Missing required params: from, targets (comma-separated slugs)",
          });
        }

        const targetList = targets.split(",").map((s) => s.trim()).filter(Boolean);
        if (targetList.length < 1) {
          return res.status(400).json({ error: "Provide at least 1 target slug" });
        }
        if (targetList.length > 10) {
          return res.status(400).json({ error: "Maximum 10 targets per request" });
        }

        const validStrategies = ["fastest", "easiest", "highest_paid"];
        const strat = validStrategies.includes(strategy) ? strategy : "fastest";

        const data = buildMultiRoadmap(from, targetList, { strategy: strat });
        return res.status(200).json({ ok: true, data });
      }

      default:
        return res.status(400).json({
          error: "Invalid or missing action",
          valid_actions: ["build", "multi"],
        });
    }
  } catch (err) {
    console.error("[career-roadmap]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
