// ============================================================================
// api/career-intelligence/role-intelligence.js
// HireEdge — Vercel Serverless API
//
// GET  ?action=profile&slug=data-analyst
// GET  ?action=compare&slugA=data-analyst&slugB=data-engineer
// GET  ?action=search&q=data&category=Data+%26+AI&limit=10
// GET  ?action=category&category=Data+%26+AI
// GET  ?action=categories
// ============================================================================

import {
  getRoleProfile,
  compareRoles,
  searchRoleIntelligence,
  getCategoryIntelligence,
  listCategories,
} from "../../lib/intelligence/roleIntelligenceEngine.js";

export default function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { action } = req.query;

    switch (action) {
      // ── Profile ──────────────────────────────────────────────────────
      case "profile": {
        const { slug } = req.query;
        if (!slug) return res.status(400).json({ error: "Missing required param: slug" });
        const data = getRoleProfile(slug);
        if (!data) return res.status(404).json({ error: `Role not found: ${slug}` });
        return res.status(200).json({ ok: true, data });
      }

      // ── Compare ──────────────────────────────────────────────────────
      case "compare": {
        const { slugA, slugB } = req.query;
        if (!slugA || !slugB) return res.status(400).json({ error: "Missing required params: slugA, slugB" });
        const data = compareRoles(slugA, slugB);
        if (!data) return res.status(404).json({ error: "One or both roles not found" });
        return res.status(200).json({ ok: true, data });
      }

      // ── Search ───────────────────────────────────────────────────────
      case "search": {
        const { q, category, seniority, limit } = req.query;
        if (!q) return res.status(400).json({ error: "Missing required param: q" });
        const data = searchRoleIntelligence(q, {
          category,
          seniority,
          limit: limit ? parseInt(limit, 10) : 20,
        });
        return res.status(200).json({ ok: true, total: data.length, data });
      }

      // ── Category Intelligence ────────────────────────────────────────
      case "category": {
        const { category } = req.query;
        if (!category) return res.status(400).json({ error: "Missing required param: category" });
        const data = getCategoryIntelligence(category);
        if (!data) return res.status(404).json({ error: `Category not found: ${category}` });
        return res.status(200).json({ ok: true, data });
      }

      // ── List Categories ──────────────────────────────────────────────
      case "categories": {
        const data = listCategories();
        return res.status(200).json({ ok: true, total: data.length, data });
      }

      default:
        return res.status(400).json({
          error: "Invalid or missing action",
          valid_actions: ["profile", "compare", "search", "category", "categories"],
        });
    }
  } catch (err) {
    console.error("[role-intelligence]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
