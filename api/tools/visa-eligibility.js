// ============================================================================
// api/tools/visa-eligibility.js
// HireEdge — Vercel Serverless API
//
// GET  ?action=assess&role=data-architect&salary=55000&age=28&hasUkDegree=false&skills=SQL,Python
// GET  ?action=compare&roles=data-architect,analytics-manager,data-engineer&age=28
// ============================================================================

import { assessVisaEligibility, compareVisaEligibility } from "../../lib/tools/visaEngine.js";
import { enforceBilling } from "../../lib/billing/billingMiddleware.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (enforceBilling(req, res, "visa-eligibility")) return;

    const { action } = req.query;

    switch (action) {
      // ── Single Role Assessment ───────────────────────────────────────
      case "assess": {
        const { role, salary, age, hasUkDegree, isNewEntrant, skills } = req.query;
        if (!role) {
          return res.status(400).json({ error: "Missing required param: role (target role slug)" });
        }

        const data = assessVisaEligibility({
          targetRole: role,
          offeredSalary: salary ? parseInt(salary, 10) : undefined,
          age: age ? parseInt(age, 10) : undefined,
          hasUkDegree: hasUkDegree === "true" ? true : hasUkDegree === "false" ? false : undefined,
          isNewEntrant: isNewEntrant === "true",
          skills: skills ? skills.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        });

        if (!data) {
          return res.status(404).json({ error: `Role not found: ${role}` });
        }

        return res.status(200).json({ ok: true, data });
      }

      // ── Compare Multiple Roles ───────────────────────────────────────
      case "compare": {
        const { roles, age, hasUkDegree } = req.query;
        if (!roles) {
          return res.status(400).json({ error: "Missing required param: roles (comma-separated slugs)" });
        }

        const roleList = roles.split(",").map((s) => s.trim()).filter(Boolean);
        if (roleList.length < 2) return res.status(400).json({ error: "Provide at least 2 role slugs" });
        if (roleList.length > 10) return res.status(400).json({ error: "Maximum 10 roles per request" });

        const data = compareVisaEligibility(roleList, {
          age: age ? parseInt(age, 10) : undefined,
          hasUkDegree: hasUkDegree === "true" ? true : hasUkDegree === "false" ? false : undefined,
        });

        return res.status(200).json({ ok: true, data });
      }

      default:
        return res.status(400).json({
          error: "Invalid or missing action",
          valid_actions: ["assess", "compare"],
        });
    }
  } catch (err) {
    console.error("[visa-eligibility]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
