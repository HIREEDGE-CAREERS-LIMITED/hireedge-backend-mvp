// ============================================================================
// lib/billing/usageTracker.js
// HireEdge — AI Career Intelligence Platform
//
// Lightweight in-memory usage tracker (V1). Tracks per-user, per-tool
// daily usage counts. In serverless, this resets on cold start — sufficient
// for MVP. A production implementation would use Redis or a database.
//
// The tracker supports a "pass-through" mode where the frontend can send
// usage counts in the request body (for client-side persistence).
// ============================================================================

/**
 * In-memory store: Map<string, { date: string, counts: Map<string, number> }>
 * Key format: userId
 */
const _store = new Map();

/**
 * Record a usage event.
 *
 * @param {string} userId
 * @param {string} tool    - Tool identifier or "copilot-chat", "tools", "career-pack"
 * @returns {{ userId: string, tool: string, today: number, timestamp: string }}
 */
export function trackUsage(userId, tool) {
  const today = _today();
  const key = userId || "anonymous";

  if (!_store.has(key) || _store.get(key).date !== today) {
    _store.set(key, { date: today, counts: new Map() });
  }

  const entry = _store.get(key);
  const current = entry.counts.get(tool) || 0;
  entry.counts.set(tool, current + 1);

  return {
    userId: key,
    tool,
    today: current + 1,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get current usage for a user + tool.
 *
 * @param {string} userId
 * @param {string} tool
 * @returns {{ today: number }}
 */
export function getUsage(userId, tool) {
  const today = _today();
  const key = userId || "anonymous";
  const entry = _store.get(key);

  if (!entry || entry.date !== today) return { today: 0 };
  return { today: entry.counts.get(tool) || 0 };
}

/**
 * Get full usage summary for a user (all tools today).
 *
 * @param {string} userId
 * @returns {{ date: string, tools: object, total: number }}
 */
export function getUsageSummary(userId) {
  const today = _today();
  const key = userId || "anonymous";
  const entry = _store.get(key);

  if (!entry || entry.date !== today) {
    return { date: today, tools: {}, total: 0 };
  }

  const tools = Object.fromEntries(entry.counts);
  const total = [...entry.counts.values()].reduce((a, b) => a + b, 0);

  return { date: today, tools, total };
}

/**
 * Reset usage for a user (useful for testing).
 * @param {string} userId
 */
export function resetUsage(userId) {
  _store.delete(userId || "anonymous");
}

/**
 * Seed usage from an external source (frontend pass-through).
 * Allows the frontend to send existing counts so the serverless function
 * can enforce limits even without persistence.
 *
 * @param {string} userId
 * @param {object} counts - { "copilot-chat": 5, "tools": 12, ... }
 */
export function seedUsage(userId, counts) {
  const today = _today();
  const key = userId || "anonymous";

  _store.set(key, {
    date: today,
    counts: new Map(Object.entries(counts || {})),
  });
}

// ===========================================================================
// Internal
// ===========================================================================
function _today() {
  return new Date().toISOString().slice(0, 10);
}
