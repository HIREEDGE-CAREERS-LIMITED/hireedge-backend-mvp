// ============================================================================
// api/career-intelligence/role-path.js
// HireEdge — Vercel Serverless API
//
// GET  ?action=shortest&from=data-analyst&to=data-architect
// GET  ?action=all&from=data-analyst&to=data-architect&maxDepth=5&maxResults=5
// GET  ?action=next&slug=data-analyst&sortBy=salary
// GET  ?action=previous&slug=senior-data-analyst
// ============================================================================

import {
  findShortestPath,
  findAllPaths,
  getNextMoves,
  getPreviousMoves,
} from "../../lib/graph/careerPathEngine.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { action } = req.query;

    switch (action) {
      // ── Shortest Path ────────────────────────────────────────────────
      case "shortest": {
        const { from, to, maxDepth } = req.query;
        if (!from || !to) return res.status(400).json({ error: "Missing required params: from, to" });
        const data = findShortestPath(from, to, {
          maxDepth: maxDepth ? parseInt(maxDepth, 10) : 8,
        });
        if (!data) return res.status(404).json({ error: "No path found between these roles" });
        return res.status(200).json({ ok: true, data });
      }

      // ── All Paths ───────────────────────────────────────────────────
      case "all": {
        const { from, to, maxDepth, maxResults } = req.query;
        if (!from || !to) return res.status(400).json({ error: "Missing required params: from, to" });
        const data = findAllPaths(from, to, {
          maxDepth: maxDepth ? parseInt(maxDepth, 10) : 6,
          maxResults: maxResults ? parseInt(maxResults, 10) : 10,
        });
        return res.status(200).json({ ok: true, total: data.length, data });
      }

      // ── Next Moves ──────────────────────────────────────────────────
      case "next": {
        const { slug, sortBy } = req.query;
        if (!slug) return res.status(400).json({ error: "Missing required param: slug" });
        const data = getNextMoves(slug, { sortBy: sortBy || "salary" });
        return res.status(200).json({ ok: true, total: data.length, data });
      }

      // ── Previous Moves ──────────────────────────────────────────────
      case "previous": {
        const { slug } = req.query;
        if (!slug) return res.status(400).json({ error: "Missing required param: slug" });
        const data = getPreviousMoves(slug);
        return res.status(200).json({ ok: true, total: data.length, data });
      }

      default:
        return res.status(400).json({
          error: "Invalid or missing action",
          valid_actions: ["shortest", "all", "next", "previous"],
        });
    }
  } catch (err) {
    console.error("[role-path]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
