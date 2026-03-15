// ============================================================================
// api/tools/resume-optimiser.js
// HireEdge — Vercel Serverless API
//
// GET  ?action=blueprint&target=data-architect&skills=SQL,Python,Excel&current=data-analyst&yearsExp=3
// GET  ?action=compare&targets=data-architect,analytics-manager&skills=SQL,Python,Excel
// ============================================================================

import { generateResumeBlueprint, compareResumeReadiness } from "../../lib/tools/resumeEngine.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { action } = req.query;

    switch (action) {
      // ── Resume Blueprint ─────────────────────────────────────────────
      case "blueprint": {
        const { target, skills, current, yearsExp, pastRoles } = req.query;
        if (!target || !skills) {
          return res.status(400).json({
            error: "Missing required params: target (role slug), skills (comma-separated)",
          });
        }

        const skillList = skills.split(",").map((s) => s.trim()).filter(Boolean);
        if (skillList.length === 0) {
          return res.status(400).json({ error: "Provide at least one skill" });
        }

        const data = generateResumeBlueprint({
          targetRole: target,
          skills: skillList,
          currentRole: current || undefined,
          yearsExp: yearsExp ? parseInt(yearsExp, 10) : undefined,
          pastRoles: pastRoles ? pastRoles.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        });

        if (!data) {
          return res.status(404).json({ error: `Target role not found: ${target}` });
        }

        return res.status(200).json({ ok: true, data });
      }

      // ── Compare Readiness Across Targets ─────────────────────────────
      case "compare": {
        const { targets, skills } = req.query;
        if (!targets || !skills) {
          return res.status(400).json({
            error: "Missing required params: targets (comma-separated slugs), skills (comma-separated)",
          });
        }

        const targetList = targets.split(",").map((s) => s.trim()).filter(Boolean);
        const skillList = skills.split(",").map((s) => s.trim()).filter(Boolean);

        if (targetList.length < 2) return res.status(400).json({ error: "Provide at least 2 target slugs" });
        if (targetList.length > 10) return res.status(400).json({ error: "Maximum 10 targets per request" });
        if (skillList.length === 0) return res.status(400).json({ error: "Provide at least one skill" });

        const data = compareResumeReadiness(targetList, skillList);
        return res.status(200).json({ ok: true, data });
      }

      default:
        return res.status(400).json({
          error: "Invalid or missing action",
          valid_actions: ["blueprint", "compare"],
        });
    }
  } catch (err) {
    console.error("[resume-optimiser]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
