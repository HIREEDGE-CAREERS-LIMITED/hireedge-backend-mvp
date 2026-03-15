// ============================================================================
// api/career-intelligence/role-graph.js
// HireEdge — Vercel Serverless API
//
// GET  ?slug=data-analyst&depth=2&includeAdjacent=true
// ============================================================================

import { buildRoleGraph } from "../../lib/graph/roleGraphEngine.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { slug, depth, includeAdjacent } = req.query;

    if (!slug) {
      return res.status(400).json({ error: "Missing required param: slug" });
    }

    const data = buildRoleGraph(slug, {
      depth: depth ? parseInt(depth, 10) : 2,
      includeAdjacent: includeAdjacent !== "false",
    });

    if (!data.nodes.length) {
      return res.status(404).json({ error: `Role not found in graph: ${slug}` });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error("[role-graph]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
