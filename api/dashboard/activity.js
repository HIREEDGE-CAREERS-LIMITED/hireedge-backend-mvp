// ============================================================================
// api/dashboard/activity.js
// HireEdge — Vercel Serverless API
//
// POST /api/dashboard/activity  { recent_roles, recent_tools, recent_queries, recent_packs }
// GET  /api/dashboard/activity?recent_roles=data-analyst,data-architect  (lightweight)
//
// V1: No persistence. The frontend sends activity and gets back normalised,
// enriched, dashboard-ready JSON. Frontend stores activity client-side.
// ============================================================================

import { normaliseActivity } from "../../lib/dashboard/activityEngine.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    let input;

    if (req.method === "POST") {
      input = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    } else if (req.method === "GET") {
      // Lightweight GET: parse comma-separated slugs for recent_roles
      const roleSlugs = req.query.recent_roles
        ? req.query.recent_roles.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      const toolNames = req.query.recent_tools
        ? req.query.recent_tools.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      input = {
        recent_roles: roleSlugs.map((slug) => ({ slug, timestamp: new Date().toISOString() })),
        recent_tools: toolNames.map((tool) => ({ tool, timestamp: new Date().toISOString() })),
        recent_queries: [],
        recent_packs: [],
      };
    } else {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const result = normaliseActivity(input);
    return res.status(200).json(result);
  } catch (err) {
    console.error("[dashboard/activity]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
