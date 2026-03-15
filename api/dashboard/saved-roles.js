// ============================================================================
// api/dashboard/saved-roles.js
// HireEdge — Vercel Serverless API
//
// GET  /api/dashboard/saved-roles?roles=data-architect,analytics-manager&current=data-analyst&skills=SQL,Python
// POST /api/dashboard/saved-roles  { roles, currentRole, skills }
// ============================================================================

import { enrichSavedRoles } from "../../lib/dashboard/savedRolesEngine.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    let roles, currentRole, skills;

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      roles = Array.isArray(body.roles) ? body.roles : (body.roles || "").split(",").map((s) => s.trim()).filter(Boolean);
      currentRole = body.currentRole || body.current || undefined;
      skills = Array.isArray(body.skills) ? body.skills : (body.skills || "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (req.method === "GET") {
      roles = req.query.roles ? req.query.roles.split(",").map((s) => s.trim()).filter(Boolean) : [];
      currentRole = req.query.current || undefined;
      skills = req.query.skills ? req.query.skills.split(",").map((s) => s.trim()).filter(Boolean) : [];
    } else {
      return res.status(405).json({ error: "Method not allowed" });
    }

    if (!roles || roles.length === 0) {
      return res.status(400).json({ error: "Missing required param: roles (comma-separated slugs)" });
    }

    const result = enrichSavedRoles({ roles, currentRole, skills });
    return res.status(200).json(result);
  } catch (err) {
    console.error("[dashboard/saved-roles]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
