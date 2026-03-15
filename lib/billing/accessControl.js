// ============================================================================
// lib/billing/accessControl.js
// HireEdge — AI Career Intelligence Platform
//
// Access control layer. Checks a user's plan against tool permissions and
// daily usage limits. Returns a structured allow/deny decision.
// ============================================================================

import { getPlan } from "./planLimits.js";
import { getUsage } from "./usageTracker.js";

/**
 * @typedef {Object} AccessResult
 * @property {boolean} allowed
 * @property {string|null} reason   - null if allowed; otherwise one of:
 *   "upgrade_required" | "daily_limit_reached" | "tool_not_in_plan" | "career_pack_required"
 * @property {string|null} upgrade_to - Suggested plan to upgrade to
 * @property {object}      [meta]     - Additional context (limits, usage)
 */

/**
 * Check whether a user can access a specific tool.
 *
 * @param {object} user
 * @param {string}   user.id     - User identifier
 * @param {string}   user.plan   - Plan ID (free | career_pack | pro | elite)
 * @param {string} tool          - Tool identifier (matches API route name)
 * @returns {AccessResult}
 */
export function checkAccess(user, tool) {
  const plan = getPlan(user?.plan);
  const userId = user?.id || "anonymous";

  // ── Elite: always allowed ────────────────────────────────────────────────
  if (plan.unlimited) {
    return _allow();
  }

  // ── Career Pack endpoints ────────────────────────────────────────────────
  if (tool === "career-pack-build" || tool === "career-pack-export") {
    if (!plan.career_pack_access) {
      return _deny("career_pack_required", "career_pack", {
        message: "Career Pack access requires the Career Pack plan or higher.",
      });
    }
    return _allow();
  }

  // ── Copilot ──────────────────────────────────────────────────────────────
  if (tool === "copilot-chat") {
    const usage = getUsage(userId, "copilot-chat");
    if (usage.today >= plan.copilot_messages_per_day) {
      return _deny("daily_limit_reached", _suggestUpgrade(plan.id), {
        message: `Daily copilot limit reached (${plan.copilot_messages_per_day}/day on ${plan.name} plan).`,
        limit: plan.copilot_messages_per_day,
        used: usage.today,
      });
    }
    return _allow();
  }

  // ── Tool access check ───────────────────────────────────────────────────
  if (!plan.allowed_tools.has(tool)) {
    return _deny("tool_not_in_plan", _suggestUpgrade(plan.id), {
      message: `${tool} is not available on the ${plan.name} plan.`,
      current_plan: plan.id,
    });
  }

  // ── Daily tool limit ─────────────────────────────────────────────────────
  const usage = getUsage(userId, "tools");
  if (usage.today >= plan.tools_per_day) {
    return _deny("daily_limit_reached", _suggestUpgrade(plan.id), {
      message: `Daily tool limit reached (${plan.tools_per_day}/day on ${plan.name} plan).`,
      limit: plan.tools_per_day,
      used: usage.today,
    });
  }

  return _allow();
}

/**
 * Resolve a user object from a request. In V1 this reads from query/body/headers.
 * A real implementation would validate a JWT or session token.
 *
 * @param {object} req - Vercel request object
 * @returns {{ id: string, plan: string }}
 */
export function resolveUser(req) {
  // POST body
  const body = typeof req.body === "string" ? _safeParse(req.body) : req.body || {};

  // Priority: header > body > query > default
  const plan = req.headers?.["x-hireedge-plan"]
    || body.user?.plan
    || req.query?.plan
    || "free";

  const id = req.headers?.["x-hireedge-user-id"]
    || body.user?.id
    || req.query?.userId
    || "anonymous";

  return { id, plan };
}

// ===========================================================================
// Internal
// ===========================================================================

function _allow() {
  return { allowed: true, reason: null, upgrade_to: null };
}

function _deny(reason, upgradeTo, meta = {}) {
  return { allowed: false, reason, upgrade_to: upgradeTo, meta };
}

function _suggestUpgrade(currentPlan) {
  const upgradePath = { free: "pro", career_pack: "pro", pro: "elite" };
  return upgradePath[currentPlan] || "elite";
}

function _safeParse(str) {
  try { return JSON.parse(str); } catch { return {}; }
}
