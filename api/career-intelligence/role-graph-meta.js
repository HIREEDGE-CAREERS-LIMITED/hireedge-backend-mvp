// ============================================================================
// api/career-intelligence/role-graph-meta.js
// HireEdge — Vercel Serverless API
//
// GET  ?action=stats
// GET  ?action=hubs&limit=20
// GET  ?action=deadends&limit=30
// GET  ?action=entrypoints&limit=30
// GET  ?action=bridges&limit=20
// ============================================================================

import {
  getGraphStats,
  getHubRoles,
  getDeadEndRoles,
  getEntryPointRoles,
  getCategoryBridges,
} from "../../lib/graph/graphMetaEngine.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { action, limit } = req.query;
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;

    switch (action) {
      case "stats": {
        const data = getGraphStats();
        return res.status(200).json({ ok: true, data });
      }

      case "hubs": {
        const data = getHubRoles({ limit: parsedLimit });
        return res.status(200).json({ ok: true, total: data.length, data });
      }

      case "deadends": {
        const data = getDeadEndRoles({ limit: parsedLimit });
        return res.status(200).json({ ok: true, total: data.length, data });
      }

      case "entrypoints": {
        const data = getEntryPointRoles({ limit: parsedLimit });
        return res.status(200).json({ ok: true, total: data.length, data });
      }

      case "bridges": {
        const data = getCategoryBridges({ limit: parsedLimit });
        return res.status(200).json({ ok: true, total: data.length, data });
      }

      default:
        return res.status(400).json({
          error: "Invalid or missing action",
          valid_actions: ["stats", "hubs", "deadends", "entrypoints", "bridges"],
        });
    }
  } catch (err) {
    console.error("[role-graph-meta]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
