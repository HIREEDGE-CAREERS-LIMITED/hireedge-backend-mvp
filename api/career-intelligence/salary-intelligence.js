// ============================================================================
// api/career-intelligence/salary-intelligence.js
// HireEdge — Vercel Serverless API
//
// GET  ?action=role&slug=data-analyst
// GET  ?action=compare&slugs=data-analyst,data-engineer,data-scientist
// GET  ?action=top&category=Data+%26+AI&seniority=Senior&limit=10
// GET  ?action=byseniority&category=Data+%26+AI
// ============================================================================

import {
  getSalaryIntelligence,
  compareSalaries,
  getTopPayingRoles,
  getSalaryBySeniority,
} from "../../lib/intelligence/salaryEngine.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { action } = req.query;

    switch (action) {
      // ── Single Role Salary Intelligence ──────────────────────────────
      case "role": {
        const { slug } = req.query;
        if (!slug) return res.status(400).json({ error: "Missing required param: slug" });
        const data = getSalaryIntelligence(slug);
        if (!data) return res.status(404).json({ error: `Role not found or no salary data: ${slug}` });
        return res.status(200).json({ ok: true, data });
      }

      // ── Compare Multiple ─────────────────────────────────────────────
      case "compare": {
        const { slugs } = req.query;
        if (!slugs) return res.status(400).json({ error: "Missing required param: slugs (comma-separated)" });
        const slugList = slugs.split(",").map((s) => s.trim()).filter(Boolean);
        if (slugList.length < 2) return res.status(400).json({ error: "Provide at least 2 slugs" });
        const data = compareSalaries(slugList);
        return res.status(200).json({ ok: true, data });
      }

      // ── Top Paying ───────────────────────────────────────────────────
      case "top": {
        const { category, seniority, limit } = req.query;
        const data = getTopPayingRoles({
          category,
          seniority,
          limit: limit ? parseInt(limit, 10) : 20,
        });
        return res.status(200).json({ ok: true, total: data.length, data });
      }

      // ── Salary by Seniority ──────────────────────────────────────────
      case "byseniority": {
        const { category } = req.query;
        if (!category) return res.status(400).json({ error: "Missing required param: category" });
        const data = getSalaryBySeniority(category);
        return res.status(200).json({ ok: true, data });
      }

      default:
        return res.status(400).json({
          error: "Invalid or missing action",
          valid_actions: ["role", "compare", "top", "byseniority"],
        });
    }
  } catch (err) {
    console.error("[salary-intelligence]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
