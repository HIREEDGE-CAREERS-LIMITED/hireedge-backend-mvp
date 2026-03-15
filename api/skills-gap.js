// ============================================================================
// api/career-intelligence/skills-gap.js
// HireEdge — Vercel Serverless API
//
// GET  ?action=analyse&target=data-architect&skills=SQL,Python,Excel
// GET  ?action=transition&from=data-analyst&to=data-architect
// GET  ?action=match&skills=SQL,Python,Machine+Learning&category=Data+%26+AI&limit=10
// ============================================================================

import {
  analyseSkillsGap,
  analyseRoleTransitionGap,
  findRolesMatchingSkills,
} from "../../lib/intelligence/skillsGapEngine.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { action } = req.query;

    switch (action) {
      // ── Skills Gap Analysis (person → target role) ───────────────────
      case "analyse": {
        const { target, skills } = req.query;
        if (!target || !skills) {
          return res.status(400).json({
            error: "Missing required params: target (slug), skills (comma-separated)",
          });
        }
        const skillList = skills.split(",").map((s) => s.trim()).filter(Boolean);
        if (skillList.length === 0) {
          return res.status(400).json({ error: "Provide at least one skill" });
        }
        const data = analyseSkillsGap(skillList, target);
        if (!data) return res.status(404).json({ error: `Target role not found: ${target}` });
        return res.status(200).json({ ok: true, data });
      }

      // ── Role-to-Role Transition Gap ──────────────────────────────────
      case "transition": {
        const { from, to } = req.query;
        if (!from || !to) {
          return res.status(400).json({ error: "Missing required params: from, to" });
        }
        const data = analyseRoleTransitionGap(from, to);
        if (!data) return res.status(404).json({ error: "One or both roles not found" });
        return res.status(200).json({ ok: true, data });
      }

      // ── Find Best-Matching Roles for Skills ──────────────────────────
      case "match": {
        const { skills, category, limit, minMatch } = req.query;
        if (!skills) {
          return res.status(400).json({ error: "Missing required param: skills (comma-separated)" });
        }
        const skillList = skills.split(",").map((s) => s.trim()).filter(Boolean);
        if (skillList.length === 0) {
          return res.status(400).json({ error: "Provide at least one skill" });
        }
        const data = findRolesMatchingSkills(skillList, {
          category,
          limit: limit ? parseInt(limit, 10) : 20,
          minMatch: minMatch ? parseInt(minMatch, 10) : 1,
        });
        return res.status(200).json({ ok: true, total: data.length, data });
      }

      default:
        return res.status(400).json({
          error: "Invalid or missing action",
          valid_actions: ["analyse", "transition", "match"],
        });
    }
  } catch (err) {
    console.error("[skills-gap]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
