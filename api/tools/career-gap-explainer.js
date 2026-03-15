// ============================================================================
// api/tools/career-gap-explainer.js
// HireEdge — Vercel Serverless API
//
// GET  ?action=explain&from=data-analyst&to=data-architect
// GET  ?action=multi&from=data-analyst&targets=data-architect,analytics-manager
// ============================================================================

import { explainTransitionGap, explainMultipleGaps } from "../../lib/tools/gapExplainerEngine.js";
import { enforceBilling } from "../../lib/billing/billingMiddleware.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (enforceBilling(req, res, "career-gap-explainer")) return;

    const { action } = req.query;

    switch (action) {
      // ── Single transition explanation ────────────────────────────────
      case "explain": {
        const { from, to } = req.query;
        if (!from || !to) {
          return res.status(400).json({ error: "Missing required params: from, to" });
        }

        const data = explainTransitionGap(from, to);
        if (!data) {
          return res.status(404).json({ error: "One or both roles not found" });
        }

        return res.status(200).json({ ok: true, data });
      }

      // ── Multiple transitions from one origin ────────────────────────
      case "multi": {
        const { from, targets } = req.query;
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

        const data = explainMultipleGaps(from, targetList);
        return res.status(200).json({ ok: true, data });
      }

      default:
        return res.status(400).json({
          error: "Invalid or missing action",
          valid_actions: ["explain", "multi"],
        });
    }
  } catch (err) {
    console.error("[career-gap-explainer]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
