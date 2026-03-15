// ============================================================================
// lib/billing/billingMiddleware.js
// HireEdge — AI Career Intelligence Platform
//
// Shared billing gate for API routes. Call enforceBilling() at the top
// of any handler. Returns null if access is allowed, or a pre-built
// 403 response body if blocked.
//
// Usage in an API route:
//   import { enforceBilling } from "../../lib/billing/billingMiddleware.js";
//   const blocked = enforceBilling(req, res, "resume-optimiser");
//   if (blocked) return;   // response already sent
// ============================================================================

import { resolveUser, checkAccess } from "./accessControl.js";
import { trackUsage } from "./usageTracker.js";

/**
 * Enforce billing for a tool. If blocked, sends 403 and returns true.
 * If allowed, tracks usage and returns false (handler should continue).
 *
 * @param {object} req   - Vercel request
 * @param {object} res   - Vercel response
 * @param {string} tool  - Tool identifier
 * @returns {boolean}     true if blocked (response already sent), false if allowed
 */
export function enforceBilling(req, res, tool) {
  const user = resolveUser(req);
  const access = checkAccess(user, tool);

  if (!access.allowed) {
    res.status(403).json({
      ok: false,
      error: "access_denied",
      reason: access.reason,
      message: access.meta?.message || `Access to ${tool} is not available on your current plan.`,
      upgrade_to: access.upgrade_to,
      current_plan: user.plan,
    });
    return true;
  }

  // Track usage (non-blocking — don't let tracking failures break the request)
  try {
    // Track specific tool usage
    trackUsage(user.id, tool);
    // Track aggregate tool counter (for daily limit)
    if (tool !== "copilot-chat") {
      trackUsage(user.id, "tools");
    }
  } catch (e) {
    console.error("[billing] tracking error:", e.message);
  }

  return false;
}
